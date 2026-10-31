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
const { sanitizeNote, safeName } = require('../server/auth');
const phrases = require('./phrases');
const { handleResultRequest } = require('./statsReport');
const { pickMeme } = require('./memes');

const reminderMemeUrls = [
  'https://klipy.com/gifs/psyhodelik-psyhodelik-vous-etes-ou-1',
  'https://klipy.com/gifs/avengers-assemble-11',
  'https://klipy.com/gifs/tpmp-paf-21'
];

const flopMemeUrls = [
  'https://klipy.com/gifs/lilm3gan',
  'https://klipy.com/gifs/flop-flops',
  'https://klipy.com/gifs/lalakers-los-angeles'
];

// Decide who may be pinged by a new session. Pings are only honoured if the invoking member
// could have sent them themselves (MentionEveryone / mentionable role), so the bot can't be used to bypass permissions.
function resolvePing(interaction, pingTarget, targetRole) {
  const none = { pingText: '', allowedMentions: { parse: [] } };
  if (pingTarget === 'none' || pingTarget === 'only_on_time') return none;

  const perms = interaction.memberPermissions;
  const canMentionEveryone = Boolean(perms?.has(PermissionFlagsBits.MentionEveryone) || perms?.has(PermissionFlagsBits.Administrator));

  if (targetRole && targetRole.id !== interaction.guildId) {
    if (canMentionEveryone || (targetRole.mentionable && !targetRole.managed)) {
      return { pingText: `<@&${targetRole.id}>`, allowedMentions: { parse: [], roles: [targetRole.id] } };
    }
    return none;
  }
  if (pingTarget === 'role') return none;
  if (canMentionEveryone) return { pingText: '@everyone', allowedMentions: { parse: ['everyone'] } };
  return none;
}

// Load the whole member list once per guild (needs the GuildMembers intent; without it we keep what is cached)
async function ensureMembersLoaded(guild) {
  if (!guild) return;
  if (guild.memberCount && guild.members.cache.size >= guild.memberCount) return;
  await guild.members.fetch().catch(err => {
    console.warn(`⚠️ [Members] Could not load members of ${guild.name}: ${err.message}. Enable the "Server Members Intent" in the Developer Portal.`);
  });
}

// Humans who can see the channel (and have the target role, if any)
async function resolveTargetMemberIds(guild, channel, roleId = null) {
  try {
    await ensureMembersLoaded(guild);
    let members = null;
    if (guild && roleId && roleId !== 'everyone' && roleId !== guild.id) {
      members = guild.roles.cache.get(roleId)?.members || null;
    }
    if (!members) members = channel?.members || null;
    if (!members) return [];
    return [...members.values()]
      .filter(m => !m.user?.bot)
      .filter(m => !channel?.permissionsFor || channel.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel))
      .map(m => m.id);
  } catch (err) {
    console.warn('⚠️ [Members] resolveTargetMemberIds failed:', err.message);
    return [];
  }
}

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
  if (!interaction.inGuild()) {
    return interaction.reply({ content: '⛔ Cette commande ne marche que dans un serveur. « Pas en DM, frérot. »', ephemeral: true });
  }
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
    // Everyone who can see the channel (restricted to the role when one was chosen)
    const targetMemberIds = await resolveTargetMemberIds(interaction.guild, interaction.channel, targetRole ? targetRole.id : null);

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

    // Initial content with customizable ping target (permission-checked)
    const { pingText, allowedMentions } = resolvePing(interaction, pingTarget, targetRole);
    payload.allowedMentions = allowedMentions;

    payload.content = pingText
      ? `🎮 **ÇA RECRUTE POUR VALO !** ${pingText}\n${phrases.pick(phrases.recruitment)}`
      : `🎮 **ÇA RECRUTE POUR VALO !** *(Notifs : ${pingTarget === 'only_on_time' ? 'juste à l\'heure H' : 'silencieux, mode ninja'})*\n${phrases.pick(phrases.recruitment)}`;

    const message = await interaction.editReply(payload);
    session.messageId = message.id;
    session.channelId = interaction.channelId;
    session.guildId = interaction.guildId;
    sessionManager.persist();

  } catch (err) {
    console.error('Error handling command:', err);
    await interaction.editReply({
      content: `❌ Impossible de créer la session : ${/^(Tu as déjà|L'heure du match)/.test(err.message) ? err.message : 'erreur interne.'}`
    });
  }
}

