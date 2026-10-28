const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const { renderSessionBanner } = require('./stampRenderer');

function buildSessionMessagePayload(session, roster, webBaseUrl = 'https://valobot.example.com') {
  const partySize = session.partySize || 5;
  const isCancelled = session.status === 'cancelled';
  const isLocked = session.status === 'locked';

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
    embed.setTitle(`🚫 [CANCELLED] VALORANT ${partySize}-STACK SESSION`);
  } else if (isLocked) {
    embed.setTitle(`🔒 [VOTING CLOSED] VALORANT ${partySize}-STACK SESSION`);
  } else {
    embed.setTitle(`🎯 VALORANT RECRUITMENT • [${partySize}-STACK]`);
  }

  // Description
  const roleMention = session.targetRole?.id && session.targetRole.id !== 'everyone' ?
    `<@&${session.targetRole.id}>` :
    '@everyone';

  let desc = `**Target:** ${roleMention} • **Created by:** <@${session.creator.id}>\n`;
  desc += `**Mode / Note:** ${session.note || 'Competitive Stack'}\n`;

  if (isCancelled) {
    const byUser = session.cancelledBy ? `<@${session.cancelledBy.id}>` : 'Host';
    desc += `\n> ⚠️ **THIS SESSION HAS BEEN CANCELLED** by ${byUser}.\n> All voting has been terminated.\n`;
  } else if (isLocked) {
    desc += `\n> 🔒 **VOTING DEADLINE REACHED!** Final rosters are locked.\n`;
  }

  embed.setDescription(desc);

  // Time & Status fields
  embed.addFields(
    {
      name: '⏰ Match Start',
      value: `<t:${partyUnix}:t> (<t:${partyUnix}:R>)\n*(Host: ${session.partyTime})*`,
      inline: true
    },
    {
      name: '⏳ Vote Deadline',
      value: `<t:${deadlineUnix}:t> (<t:${deadlineUnix}:R>)\n*(Host: ${session.voteDeadline})*`,
      inline: true
    },
    {
      name: '🛡️ Stack Target',
      value: `**${roster.team1.length}/${partySize} Locked**`,
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
      const badge = isCreator ? ' *(Host)*' : (isFiller ? ' *(Filler)*' : '');
      team1Lines.push(`**${i + 1}.** 🟢 <@${member.userId}>${badge}`);
    } else {
      team1Lines.push(`**${i + 1}.** ⚪ *[Open Slot]*`);
    }
  }
  embed.addFields({
    name: `⚔️ TEAM 1 (${roster.team1.length}/${partySize})`,
    value: team1Lines.join('\n') || '*No players yet*',
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
        team2Lines.push(`**${i + 1}.** ⚪ *[Open Slot]*`);
      }
    }
    embed.addFields({
      name: `⚔️ TEAM 2 (${roster.team2.length}/${partySize})`,
      value: team2Lines.join('\n'),
      inline: false
    });
  }

  // Backup Queue
  if (roster.backups && roster.backups.length > 0) {
    const backupLines = roster.backups.map((m, idx) => `**${idx + 1}.** 🟠 <@${m.userId}>`);
    embed.addFields({
      name: `🎒 Reserves / Backups (${roster.backups.length})`,
      value: backupLines.join(', ') || 'None',
      inline: true
    });
  }

  // Maybe list
  if (roster.maybes && roster.maybes.length > 0) {
    const maybeLines = roster.maybes.map(m => `🟡 <@${m.userId}>`);
    embed.addFields({
      name: `🤔 Tentative / Maybe (${roster.maybes.length})`,
      value: maybeLines.join(', ') || 'None',
      inline: true
    });
  }

  // If a Last list (unassigned)
  if (roster.ifLastUnassigned && roster.ifLastUnassigned.length > 0) {
    const ifLastLines = roster.ifLastUnassigned.map(m => `🟣 <@${m.userId}>`);
    embed.addFields({
      name: `⚡ If a Last (${roster.ifLastUnassigned.length})`,
      value: ifLastLines.join(', ') || 'None',
      inline: true
    });
  }

  // Declined list
  if (roster.declined && roster.declined.length > 0) {
    const noLines = roster.declined.map(m => `🔴 <@${m.userId}>`);
    embed.addFields({
      name: `❌ Unavailable (${roster.declined.length})`,
      value: noLines.join(', ') || 'None',
      inline: true
    });
  }

  // Unresponsive / Didn't respond list
  if (roster.unresponsive && roster.unresponsive.length > 0) {
    const maxShow = 8;
    const shown = roster.unresponsive.slice(0, maxShow).map(id => `<@${id}>`);
    const extra = roster.unresponsive.length > maxShow ? ` +${roster.unresponsive.length - maxShow} more` : '';
    embed.addFields({
      name: `⏳ Didn't Respond (${roster.unresponsive.length})`,
      value: `${shown.join(', ')}${extra}`,
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
      .setLabel("I'm sure to be there")
      .setStyle(ButtonStyle.Success)
      .setEmoji('🟢')
      .setDisabled(isCancelled || isLocked),
    new ButtonBuilder()
      .setCustomId(`vote_maybe_${session.id}`)
      .setLabel('Will try (Maybe)')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🟡')
      .setDisabled(isCancelled || isLocked),
    new ButtonBuilder()
      .setCustomId(`vote_if_last_${session.id}`)
      .setLabel('If a last')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🟣')
      .setDisabled(isCancelled || isLocked),
    new ButtonBuilder()
      .setCustomId(`vote_backup_${session.id}`)
      .setLabel('If needed (Backup)')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🟠')
      .setDisabled(isCancelled || isLocked),
    new ButtonBuilder()
      .setCustomId(`vote_no_${session.id}`)
      .setLabel('No')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴')
      .setDisabled(isCancelled || isLocked)
  );

  // Management & Dashboard Row
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote_remove_${session.id}`)
      .setLabel('Clear Vote')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🗑️')
      .setDisabled(isCancelled || isLocked),
    new ButtonBuilder()
      .setCustomId(`cancel_session_${session.id}`)
      .setLabel(isCancelled ? 'Cancelled' : 'Cancel Vote')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🛑')
      .setDisabled(isCancelled),
    new ButtonBuilder()
      .setLabel('Web Dashboard')
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
