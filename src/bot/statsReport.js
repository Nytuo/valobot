const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sessionManager = require('../services/sessionManager');
const profiles = require('../services/profiles');
const valorantStats = require('../services/valorantStats');
const phrases = require('./phrases');
const { safeName } = require('../server/auth');

const EARLY_START_MS = 5 * 60 * 1000; // games launched a bit before the planned time still count
const RESULT_COOLDOWN_MS = 45 * 1000;
const NO_MENTIONS = { parse: [] };
const FOOTER = 'Valobot • Données HenrikDev API • Non affilié à Riot Games';

const inFlight = new Set();

function sessionPlayerIds(session) {
  const roster = sessionManager.calculateRosters(session);
  return [...new Set(roster.teams.flat().map(p => p.userId))];
}

const rankLine = (rank) => rank
  ? `**${safeName(rank.tier)}**${rank.rr !== null ? ` (${rank.rr} RR)` : ''}`
  : '*rang inconnu*';

function statsErrorText(err) {
  if (err?.code === 'rate_limited') return 'Trop de requêtes vers l\'API de stats, réessaie dans une minute. « Doucement sur le clic » 🐢';
  if (err?.code === 'unauthorized') return 'La clé API de stats est invalide ou absente (admin du bot : vérifie `HENRIK_API_KEY`).';
  return 'L\'API de stats ne répond pas pour le moment. « Ça arrive aux meilleurs. » 🔧';
}

// ---------- BEFORE: snapshot taken when the match time is reached ----------
async function captureBeforeStats(client, session) {
  try {
    if (!valorantStats.isConfigured() || session.status === 'cancelled' || session.stats?.before) return;
    const channel = session.channelId ? await client.channels.fetch(session.channelId).catch(() => null) : null;
    if (!channel || !channel.isTextBased()) return;

    const playerIds = sessionPlayerIds(session);
    const before = {};
    const lines = [];

    for (const userId of playerIds) {
      const profile = profiles.getProfile(userId);
      if (!profile) {
        lines.push(`<@${userId}> — 🔗 pas lié (\`/valolink\`)`);
        continue;
      }
      let rank = null;
      try {
        rank = await valorantStats.getRank(profile, { fresh: true });
      } catch (err) {
        console.warn(`⚠️ [Stats] Could not fetch rank for ${userId}: ${err.code || err.message}`);
      }
      before[userId] = rank;
      lines.push(`<@${userId}> — ${rankLine(rank)} · [${safeName(profiles.riotLabel(profile))}](${profiles.trackerUrl(profile)})`);
    }

    session.stats = { startedAt: Date.now(), since: session.partyTimestamp - EARLY_START_MS, players: playerIds, before, lastResultAt: 0 };
    sessionManager.persist();

    if (Object.keys(before).length === 0) return; // nobody linked: stay quiet

    await channel.send({
      allowedMentions: NO_MENTIONS,
      embeds: [
        new EmbedBuilder()
          .setColor(0x00f59b)
          .setTitle('📊 Avant la partie : état des lieux')
          .setDescription(`${phrases.pick(phrases.statsBefore)}\n\n${lines.join('\n')}`)
          .addFields({
            name: 'Quand c\'est fini',
            value: 'Clique sur **📊 Résultats** sous le message de la session (ou tape `/valoresult`). Plusieurs parties dans la soirée ? Le bilan les additionne toutes.'
          })
          .setFooter({ text: FOOTER })
      ]
    });
  } catch (err) {
    console.error(`❌ [Stats] Failed to capture before-stats for ${session.id}:`, err);
  }
}