async function handleModalSubmit(interaction, config = {}) {
  if (interaction.customId !== 'modal_create_session') return;
  if (!interaction.inGuild()) {
    return interaction.reply({ content: '⛔ Cette commande ne marche que dans un serveur.', ephemeral: true });
  }
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
    const targetMemberIds = await resolveTargetMemberIds(interaction.guild, interaction.channel);

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

    const { pingText, allowedMentions } = resolvePing(interaction, pingTarget, null);
    payload.allowedMentions = allowedMentions;

    payload.content = pingText
      ? `🎮 **ÇA RECRUTE POUR VALO !** ${pingText}\n${phrases.pick(phrases.recruitment)}`
      : `🎮 **ÇA RECRUTE POUR VALO !** *(Notifs : ${pingTarget === 'only_on_time' ? 'juste à l\'heure H' : 'silencieux, mode ninja'})*\n${phrases.pick(phrases.recruitment)}`;

    const message = await interaction.editReply(payload);
    session.messageId = message.id;
    session.channelId = interaction.channelId;
    session.guildId = interaction.guildId;
    sessionManager.persist();

  } catch (err) {
    console.error('Error handling modal:', err);
    await interaction.editReply({
      content: `❌ Impossible de lancer la session : ${/^(Tu as déjà|L'heure du match)/.test(err.message) ? err.message : 'erreur interne.'}`
    });
  }
}

