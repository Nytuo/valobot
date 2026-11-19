const { EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { renderAgentsImage } = require('./agentsImage');
const sessionManager = require('../services/sessionManager');
const profiles = require('../services/profiles');
const valorantStats = require('../services/valorantStats');
const phrases = require('./phrases');
const S = phrases.stats;
const { safeName } = require('../server/auth');

const EARLY_START_MS = 5 * 60 * 1000; // games launched a bit before the planned time still count
const RESULT_COOLDOWN_MS = 45 * 1000;
const MATCH_HISTORY_GAP_MS = 50 * 60 * 1000;
const MAX_FALLBACK_MATCH_HISTORIES = 2;
const NO_MENTIONS = { parse: [] };
const FOOTER = S.footer;

const inFlight = new Set();

function sessionPlayerIds(session) {
  const roster = sessionManager.calculateRosters(session);
  return [...new Set(roster.teams.flat().map(p => p.userId))];
}

const rankLine = (rank) => rank
  ? `**${safeName(rank.tier)}**${rank.rr !== null ? ` (${rank.rr} RR)` : ''}`
  : S.unknownRank;

function statsErrorText(err) {
  if (err?.code === 'rate_limited') return S.errRateLimited(Math.max(1, Math.ceil((err.retryAfterMs || 60_000) / 1000)));
  if (err?.code === 'unauthorized') return S.errUnauthorized;
  return S.errUnavailable;
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
        lines.push(S.notLinked(userId));
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
          .setTitle(S.beforeTitle)
          .setDescription(`${phrases.pick(phrases.statsBefore)}\n\n${lines.join('\n')}`)
          .addFields({
            name: S.whenDoneName,
            value: S.whenDoneValue
          })
          .setFooter({ text: FOOTER })
      ]
    });
  } catch (err) {
    console.error(`❌ [Stats] Failed to capture before-stats for ${session.id}:`, err);
  }
}

// ---------- AFTER: aggregation ----------
const isCompetitive = (m) => m.queueId === 'competitive';

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

function hasMatchHistoryGap(perPlayerMatches, sinceMs, untilMs) {
  const startedAt = [...new Set(
    [...perPlayerMatches.values()].flatMap(matches => [...matches.values()].map(match => match.startedAt))
  )].sort((a, b) => a - b);

  let previous = sinceMs;
  for (const time of startedAt) {
    if (time - previous >= MATCH_HISTORY_GAP_MS) return true;
    previous = time;
  }
  return Math.max(sinceMs, untilMs) - previous >= MATCH_HISTORY_GAP_MS;
}

async function buildResultEmbed(session, { allModes = false } = {}) {
  const historyEndMs = Date.now();
  const stats = session.stats || { since: session.partyTimestamp - EARLY_START_MS, before: {}, players: sessionPlayerIds(session) };
  const playerIds = stats.players?.length ? stats.players : sessionPlayerIds(session);
  const linked = playerIds.map(id => ({ id, profile: profiles.getProfile(id) })).filter(p => p.profile);

  const after = new Map();
  for (const { id, profile } of linked) {
    after.set(id, await valorantStats.getRank(profile, { fresh: true }).catch(err => { if (err.code === 'rate_limited') throw err; return null; }));
  }

  const matchesByPlayer = new Map(linked.map(({ id }) => [id, new Map()]));
  if (linked.length > 0) {
    const anchor = linked.find(({ id }) => id === session.creator.id) || linked[0];
    const candidates = [anchor, ...linked.filter(player => player !== anchor)];
    const squadProfiles = linked.map(({ profile }) => profile);
    let historiesFetched = 0;

    for (const candidate of candidates) {
      if (historiesFetched > 0 && !hasMatchHistoryGap(matchesByPlayer, stats.since, historyEndMs)) break;
      const history = await valorantStats.getSquadMatchesSince(candidate.profile, squadProfiles, stats.since);
      for (const { id, profile } of linked) {
        for (const match of history.get(profile) || []) {
          matchesByPlayer.get(id).set(match.matchId, match);
        }
      }
      historiesFetched++;
      if (historiesFetched >= 1 + MAX_FALLBACK_MATCH_HISTORIES) break;
    }
  }

  const perPlayer = new Map([...matchesByPlayer.entries()].map(([id, matches]) => {
    const playerMatches = [...matches.values()];
    return [id, allModes ? playerMatches : playerMatches.filter(isCompetitive)];
  }));
  const games = selectSquadGames(perPlayer);
  const gameIds = new Set(games.map(([matchId]) => matchId));

  const embed = new EmbedBuilder().setColor(0xff4655).setTitle(S.resultTitle).setFooter({ text: FOOTER });

  if (linked.length === 0) {
    return { embed: embed.setDescription(S.nobodyLinked), files: [] };
  }
  if (games.length === 0) {
    return { embed: embed.setDescription(S.noGames(allModes)), files: [] };
  }

  const gameLines = games.slice(-10).map(([, g], i) => {
    const m = g.sample;
    const icon = m.won === true ? '✅' : (m.won === false ? '❌' : '🤝');
    return `**${i + 1}.** 🗺️ ${safeName(m.map)} · ${icon} ${m.score || ''} ${m.queue ? `· ${safeName(m.queue)}` : ''}`.trim();
  });
  embed.addFields({ name: S.gamesPlayed(games.length), value: gameLines.join('\n').slice(0, 1024) });

  const summaries = [];
  const agentRows = [];
  for (const { id, profile } of linked) {
    const mine = (perPlayer.get(id) || []).filter(m => gameIds.has(m.matchId));
    const agg = aggregate(mine);
    const rankBefore = stats.before?.[id] || null;
    const rankAfter = after.get(id) || null;

    let rankText = rankAfter ? rankLine(rankAfter) : S.unknownRank;
    if (rankBefore && rankAfter) {
      const delta = rankBefore.elo !== null && rankAfter.elo !== null ? rankAfter.elo - rankBefore.elo : null;
      rankText = `${rankLine(rankBefore)} → ${rankLine(rankAfter)}${delta !== null ? ` · **${delta >= 0 ? '+' : ''}${delta} RR**` : ''}`;
    }

    const value = agg.games === 0
      ? `${S.rankLabel(rankText)}\n${S.noSquadGame}`
      : [
        S.rankLabel(rankText),
        S.gamesLine(agg.games, agg.wins, agg.losses),
        S.kdaLine(agg.kills, agg.deaths, agg.assists, agg.kda),
        S.avgLine(agg.acs, agg.adr, agg.hs)
      ].join('\n');

    embed.addFields({ name: `🎯 ${safeName(profiles.riotLabel(profile))}`, value: value.slice(0, 1024) });
    if (agg.games > 0) {
      summaries.push({ id, agg });
      agentRows.push({
        label: profile.name,
        games: [...mine].sort((a, b) => a.startedAt - b.startedAt).map(m => ({ iconUrl: m.agentIcon, agent: m.agent, won: m.won }))
      });
    }
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
    embed.addFields({ name: S.noStatsFor, value: S.noStatsForValue(unlinked) });
  }
  // Agents played by each player, stacked inline at the very end
  const files = [];
  try {
    const png = await renderAgentsImage(agentRows);
    if (png) {
      files.push(new AttachmentBuilder(png, { name: 'agents.png' }));
      embed.addFields({ name: S.agentsField, value: S.agentsValue });
      embed.setImage('attachment://agents.png');
    }
  } catch (err) {
    console.warn('⚠️ [Stats] Could not render agents image:', err.message);
  }
  return { embed, files };
}