// ---------- AFTER: aggregation ----------
function aggregate(matches) {
  const total = { games: matches.length, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, rounds: 0, acsWeighted: 0, adrWeighted: 0, headshots: 0, shots: 0 };
  for (const m of matches) {
    if (m.won === true) total.wins++;
    else if (m.won === false) total.losses++;
    total.kills += m.kills;
    total.deaths += m.deaths;
    total.assists += m.assists;
    total.rounds += m.rounds;
    total.acsWeighted += m.acs * m.rounds;
    total.adrWeighted += m.adr * m.rounds;
    total.headshots += m.headshots;
    total.shots += m.shots;
  }
  return {
    ...total,
    acs: total.rounds ? Math.round(total.acsWeighted / total.rounds) : 0,
    adr: total.rounds ? Math.round(total.adrWeighted / total.rounds) : 0,
    hs: total.shots ? Math.round((total.headshots / total.shots) * 100) : 0,
    kda: ((total.kills + total.assists) / Math.max(1, total.deaths)).toFixed(2)
  };
}

// Keep only games the squad played together (>= 2 linked members present), so solo queues don't pollute the bilan
function selectSquadGames(perPlayerMatches) {
  const byMatch = new Map();
  for (const [userId, matches] of perPlayerMatches) {
    for (const m of matches) {
      if (!byMatch.has(m.matchId)) byMatch.set(m.matchId, { sample: m, userIds: new Set() });
      byMatch.get(m.matchId).userIds.add(userId);
    }
  }
  const required = Math.min(2, perPlayerMatches.size);
  return [...byMatch.entries()]
    .filter(([, g]) => g.userIds.size >= required)
    .sort((a, b) => a[1].sample.startedAt - b[1].sample.startedAt);
}

async function buildResultEmbed(session) {
  const stats = session.stats || { since: session.partyTimestamp - EARLY_START_MS, before: {}, players: sessionPlayerIds(session) };
  const playerIds = stats.players?.length ? stats.players : sessionPlayerIds(session);
  const linked = playerIds.map(id => ({ id, profile: profiles.getProfile(id) })).filter(p => p.profile);

  const after = new Map();
  const perPlayer = new Map();
  for (const { id, profile } of linked) {
    after.set(id, await valorantStats.getRank(profile, { fresh: true }).catch(err => { if (err.code === 'rate_limited') throw err; return null; }));
    perPlayer.set(id, await valorantStats.getMatchesSince(profile, stats.since));
  }

  const games = selectSquadGames(perPlayer);
  const gameIds = new Set(games.map(([matchId]) => matchId));

  const embed = new EmbedBuilder().setColor(0xff4655).setTitle('🏁 Bilan de la soirée').setFooter({ text: FOOTER });

  if (linked.length === 0) {
    return embed.setDescription('Personne n\'a lié son compte Riot. Tapez `/valolink riot_id:Pseudo#TAG` puis relancez le bilan. « Sans données, pas de gloire. » 🕳️');
  }
  if (games.length === 0) {
    return embed.setDescription('Aucune partie jouée ensemble détectée depuis le début de la session. Les parties mettent parfois une minute à apparaître : réessaie dans un instant. « Patience, jeune padawan. » 🧘');
  }

  const gameLines = games.slice(-10).map(([, g], i) => {
    const m = g.sample;
    const icon = m.won === true ? '✅' : (m.won === false ? '❌' : '🤝');
    return `**${i + 1}.** 🗺️ ${safeName(m.map)} · ${icon} ${m.score || ''} ${m.queue ? `· ${safeName(m.queue)}` : ''}`.trim();
  });
  embed.addFields({ name: `🎮 Parties jouées (${games.length})`, value: gameLines.join('\n').slice(0, 1024) });

  const summaries = [];
  for (const { id, profile } of linked) {
    const mine = (perPlayer.get(id) || []).filter(m => gameIds.has(m.matchId));
    const agg = aggregate(mine);
    const rankBefore = stats.before?.[id] || null;
    const rankAfter = after.get(id) || null;

    let rankText = rankAfter ? rankLine(rankAfter) : '*rang inconnu*';
    if (rankBefore && rankAfter) {
      const delta = rankBefore.elo !== null && rankAfter.elo !== null ? rankAfter.elo - rankBefore.elo : null;
      rankText = `${rankLine(rankBefore)} → ${rankLine(rankAfter)}${delta !== null ? ` · **${delta >= 0 ? '+' : ''}${delta} RR**` : ''}`;
    }

    const value = agg.games === 0
      ? `Rang : ${rankText}\n*Pas de partie avec l'escouade.*`
      : `Rang : ${rankText}\n` +
        `Parties : **${agg.games}** (${agg.wins}V-${agg.losses}D)\n` +
        `K/D/A : **${agg.kills}/${agg.deaths}/${agg.assists}** · KDA **${agg.kda}**\n` +
        `ACS moy. : **${agg.acs}** · ADR **${agg.adr}** · HS **${agg.hs}%**`;

    embed.addFields({ name: `🎯 ${safeName(profiles.riotLabel(profile))}`, value: value.slice(0, 1024) });
    if (agg.games > 0) summaries.push({ id, agg });
  }

  if (summaries.length >= 2) {
    const sorted = [...summaries].sort((a, b) => b.agg.acs - a.agg.acs);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    embed.setDescription(
      `${phrases.pick(phrases.mvp).replace('{name}', `<@${best.id}>`).replace('{acs}', best.agg.acs)}\n` +
      `${phrases.pick(phrases.boulet).replace('{name}', `<@${worst.id}>`).replace('{acs}', worst.agg.acs)}`
    );
  } else {
    embed.setDescription(phrases.pick(phrases.statsAfter));
  }

  const unlinked = playerIds.length - linked.length;
  if (unlinked > 0) {
    embed.addFields({ name: '🔗 Pas de stats pour', value: `${unlinked} joueur(s) sans compte lié. Utilise \`/valolink\` pour apparaître dans le prochain bilan.` });
  }
  return embed;
}

