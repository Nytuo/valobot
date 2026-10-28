const {
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
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

// Parse free-form ping settings from modal (e.g. "everyone, 30m", "only on time, 15m", "role, off", "none")
function parsePingSettingsInput(input = '') {
  const text = String(input).toLowerCase().trim();
  let pingTarget = 'everyone';
  let reminderPrior = '30m';

  if (text.includes('only on time') || text.includes('ontime') || text.includes('on time')) {
    pingTarget = 'only_on_time';
  } else if (text.includes('role')) {
    pingTarget = 'role';
  } else if (text.includes('none') || text.includes('silent') || text.includes('no ping')) {
    pingTarget = 'none';
  } else if (text.includes('everyone') || text.includes('all')) {
    pingTarget = 'everyone';
  }

  if (text.includes('off') || text.includes('disable') || text.includes('no reminder')) {
    reminderPrior = 'off';
  } else {
    const timeMatch = text.match(/(\d+)\s*(m|min|mins|h|hr|hours)/i);
    if (timeMatch) {
      reminderPrior = `${timeMatch[1]}${timeMatch[2].startsWith('h') ? 'h' : 'm'}`;
    }
  }

  return { pingTarget, reminderPrior };
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
  const pingTarget = interaction.options.getString('ping_target') || 'everyone';
  const reminderPrior = interaction.options.getString('reminder_prior') || '30m';

  // If no party_time provided, show the sender UI modal!
  if (!partyTime) {
    const modal = buildCreateSessionModal();
    return interaction.showModal(modal);
  }

  const parsedPartyDate = sessionManager.parseTimeString(partyTime);
  if (!parsedPartyDate) {
    return interaction.reply({
      content: `❌ **Invalid Match Time:** \`${partyTime}\` could not be recognized.\n💡 **Allowed examples:** \`21:00\`, \`in 30m\`, \`in 1h\`, \`tomorrow 20:30\`, \`now\`, or pick from the autocomplete suggestions.`,
      ephemeral: true
    });
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
            .filter(m => !m.user?.bot && m.roles.cache.has(targetRole.id))
            .map(m => m.id);
        }
      } catch (err) {
        console.warn('Could not fetch guild members for role:', err.message);
      }
    }

    // If no specific role filter was specified, register channel members as target candidates
    if (targetMemberIds.length === 0 && interaction.channel?.members) {
      targetMemberIds = interaction.channel.members
        .filter(m => !m.user?.bot)
        .map(m => m.id);
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
      pingTarget,
      reminderPrior,
      note: sanitizeNote(note)
    });

    const roster = sessionManager.calculateRosters(session);
    const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);

    // Initial content with customizable ping target
    let pingText = '';
    if (pingTarget === 'none' || pingTarget === 'only_on_time') {
      pingText = '';
    } else if (pingTarget === 'role' && targetRole && targetRole.id !== 'everyone') {
      pingText = `<@&${targetRole.id}>`;
    } else {
      pingText = targetRole && targetRole.id !== 'everyone' ? `<@&${targetRole.id}>` : '@everyone';
    }

    payload.content = pingText
      ? `🎮 **NEW VALORANT RECRUITMENT!** ${pingText} - A stacking party is forming!`
      : `🎮 **NEW VALORANT RECRUITMENT!** A stacking party is forming! *(Notifications: ${pingTarget === 'only_on_time' ? 'only on time' : 'silent'})*`;

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
  const parsedPartyDate = sessionManager.parseTimeString(partyTime);
  if (!parsedPartyDate) {
    return interaction.editReply({
      content: `❌ **Invalid Match Time:** \`${partyTime}\` could not be recognized.\n💡 **Allowed examples:** \`21:00\`, \`in 30m\`, \`in 1h\`, \`tomorrow 20:30\`, \`now\`.`
    });
  }
  const voteDeadline = interaction.fields.getTextInputValue('input_vote_deadline') || null;
  const partySizeRaw = interaction.fields.getTextInputValue('input_party_size') || '5';
  const partySize = [2, 3, 5].includes(Number(partySizeRaw)) ? Number(partySizeRaw) : 5;
  const note = interaction.fields.getTextInputValue('input_note') || 'Valorant Stack';
  let rawPingSettings = '';
  try {
    rawPingSettings = interaction.fields.getTextInputValue('input_ping_settings') || '';
  } catch (e) {}
  const { pingTarget, reminderPrior } = parsePingSettingsInput(rawPingSettings);

  try {
    let targetMemberIds = [];
    if (interaction.channel?.members) {
      targetMemberIds = interaction.channel.members
        .filter(m => !m.user?.bot)
        .map(m => m.id);
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
      targetRoleId: 'everyone',
      targetRoleName: '@everyone',
      targetMemberIds,
      pingTarget,
      reminderPrior,
      note: sanitizeNote(note)
    });

    const roster = sessionManager.calculateRosters(session);
    const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);

    let pingText = '';
    if (pingTarget === 'none' || pingTarget === 'only_on_time') {
      pingText = '';
    } else {
      pingText = '@everyone';
    }

    payload.content = pingText
      ? `🎮 **NEW VALORANT RECRUITMENT!** ${pingText} - Stacking session initiated!`
      : `🎮 **NEW VALORANT RECRUITMENT!** Stacking session initiated! *(Notifications: ${pingTarget === 'only_on_time' ? 'only on time' : 'silent'})*`;

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

