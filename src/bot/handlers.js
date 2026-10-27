const { PermissionFlagsBits } = require('discord.js');
const sessionManager = require('../services/sessionManager');
const { buildSessionMessagePayload } = require('./embedBuilder');
const { buildCreateSessionModal } = require('./commands');
const { sanitizeNote } = require('../server/auth');

function isChannelAllowed(channelId) {
  const allowed = process.env.ALLOWED_CHANNEL_IDS;
  if (!allowed || !allowed.trim()) return true;
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean);
  return list.length === 0 || list.includes(channelId);
}

async function handleCommand(interaction, config = {}) {
  if (!isChannelAllowed(interaction.channelId)) {
    const list = process.env.ALLOWED_CHANNEL_IDS.split(',').map(s => s.trim()).filter(Boolean);
    const mentions = list.map(id => `<#${id}>`).join(', ');
    return interaction.reply({
      content: `⛔ **Channel Restricted:** Valobot commands are locked to ${mentions} on this server.`,
      ephemeral: true
    });
  }
  const partyTime = interaction.options.getString('party_time');
  const voteDeadline = interaction.options.getString('vote_deadline');
  const partySize = interaction.options.getInteger('party_size') || 5;
  const targetRole = interaction.options.getRole('target_role');
  const note = interaction.options.getString('note');

  // If no party_time provided, show the sender UI modal!
  if (!partyTime) {
    const modal = buildCreateSessionModal();
    return interaction.showModal(modal);
  }

  await interaction.deferReply();

  try {
    // Gather target members if a specific role was mentioned
    let targetMemberIds = [];
    if (targetRole && interaction.guild) {
      try {
        const members = await interaction.guild.members.fetch().catch(() => interaction.guild.roles.cache.get(targetRole.id)?.members || null);
        if (members) {
          targetMemberIds = members
            .filter(m => !m.user.bot && m.roles.cache.has(targetRole.id))
            .map(m => m.id);
        }
      } catch (err) {
        console.warn('Could not fetch guild members for role:', err.message);
      }
    }

    const session = sessionManager.createSession({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      creator: {
        id: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
        avatar: interaction.user.displayAvatarURL()
      },
      partyTime,
      voteDeadline,
      partySize,
      targetRoleId: targetRole ? targetRole.id : 'everyone',
      targetRoleName: targetRole ? targetRole.name : '@everyone',
      targetMemberIds,
      note: sanitizeNote(note)
    });

    const roster = sessionManager.calculateRosters(session);
    const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);

    // Initial content with ping
    const pingText = targetRole ? `<@&${targetRole.id}>` : '@everyone';
    payload.content = `🎮 **NEW VALORANT RECRUITMENT!** ${pingText} - A stacking party is forming!`;

    const message = await interaction.editReply(payload);
    session.messageId = message.id;
    session.channelId = interaction.channelId;
    session.guildId = interaction.guildId;
    sessionManager.persist();

  } catch (err) {
    console.error('Error handling command:', err);
    await interaction.editReply({
      content: `❌ Error creating session: ${err.message}`
    });
  }
}