// ---------- AFTER: entry point (button + /valoresult) ----------
function canRequestResults(interaction, session) {
  if (interaction.user.id === session.creator.id) return true;
  if (sessionPlayerIds(session).includes(interaction.user.id)) return true;
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

async function handleResultRequest(interaction, sessionIdFromButton = null) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: '⛔ Seulement dans un serveur.', ephemeral: true });
  }
  if (!valorantStats.isConfigured()) {
    return interaction.reply({ content: '📊 Les stats ne sont pas activées sur ce bot (`HENRIK_API_KEY` manquante).', ephemeral: true });
  }

  let session = sessionIdFromButton ? sessionManager.getSession(sessionIdFromButton) : null;
  if (!sessionIdFromButton) {
    // /valoresult: most recent started, non-cancelled session of this channel the user took part in
    session = sessionManager.getAllSessions()
      .filter(s => s.channelId === interaction.channelId && s.status !== 'cancelled' && s.partyStartSent)
      .filter(s => canRequestResults(interaction, s))
      .sort((a, b) => b.partyTimestamp - a.partyTimestamp)[0] || null;
  }

  if (!session || session.guildId !== interaction.guildId) {
    return interaction.reply({ content: '🤷 Aucune session terminée trouvée ici. Le bilan est dispo une fois l\'heure du match passée.', ephemeral: true });
  }
  if (session.status === 'cancelled') {
    return interaction.reply({ content: '🚫 Session annulée, pas de bilan à faire.', ephemeral: true });
  }
  if (!session.partyStartSent) {
    return interaction.reply({ content: '⏳ Le match n\'a pas encore commencé. Reviens quand c\'est fini !', ephemeral: true });
  }
  if (!canRequestResults(interaction, session)) {
    return interaction.reply({ content: '⛔ Seuls l\'hôte et les joueurs de la session peuvent demander le bilan.', ephemeral: true });
  }

  session.stats = session.stats || { startedAt: Date.now(), since: session.partyTimestamp - EARLY_START_MS, players: sessionPlayerIds(session), before: {}, lastResultAt: 0 };
  const wait = session.stats.lastResultAt + RESULT_COOLDOWN_MS - Date.now();
  if (inFlight.has(session.id) || wait > 0) {
    return interaction.reply({ content: `🐢 Un bilan vient d'être demandé, patiente ${Math.max(5, Math.ceil(wait / 1000))}s.`, ephemeral: true });
  }

  inFlight.add(session.id);
  session.stats.lastResultAt = Date.now();
  try {
    await interaction.deferReply();
    const embed = await buildResultEmbed(session);
    sessionManager.persist();
    await interaction.editReply({ embeds: [embed], allowedMentions: NO_MENTIONS });
  } catch (err) {
    console.error(`❌ [Stats] Result report failed for ${session.id}:`, err.code || err.message);
    session.stats.lastResultAt = 0; // let them retry right away
    await interaction.editReply({ content: `❌ ${statsErrorText(err)}`, embeds: [] }).catch(() => {});
  } finally {
    inFlight.delete(session.id);
  }
}