async function getUnresponsiveChannelMembers(client, session, channel = null) {
  try {
    if (!channel) {
      if (!session.channelId) return [];
      channel = await client.channels.fetch(session.channelId).catch(() => null);
    }
    if (!channel || !channel.isTextBased()) return [];

    const candidateUserIds = new Set();

    // 1. Target members if saved during creation (e.g. role members or channel members)
    if (Array.isArray(session.targetMemberIds)) {
      for (const id of session.targetMemberIds) {
        if (id) candidateUserIds.add(id);
      }
    }

    // 2. Members with permission to view this channel (from cache)
    if (channel.members) {
      for (const [memberId, member] of channel.members) {
        if (!member.user?.bot) {
          candidateUserIds.add(memberId);
        }
      }
    }

    // 3. Scan recent channel messages to catch active human members
    try {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (recent) {
        for (const msg of recent.values()) {
          if (!msg.author?.bot) {
            candidateUserIds.add(msg.author.id);
          }
        }
      }
    } catch (e) {}

    // 4. Exclude bot itself, the host, and anyone who has already voted
    const votedUserIds = new Set(Object.keys(session.votes || {}));
    if (client.user?.id) votedUserIds.add(client.user.id);
    if (session.creator?.id) votedUserIds.add(session.creator.id);

    const unresponsive = [];
    for (const userId of candidateUserIds) {
      if (!votedUserIds.has(userId)) {
        unresponsive.push(userId);
      }
    }

    return unresponsive;
  } catch (err) {
    console.error('Error fetching unresponsive channel members:', err);
    return [];
  }
}

async function sendChannelReminder(client, session, config = {}) {
  try {
    if (!session.channelId || session.status !== 'active') return;
    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const unresponsiveIds = await getUnresponsiveChannelMembers(client, session, channel);
    if (!unresponsiveIds || unresponsiveIds.length === 0) {
      console.log(`ℹ️ [Reminder] All users have responded for session ${session.id}; skipping reminder ping.`);
      return;
    }

    const partyUnix = Math.floor(session.partyTimestamp / 1000);
    const roster = sessionManager.calculateRosters(session);
    const partySize = session.partySize || 5;
    const lockedCount = roster.team1.length;

    const reminderMins = session.reminderPrior ? parseInt(session.reminderPrior, 10) || 30 : 30;
    const reminderLabel = reminderMins >= 60 ? `${Math.floor(reminderMins / 60)} hour(s)` : `${reminderMins} minutes`;

    const messageUrl = (session.guildId && session.channelId && session.messageId) ?
      `https://discord.com/channels/${session.guildId}/${session.channelId}/${session.messageId}` :
      null;

    const embed = new EmbedBuilder()
      .setColor(0xff4655)
      .setTitle(`⏰ MATCH IN ${reminderLabel.toUpperCase()} — AWAITING YOUR RESPONSE`)
      .setDescription(
        `The Valorant recruitment session **"${session.note || 'Competitive Stack'}"** begins in **${reminderLabel}** (<t:${partyUnix}:R>)!\n\n` +
        `🛡️ **Current Lineup:** **${lockedCount}/${partySize} Locked**\n` +
        `⏰ **Match Start:** <t:${partyUnix}:t> (<t:${partyUnix}:F>)\n\n` +
        `Please cast your vote so the squad can lock in the roster!`
      )
      .setFooter({ text: `Valobot Reminder Protocol • Auto-ping ${reminderLabel} prior` });

    const components = [];
    if (messageUrl) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('👉 Jump to Session & Vote')
          .setStyle(ButtonStyle.Link)
          .setURL(messageUrl)
      );
      components.push(row);
    }

    // Chunk mentions into batches of 50 to respect Discord limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < unresponsiveIds.length; i += CHUNK_SIZE) {
      const chunk = unresponsiveIds.slice(i, i + CHUNK_SIZE);
      const mentions = chunk.map(id => `<@${id}>`).join(' ');
      await channel.send({
        content: `🔔 ${mentions}`,
        embeds: i === 0 ? [embed] : [],
        components: i === 0 ? components : []
      });
    }

    console.log(`📢 [Discord Bot] Pinged ${unresponsiveIds.length} unresponsive user(s) 30m prior to session ${session.id}`);
  } catch (err) {
    console.error(`❌ [Discord Bot] Failed to send 30m reminder for session ${session.id}:`, err);
  }
}