async function handleModalSubmit(interaction, config = {}) {
  if (interaction.customId !== 'modal_create_session') return;
  if (!isChannelAllowed(interaction.channelId)) {
    return interaction.reply({
      content: '⛔ **Channel Restricted:** Valobot votes cannot be launched in this channel.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  const partyTime = interaction.fields.getTextInputValue('input_party_time');
  const voteDeadline = interaction.fields.getTextInputValue('input_vote_deadline') || null;
  const partySizeRaw = interaction.fields.getTextInputValue('input_party_size') || '5';
  const partySize = [2, 3, 5].includes(Number(partySizeRaw)) ? Number(partySizeRaw) : 5;
  const note = interaction.fields.getTextInputValue('input_note') || 'Valorant Stack';

  try {
    const session = sessionManager.createSession({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      creator: {
        id: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
        avatar: interaction.user.displayAvatarURL()
      },
      partyTime,
      voteDeadline,
      partySize,
      targetRoleId: 'everyone',
      targetRoleName: '@everyone',
      note: sanitizeNote(note)
    });

    const roster = sessionManager.calculateRosters(session);
    const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);
    payload.content = `🎮 **NEW VALORANT RECRUITMENT!** @everyone - Stacking session initiated!`;

    const message = await interaction.editReply(payload);
    session.messageId = message.id;
    session.channelId = interaction.channelId;
    session.guildId = interaction.guildId;
    sessionManager.persist();

  } catch (err) {
    console.error('Error handling modal:', err);
    await interaction.editReply({
      content: `❌ Error launching session: ${err.message}`
    });
  }
}

async function handleButton(interaction, config = {}) {
  const customId = interaction.customId;

  // 1. Voting buttons: vote_<type>_<sessionId>
  if (customId.startsWith('vote_')) {
    const parts = customId.split('_');
    let voteType = parts[1];
    let sessionId = parts.slice(2).join('_');

    // Handle "if_last" which has an underscore
    if (customId.startsWith('vote_if_last_')) {
      voteType = 'if_last';
      sessionId = customId.replace('vote_if_last_', '');
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return interaction.reply({
        content: '⚠️ Session not found or expired.',
        ephemeral: true
      });
    }

    if (session.status === 'cancelled') {
      return interaction.reply({
        content: '🚫 This session has been cancelled. No more votes are accepted.',
        ephemeral: true
      });
    }

    if (session.status === 'locked') {
      return interaction.reply({
        content: '🔒 Voting for this session is locked (deadline passed).',
        ephemeral: true
      });
    }

    const userObj = {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      avatar: interaction.user.displayAvatarURL()
    };

    try {
      // 1. Record the vote in sessionManager
      sessionManager.castVote(sessionId, userObj, voteType, { source: 'discord_button' });

      // 2. Guarantee session knows its exact channel & message
      session.channelId = interaction.channelId;
      session.messageId = interaction.message.id;
      session.guildId = interaction.guildId;
      sessionManager.persist();

      const labels = {
        sure: "🟢 I'm sure to be there",
        maybe: '🟡 Will try (Maybe)',
        if_last: '🟣 If a last (Filler)',
        backup: '🟠 If needed (Backup)',
        no: '🔴 No (Unavailable)',
        remove: '🗑️ Vote removed'
      };

      // 3. Ephemeral acknowledgment to the user
      await interaction.reply({
        content: `✅ Your vote was recorded: **${labels[voteType] || voteType}**`,
        ephemeral: true
      });

      // 4. Update the message directly on the channel
      await updateDiscordMessage(interaction.client, session, config, interaction.message);
    } catch (err) {
      console.error('Error casting vote:', err);
      if (!interaction.replied) {
        await interaction.reply({
          content: `❌ Could not record vote: ${err.message}`,
          ephemeral: true
        });
      }
    }
    return;
  }

  // 2. Cancel button: cancel_session_<sessionId>
  if (customId.startsWith('cancel_session_')) {
    const sessionId = customId.replace('cancel_session_', '');
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      return interaction.reply({
        content: '⚠️ Session not found.',
        ephemeral: true
      });
    }

    if (session.status === 'cancelled') {
      return interaction.reply({
        content: 'ℹ️ This session has already been cancelled.',
        ephemeral: true
      });
    }

    // Permission check: Host or Guild Admin
    const isCreator = interaction.user.id === session.creator.id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
                    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isCreator && !isAdmin) {
      return interaction.reply({
        content: `⛔ Permission denied: Only the session creator (<@${session.creator.id}>) or a server administrator can cancel this vote.`,
        ephemeral: true
      });
    }

    try {
      session.channelId = interaction.channelId;
      session.messageId = interaction.message.id;
      session.guildId = interaction.guildId;

      sessionManager.cancelSession(sessionId, {
        id: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.member?.displayName || interaction.user.username
      });

      await interaction.reply({
        content: '🛑 **Session Cancelled!** The message has been stamped CANCELLED in diagonal.',
        ephemeral: true
      });

      // Update message in channel with CANCELLED stamp
      await updateDiscordMessage(interaction.client, session, config, interaction.message);
    } catch (err) {
      console.error('Error cancelling session:', err);
      if (!interaction.replied) {
        await interaction.reply({
          content: `❌ Could not cancel session: ${err.message}`,
          ephemeral: true
        });
      }
    }
  }
}

async function updateDiscordMessage(client, session, config = {}, targetMessage = null) {
  try {
    let message = targetMessage;

    if (!message) {
      if (!session.channelId || !session.messageId) return;
      const channel = await client.channels.fetch(session.channelId).catch(() => null);
      if (!channel) return;
      message = await channel.messages.fetch(session.messageId).catch(() => null);
      if (!message) return;
    }

    const roster = sessionManager.calculateRosters(session);
    const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);

    if (session.status === 'cancelled') {
      payload.content = `🛑 **[SESSION CANCELLED]** Stacking vote aborted by <@${session.cancelledBy?.id || session.creator.id}>.`;
    } else if (session.status === 'locked') {
      const mentions = roster.team1.map(m => `<@${m.userId}>`).join(' ');
      payload.content = `🔒 **[VOTE CLOSED]** Squad ready! Match starts soon: ${mentions}`;
    }

    // Critical: payload.attachments = [] tells Discord API to discard old attachment and replace it
    payload.attachments = [];

    await message.edit(payload);
    console.log(`✅ [Discord Bot] Successfully updated message ${message.id} for session ${session.id}`);
  } catch (err) {
    console.error(`❌ [Discord Bot] Failed to update Discord message for session ${session.id}:`, err);
  }
}

module.exports = {
  handleCommand,
  handleModalSubmit,
  handleButton,
  updateDiscordMessage
};