// ---------- AFTER: entry point (button + /valoresult) ----------
function canRequestResults(interaction, session) {
  if (interaction.user.id === session.creator.id) return true;
  if (sessionPlayerIds(session).includes(interaction.user.id)) return true;
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

async function handleResultRequest(interaction, sessionIdFromButton = null) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: S.guildOnly, ephemeral: true });
  }
  if (!valorantStats.isConfigured()) {
    return interaction.reply({ content: S.notEnabled, ephemeral: true });
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
    return interaction.reply({ content: S.noSession, ephemeral: true });
  }
  if (session.status === 'cancelled') {
    return interaction.reply({ content: S.sessionCancelled, ephemeral: true });
  }
  if (!session.partyStartSent) {
    return interaction.reply({ content: S.notStarted, ephemeral: true });
  }
  if (!canRequestResults(interaction, session)) {
    return interaction.reply({ content: S.notAllowed, ephemeral: true });
  }

  session.stats = session.stats || { startedAt: Date.now(), since: session.partyTimestamp - EARLY_START_MS, players: sessionPlayerIds(session), before: {}, lastResultAt: 0 };
  const wait = session.stats.lastResultAt + RESULT_COOLDOWN_MS - Date.now();
  if (inFlight.has(session.id) || wait > 0) {
    return interaction.reply({ content: S.cooldown(Math.max(5, Math.ceil(wait / 1000))), ephemeral: true });
  }

  inFlight.add(session.id);
  session.stats.lastResultAt = Date.now();
  try {
    await interaction.deferReply();
    const allModes = interaction.isChatInputCommand?.() ? Boolean(interaction.options.getBoolean('all')) : false;
    const { embed, files } = await buildResultEmbed(session, { allModes });
    sessionManager.persist();
    await interaction.editReply({ embeds: [embed], files, allowedMentions: NO_MENTIONS });
  } catch (err) {
    console.error(`❌ [Stats] Result report failed for ${session.id}:`, err.code || err.message);
    session.stats.lastResultAt = 0; // let them retry right away
    await interaction.editReply({ content: S.failed(statsErrorText(err)), embeds: [] }).catch(() => {});
  } finally {
    inFlight.delete(session.id);
  }
}

// ---------- /valolink and /valounlink ----------
async function handleLinkCommand(interaction, config = {}) {
  const rawRiotId = interaction.options.getString('riot_id');

  const parsed = profiles.parseRiotId(rawRiotId);
  if (!parsed) {
    return interaction.reply({ content: S.invalidRiotId, ephemeral: true });
  }
  const region = interaction.options.getString('region') || profiles.DEFAULT_REGION;
  await interaction.deferReply({ ephemeral: true });

  let puuid = null;
  if (valorantStats.isConfigured()) {
    try {
      const rank = await valorantStats.getRank({ ...parsed, region }, { fresh: true });
      if (!rank) {
        return interaction.editReply(S.accountNotFound(safeName(parsed.name), parsed.tag, region));
      }
      puuid = rank.puuid;
    } catch (err) {
      return interaction.editReply(S.failed(statsErrorText(err)));
    }
  }

  const profile = profiles.setProfile(interaction.user.id, { ...parsed, region, puuid, source: 'manual' });
  return interaction.editReply(S.linked(safeName(profiles.riotLabel(profile)), region, profiles.trackerUrl(profile)));
}

async function handleUnlinkCommand(interaction) {
  const removed = profiles.removeProfile(interaction.user.id);
  return interaction.reply({
    content: removed ? S.unlinked : S.notLinkedInfo,
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