// ---------- /valolink and /valounlink ----------
async function handleLinkCommand(interaction, config = {}) {
  const rawRiotId = interaction.options.getString('riot_id');

  // No argument: send the one-click link that reads the Riot Games connection of the Discord profile
  if (!rawRiotId) {
    const base = (config.webBaseUrl || process.env.WEB_BASE_URL || '').replace(/\/$/, '');
    if (!base.startsWith('http')) {
      return interaction.reply({ content: '❌ Lien indisponible (`WEB_BASE_URL` non configurée). Utilise `/valolink riot_id:Pseudo#TAG`.', ephemeral: true });
    }
    return interaction.reply({
      content: 'Clique pour lier ton compte **Riot Games** depuis ton profil Discord (une autorisation, rien d\'autre n\'est lu). ' +
        'Pas de connexion Riot sur ton profil ? Ajoute-la dans *Paramètres → Connexions*, ou tape `/valolink riot_id:Pseudo#TAG`.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Lier mon compte Riot').setStyle(ButtonStyle.Link).setURL(`${base}/api/auth/riot`)
      )],
      ephemeral: true
    });
  }

  const parsed = profiles.parseRiotId(rawRiotId);
  if (!parsed) {
    return interaction.reply({ content: '❌ Riot ID invalide. Format attendu : `Pseudo#TAG` (ex. `Nytuo#EUW`). « Il manque le #, chef. »', ephemeral: true });
  }
  const region = interaction.options.getString('region') || profiles.DEFAULT_REGION;
  await interaction.deferReply({ ephemeral: true });

  let puuid = null;
  if (valorantStats.isConfigured()) {
    try {
      const rank = await valorantStats.getRank({ ...parsed, region }, { fresh: true });
      if (!rank) {
        return interaction.editReply(`❌ Compte **${safeName(parsed.name)}#${parsed.tag}** introuvable en région \`${region}\`. Vérifie l'orthographe et la région.`);
      }
      puuid = rank.puuid;
    } catch (err) {
      return interaction.editReply(`❌ ${statsErrorText(err)}`);
    }
  }

  const profile = profiles.setProfile(interaction.user.id, { ...parsed, region, puuid, source: 'manual' });
  return interaction.editReply(
    `✅ Compte lié : **${safeName(profiles.riotLabel(profile))}** (\`${region}\`). Tu apparaîtras dans les bilans de tes parties.\n` +
    `Profil : ${profiles.trackerUrl(profile)}\n*Retire-toi quand tu veux avec \`/valounlink\`.*`
  );
}

async function handleUnlinkCommand(interaction) {
  const removed = profiles.removeProfile(interaction.user.id);
  return interaction.reply({
    content: removed ? '🗑️ Compte Riot délié, tes données sont supprimées. « Parti sans laisser d\'adresse. »' : 'ℹ️ Aucun compte lié.',
    ephemeral: true
  });
}

module.exports = {
  captureBeforeStats,
  handleResultRequest,
  handleLinkCommand,
  handleUnlinkCommand,
  aggregate,
  selectSquadGames,
  buildResultEmbed
};