async function handleButton(interaction, config = {}) {
  const customId = interaction.customId;

  // 0. Results button: result_<sessionId>
  if (customId.startsWith('result_')) {
    return handleResultRequest(interaction, customId.replace('result_', ''));
  }

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
        content: '🚫 Session annulée. Plus personne ne vote, « circulez y\'a rien à voir ».',
        ephemeral: true
      });
    }

    if (!sessionManager.isVotingOpen(session)) {
      return interaction.reply({
        content: '🔒 Le match a déjà commencé, trop tard ! « You snooze, you lose » 😴',
        ephemeral: true
      });
    }

    if (!interaction.inGuild() || (session.guildId && session.guildId !== interaction.guildId)) {
      return interaction.reply({ content: '⛔ Cette session appartient à un autre serveur.', ephemeral: true });
    }

    const userObj = {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      avatar: interaction.user.displayAvatarURL()
    };

    try {
      // 1. Record the vote in sessionManager
      const previousStatus = session.votes?.[userObj.id]?.status || null;
      sessionManager.castVote(sessionId, userObj, voteType, { source: 'discord_button' });
      const joined = ['sure', 'maybe', 'if_last', 'backup'].includes(voteType) && previousStatus !== voteType;

      // 2. Guarantee session knows its exact channel & message
      session.channelId = interaction.channelId;
      session.messageId = interaction.message.id;
      session.guildId = interaction.guildId;
      sessionManager.persist();

      // 3. Ephemeral acknowledgment to the user
      await interaction.reply({
        content: `✅ Vote enregistré : ${phrases.voteAck[voteType] || voteType}`,
        ephemeral: true
      });

      // 4. Someone joined: repost the message as the last one of the channel. Otherwise just edit it.
      if (joined) {
        await repostSessionMessage(interaction.client, session, config, userObj, interaction.message);
      } else {
        await updateDiscordMessage(interaction.client, session, config, interaction.message);
      }
    } catch (err) {
      console.error('Error casting vote:', err);
      if (!interaction.replied) {
        await interaction.reply({
          content: `❌ Impossible d'enregistrer ton vote : ${err.message}`,
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
        content: `⛔ Nope ! Seul <@${session.creator.id}> ou un admin peut annuler. « You shall not pass » 🧙`,
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
        content: '🛑 **Session annulée !** Le tampon CANCELLED est posé. « Et c\'est le drame » 🎭',
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

    if (message.guild && message.channel && session.status === 'active') {
      const fresh = await resolveTargetMemberIds(message.guild, message.channel, session.targetRole?.id);
      if (fresh.length > 0) session.targetMemberIds = fresh;
    }

    const roster = sessionManager.calculateRosters(session);
    const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);

    if (session.status === 'cancelled') {
      payload.content = session.cancelReason === 'not_enough_players'
        ? '🛑 **Session annulée** : pas assez de joueurs. « Et c\'est le drame » 🎭'
        : phrases.pick(phrases.cancelled).replace('{who}', /^\d+$/.test(session.cancelledBy?.id || '') ? `<@${session.cancelledBy.id}>` : 'l\'hôte');
    } else if (session.status === 'locked') {
      payload.content = lockedContent(session, roster);
    }

    // Critical: payload.attachments = [] tells Discord API to discard old attachment and replace it
    payload.attachments = [];
    payload.allowedMentions = { parse: [] };

    await message.edit(payload);
    console.log(`✅ [Discord Bot] Successfully updated message ${message.id} for session ${session.id}`);
  } catch (err) {
    console.error(`❌ [Discord Bot] Failed to update Discord message for session ${session.id}:`, err);
  }
}

function lockedContent(session, roster) {
  if (session.partyStartSent || Date.now() >= session.partyTimestamp) {
    return `🏁 **MATCH LANCÉ** — les votes sont clos. « GG WP » 🤝`;
  }
  const mentions = roster.team1.map(m => `<@${m.userId}>`).join(' ');
  return `${phrases.pick(phrases.locked)}\n${phrases.pick(phrases.lockedSquad).replace('{mentions}', mentions)}`;
}

// Serialize reposts per session so rapid joins don't leave duplicate messages behind
const repostQueues = new Map();

// Post the session message again as the last message of the channel, then delete the old one
function repostSessionMessage(client, session, config = {}, joiner = null, oldMessage = null) {
  const previous = repostQueues.get(session.id) || Promise.resolve();
  const run = previous.then(() => doRepost(client, session, config, joiner, oldMessage)).catch(() => {});
  repostQueues.set(session.id, run);
  return run;
}

async function doRepost(client, session, config, joiner, oldMessage) {
  try {
    if (!session.channelId) return;
    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    // Already the last message of the channel: a simple edit is enough
    if (session.messageId && channel.lastMessageId === session.messageId) {
      return updateDiscordMessage(client, session, config, oldMessage && oldMessage.id === session.messageId ? oldMessage : null);
    }

    const roster = sessionManager.calculateRosters(session);
    const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);
    const name = joiner ? `**${safeName(joiner.displayName || joiner.username)}**` : 'Un joueur';
    payload.content = session.status === 'locked'
      ? lockedContent(session, roster)
      : phrases.pick(phrases.joined).replace('{name}', name);
    payload.allowedMentions = { parse: [] };

    const sent = await channel.send(payload);
    const oldId = session.messageId;
    session.messageId = sent.id;
    sessionManager.persist();

    if (oldId && oldId !== sent.id) {
      const old = (oldMessage && oldMessage.id === oldId) ? oldMessage : await channel.messages.fetch(oldId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    console.log(`🔁 [Discord Bot] Reposted session ${session.id} as last message (${sent.id}).`);
  } catch (err) {
    console.error(`❌ [Discord Bot] Failed to repost session ${session.id}:`, err);
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

    // 0. Fresh list of everyone who can see the channel
    if (channel.guild) {
      const fresh = await resolveTargetMemberIds(channel.guild, channel, session.targetRole?.id);
      if (fresh.length > 0) session.targetMemberIds = fresh;
    }

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

    const meme = pickMeme('reminder', reminderMemeUrls);
    const embed = new EmbedBuilder()
      .setColor(0xff4655)
      .setTitle(`⏰ MATCH DANS ${reminderLabel.toUpperCase()} — ON ATTEND TA RÉPONSE`)
      .setDescription(
        `${phrases.pick(phrases.reminders).replace('{label}', reminderLabel)}\n` +
        `La session **"${session.note || 'Competitive Stack'}"** démarre <t:${partyUnix}:R> !\n\n` +
        `🛡️ **Squad actuelle :** **${lockedCount}/${partySize}**\n` +
        `⏰ **Début du match :** <t:${partyUnix}:t> (<t:${partyUnix}:F>)\n\n` +
        `Vote maintenant, « on n'est pas des animaux » 🐒`
      )
      .setFooter({ text: `Valobot • Rappel automatique ${reminderLabel} avant le match` });

    if (meme.file) embed.setImage(`attachment://${meme.file.name}`);
    else if (meme.imageUrl) embed.setImage(meme.imageUrl);

    const components = [];
    if (messageUrl) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('👉 Aller voter, feignasse')
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
        content: `🔔 ${mentions}${i === 0 && meme.linkUrl ? `\n${meme.linkUrl}` : ''}`,
        files: i === 0 && meme.file ? [meme.file] : [],
        embeds: i === 0 ? [embed] : [],
        components: i === 0 ? components : [],
        allowedMentions: { parse: [], users: chunk }
      });
    }

    console.log(`📢 [Discord Bot] Pinged ${unresponsiveIds.length} unresponsive user(s) 30m prior to session ${session.id}`);
  } catch (err) {
    console.error(`❌ [Discord Bot] Failed to send 30m reminder for session ${session.id}:`, err);
  }
}