async function handleAutocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    const query = (focused.value || '').toLowerCase().trim();

    if (focused.name === 'party_time') {
      const presets = [
        { name: 'now (Start match immediately)', value: 'now' },
        { name: 'in 15m (+15 minutes from now)', value: 'in 15m' },
        { name: 'in 30m (+30 minutes from now)', value: 'in 30m' },
        { name: 'in 45m (+45 minutes from now)', value: 'in 45m' },
        { name: 'in 1h (+1 hour from now)', value: 'in 1h' },
        { name: 'in 2h (+2 hours from now)', value: 'in 2h' },
        { name: '19:00 (Today at 19:00)', value: '19:00' },
        { name: '20:00 (Today at 20:00)', value: '20:00' },
        { name: '20:30 (Today at 20:30)', value: '20:30' },
        { name: '21:00 (Today at 21:00 - Prime time)', value: '21:00' },
        { name: '21:30 (Today at 21:30)', value: '21:30' },
        { name: '22:00 (Today at 22:00)', value: '22:00' },
        { name: '22:30 (Today at 22:30)', value: '22:30' },
        { name: '23:00 (Today at 23:00)', value: '23:00' },
        { name: 'tomorrow 20:00 (Tomorrow at 20:00)', value: 'tomorrow 20:00' },
        { name: 'tomorrow 21:00 (Tomorrow at 21:00)', value: 'tomorrow 21:00' },
        { name: 'tomorrow 22:00 (Tomorrow at 22:00)', value: 'tomorrow 22:00' }
      ];

      const filtered = query
        ? presets.filter(p => p.name.toLowerCase().includes(query) || p.value.toLowerCase().includes(query))
        : presets;

      await interaction.respond(filtered.slice(0, 25));
    } else if (focused.name === 'vote_deadline') {
      const presets = [
        { name: '15m before (Default - 15 mins prior to match)', value: '15m before' },
        { name: '5m before (5 mins prior to match)', value: '5m before' },
        { name: '10m before (10 mins prior to match)', value: '10m before' },
        { name: '30m before (30 mins prior to match)', value: '30m before' },
        { name: '45m before (45 mins prior to match)', value: '45m before' },
        { name: '1h before (1 hour prior to match)', value: '1h before' },
        { name: 'in 15m (+15 mins from now)', value: 'in 15m' },
        { name: 'in 30m (+30 mins from now)', value: 'in 30m' }
      ];

      const filtered = query
        ? presets.filter(p => p.name.toLowerCase().includes(query) || p.value.toLowerCase().includes(query))
        : presets;

      await interaction.respond(filtered.slice(0, 25));
    }
  } catch (err) {
    console.error('Error handling autocomplete:', err);
  }
}

module.exports = {
  handleCommand,
  handleModalSubmit,
  handleButton,
  updateDiscordMessage,
  sendChannelReminder,
  getUnresponsiveChannelMembers,
  parsePingSettingsInput,
  handleAutocomplete
};
