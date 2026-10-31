const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const { renderSessionBanner } = require('./stampRenderer');

// Embed field values are capped at 1024 chars: show as many mentions as fit, then "+N"
function joinMentions(ids, prefix = '') {
  const LIMIT = 1000;
  const parts = [];
  let length = 0;
  for (let i = 0; i < ids.length; i++) {
    const item = `${prefix}<@${ids[i]}>`;
    const remaining = ids.length - i - 1;
    const reserve = remaining > 0 ? 12 : 0;
    if (length + item.length + 2 + reserve > LIMIT) {
      parts.push(`… +${ids.length - i}`);
      break;
    }
    parts.push(item);
    length += item.length + 2;
  }
  return parts.join(', ') || 'None';
}

function buildSessionMessagePayload(session, roster, webBaseUrl = 'https://valobot.example.com') {
  const partySize = session.partySize || 5;
  const isCancelled = session.status === 'cancelled';
  const isLocked = session.status === 'locked';
  // Votes stay open after the deadline until the real match time
  const votingClosed = isCancelled || Boolean(session.partyStartSent) ||
    (isLocked && Date.now() >= session.partyTimestamp);

  const partyUnix = Math.floor(session.partyTimestamp / 1000);
  const deadlineUnix = Math.floor(session.voteDeadlineTimestamp / 1000);

  // Generate dynamic canvas banner with timestamped filename to bust Discord client cache
  const bannerBuffer = renderSessionBanner(session, roster, isCancelled);
  const bannerFileName = `valo_banner_${Date.now()}.png`;
  const bannerAttachment = new AttachmentBuilder(bannerBuffer, { name: bannerFileName });

  // Embed Color
  let embedColor = 0xff4655; // Valorant Red
  if (isCancelled) embedColor = 0x2b141a; // Dark cancelled red
  else if (isLocked) embedColor = 0xf5a623; // Amber
  else if (roster.team1.length >= partySize) embedColor = 0x00f59b; // Mint green (ready!)

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setImage(`attachment://${bannerFileName}`);

  // Title
  if (isCancelled) {
    embed.setTitle(`🚫 [ANNULÉ] SESSION VALORANT ${partySize}-STACK`);
  } else if (votingClosed) {
    embed.setTitle(`🏁 [MATCH LANCÉ] SESSION VALORANT ${partySize}-STACK`);
  } else if (isLocked) {
    embed.setTitle(`⏳ [DEADLINE PASSÉE] SESSION VALORANT ${partySize}-STACK`);
  } else {
    embed.setTitle(`🎯 RECRUTEMENT VALORANT • [${partySize}-STACK]`);
  }

  // Description
  const roleMention = session.targetRole?.id && session.targetRole.id !== 'everyone' ?
    `<@&${session.targetRole.id}>` :
    '@everyone';

  let desc = `**Cible :** ${roleMention} • **Organisé par :** <@${session.creator.id}>\n`;
  desc += `**Mode / Note :** ${session.note || 'Competitive Stack'}\n`;

  if (isCancelled) {
    if (session.cancelReason === 'not_enough_players') {
      desc += `\n> ⚠️ **SESSION ANNULÉE AUTOMATIQUEMENT** : pas assez de joueurs au moment du match.\n> « Et c'est le drame. »\n`;
    } else {
      const byUser = session.cancelledBy && /^\d+$/.test(session.cancelledBy.id) ? `<@${session.cancelledBy.id}>` : 'l\'hôte';
      desc += `\n> ⚠️ **SESSION ANNULÉE** par ${byUser}.\n> « Et c'est le drame. » Les votes sont terminés.\n`;
    }
  } else if (votingClosed) {
    desc += `\n> 🏁 **Le match a commencé.** Les votes sont clos. « GG WP »\n`;
  } else if (isLocked) {
    desc += `\n> ⏳ **Deadline dépassée**, mais les retardataires sont acceptés jusqu'au match. « Better late than never »\n`;
  }

  embed.setDescription(desc);

  // Time & Status fields
  embed.addFields(
    {
      name: '⏰ Début du match',
      value: `<t:${partyUnix}:t> (<t:${partyUnix}:R>)\n*(Hôte : ${session.partyTime})*`,
      inline: true
    },
    {
      name: '⏳ Deadline des votes',
      value: `<t:${deadlineUnix}:t> (<t:${deadlineUnix}:R>)\n*(Hôte : ${session.voteDeadline})*`,
      inline: true
    },
    {
      name: '🛡️ Squad',
      value: `**${roster.team1.length}/${partySize} en place**`,
      inline: true
    }
  );

  // Team 1 Lineup
  const team1Lines = [];
  for (let i = 0; i < partySize; i++) {
    const member = roster.team1[i];
    if (member) {
      const isCreator = member.userId === session.creator.id;
      const isFiller = member.status === 'if_last';
      const isBackup = member.status === 'backup';
      const badge = isCreator ? ' *(Hôte)*' : (isFiller ? ' *(Bouche-trou)*' : (isBackup ? ' *(Remplaçant)*' : ''));
      team1Lines.push(`**${i + 1}.** 🟢 <@${member.userId}>${badge}`);
    } else {
      team1Lines.push(`**${i + 1}.** ⚪ *[Place libre — « Il est où le ${i + 1}ème ? »]*`);
    }
  }
  embed.addFields({
    name: `⚔️ ÉQUIPE 1 (${roster.team1.length}/${partySize})`,
    value: team1Lines.join('\n') || '*Personne... « C\'est le désert »*',
    inline: false
  });

  // Team 2 Lineup (if exists!)
  if (roster.team2 && roster.team2.length > 0) {
    const team2Lines = [];
    for (let i = 0; i < partySize; i++) {
      const member = roster.team2[i];
      if (member) {
        team2Lines.push(`**${i + 1}.** 🟢 <@${member.userId}>`);
      } else {
        team2Lines.push(`**${i + 1}.** ⚪ *[Place libre]*`);
      }
    }
    embed.addFields({
      name: `⚔️ ÉQUIPE 2 (${roster.team2.length}/${partySize})`,
      value: team2Lines.join('\n'),
      inline: false
    });
  }

  // Backup Queue
  if (roster.backups && roster.backups.length > 0) {
    const backupValue = joinMentions(roster.backups.map(m => m.userId), '🟠 ');
    embed.addFields({
      name: `🎒 Banc de touche (${roster.backups.length})`,
      value: backupValue,
      inline: true
    });
  }

  // Maybe list
  if (roster.maybes && roster.maybes.length > 0) {
    const maybeValue = joinMentions(roster.maybes.map(m => m.userId), '🟡 ');
    embed.addFields({
      name: `🤔 Peut-être (${roster.maybes.length}) 🐇`,
      value: maybeValue,
      inline: true
    });
  }

  // If a Last list (unassigned)
  if (roster.ifLastUnassigned && roster.ifLastUnassigned.length > 0) {
    const ifLastValue = joinMentions(roster.ifLastUnassigned.map(m => m.userId), '🟣 ');
    embed.addFields({
      name: `⚡ Si dernier recours (${roster.ifLastUnassigned.length})`,
      value: ifLastValue,
      inline: true
    });
  }

  // Declined list
  if (roster.declined && roster.declined.length > 0) {
    const noValue = joinMentions(roster.declined.map(m => m.userId), '🔴 ');
    embed.addFields({
      name: `❌ Indispo / Lâches (${roster.declined.length})`,
      value: noValue,
      inline: true
    });
  }

  // Unresponsive / Didn't respond list
  if (roster.unresponsive && roster.unresponsive.length > 0) {
    const shown = joinMentions(roster.unresponsive);
    embed.addFields({
      name: `👻 Aux abonnés absents (${roster.unresponsive.length})`,
      value: shown,
      inline: false
    });
  }

  embed.setFooter({
    text: `Session ID: ${session.id} • Valobot by Nytuo`
  });
  embed.setTimestamp(new Date(session.createdAt));

  // Interactive Buttons
  const components = [];

  // Voting Row
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote_sure_${session.id}`)
      .setLabel("Je suis chaud")
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔥')
      .setDisabled(votingClosed),
    new ButtonBuilder()
      .setCustomId(`vote_maybe_${session.id}`)
      .setLabel('Je tente (peut-être)')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🤞')
      .setDisabled(votingClosed),
    new ButtonBuilder()
      .setCustomId(`vote_if_last_${session.id}`)
      .setLabel('Si dernier recours')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🦸')
      .setDisabled(votingClosed),
    new ButtonBuilder()
      .setCustomId(`vote_backup_${session.id}`)
      .setLabel('Remplaçant')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🎒')
      .setDisabled(votingClosed),
    new ButtonBuilder()
      .setCustomId(`vote_no_${session.id}`)
      .setLabel('Nan, flemme')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🏃')
      .setDisabled(votingClosed)
  );

  // Management & Dashboard Row
  const statsEnabled = Boolean(process.env.HENRIK_API_KEY) && votingClosed && !isCancelled;
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote_remove_${session.id}`)
      .setLabel('Effacer mon vote')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🗑️')
      .setDisabled(votingClosed),
    new ButtonBuilder()
      .setCustomId(`cancel_session_${session.id}`)
      .setLabel(isCancelled ? 'Annulé' : 'Annuler')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🙅')
      .setDisabled(isCancelled),
    ...(statsEnabled ? [
      new ButtonBuilder()
        .setCustomId(`result_${session.id}`)
        .setLabel('Résultats')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📊')
    ] : []),
    new ButtonBuilder()
      .setLabel('Dashboard web')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webBaseUrl.replace(/\/$/, '')}/#session-${session.id}`)
      .setEmoji('🌐')
  );

  components.push(row1, row2);

  return {
    embeds: [embed],
    components,
    files: [bannerAttachment],
    attachments: [] // Important: clears previous attachments on message.edit
  };
}

module.exports = {
  buildSessionMessagePayload
};