async function sendPartyStartResult(client, session) {
  try {
    const autoCancelled = session.status === 'cancelled' && session.cancelReason === 'not_enough_players';
    if (!session.channelId || (session.status === 'cancelled' && !autoCancelled)) return;
    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const roster = sessionManager.calculateRosters(session);
    const partySize = session.partySize || 5;
    if (roster.team1.length >= partySize) {
      console.log(`✅ [Match Start] Session ${session.id} has enough players (${roster.team1.length}/${partySize}).`);
      return;
    }

    const mentions = roster.team1.map(member => `<@${member.userId}>`).join(' ');
    const meme = pickMeme('flop', flopMemeUrls);
    await channel.send({
      files: meme.file ? [meme.file] : [],
      allowedMentions: { parse: [], users: roster.team1.map(member => member.userId) },
      content: `💀 **FLOP DU MATCH** — seulement ${roster.team1.length}/${partySize} joueur(s) présent(s) à l'heure prévue. ${mentions}${meme.linkUrl ? `\n${meme.linkUrl}` : ''}`.trim(),
      embeds: [
        new EmbedBuilder()
          .setColor(0x2b141a)
          .setTitle(phrases.pick(phrases.flopTitles))
          .setDescription(
            `La partie **${session.note || 'Competitive Stack'}** devait commencer maintenant.\n` +
            phrases.pick(phrases.flopLines).replace('{n}', roster.team1.length).replace('{size}', partySize)
          )
          .setImage(meme.file ? `attachment://${meme.file.name}` : (meme.imageUrl || null))
          .setFooter({ text: 'Valobot • Match flop' })
      ]
    });
    console.log(`💀 [Match Start] Sent flop meme for session ${session.id}: ${roster.team1.length}/${partySize}.`);
  } catch (err) {
    console.error(`❌ [Match Start] Failed to send flop meme for session ${session.id}:`, err);
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
  repostSessionMessage,
  sendChannelReminder,
  sendPartyStartResult,
  getUnresponsiveChannelMembers,
  resolveTargetMemberIds,
  parsePingSettingsInput,
  handleAutocomplete
};
