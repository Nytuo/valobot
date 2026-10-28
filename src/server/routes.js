const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const sessionManager = require('../services/sessionManager');
const { buildSessionMessagePayload } = require('../bot/embedBuilder');
const { renderSessionBanner } = require('../bot/stampRenderer');
const {
  signToken,
  getSessionUser,
  getDiscordOAuthUrl,
  exchangeOAuthCode,
  sanitizeNote
} = require('./auth');

// Anti-spam tracker (cooldown per user in ms)
const userCreationCooldowns = new Map();
const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

function createApiRouter(botClient, config = {}) {
  const router = express.Router();
  const clientId = config.discordClientId || process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const webBaseUrl = (config.webBaseUrl || process.env.WEB_BASE_URL || 'https://valobot.example.com').replace(/\/$/, '');
  const redirectUri = `${webBaseUrl}/api/auth/callback`;

  // --- AUTH ROUTES ---

  // 1. Initiate Discord OAuth2 Login
  router.get('/auth/login', (req, res) => {
    if (!clientId) {
      return res.status(500).send('DISCORD_CLIENT_ID not configured on server.');
    }
    const authUrl = getDiscordOAuthUrl(clientId, redirectUri);
    res.redirect(authUrl);
  });

  // 2. OAuth2 Callback
  router.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.redirect('/?error=missing_code');
    }

    try {
      if (!clientSecret) {
        throw new Error('DISCORD_CLIENT_SECRET is missing from server configuration.');
      }

      const { user, userGuilds } = await exchangeOAuthCode(clientId, clientSecret, code, redirectUri);

      // Sign session token with 7 days expiration
      const sessionPayload = {
        id: user.id,
        username: user.username,
        displayName: user.globalName || user.username,
        avatar: user.avatar,
        guildIds: userGuilds.map(g => g.id),
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000
      };

      const token = signToken(sessionPayload);
      res.setHeader('Set-Cookie', `valobot_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
      res.redirect('/?login=success');
    } catch (err) {
      console.error('OAuth Callback error:', err.message);
      res.redirect(`/?error=${encodeURIComponent(err.message)}`);
    }
  });

  // 3. Current User Profile
  router.get('/auth/me', (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.json({ loggedIn: false, user: null });
    }
    res.json({
      loggedIn: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar
      }
    });
  });

  // 4. Logout
  router.post('/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'valobot_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ status: 'logged_out' });
  });

  // --- STATUS & SESSIONS ---

  // 5. System Status
  router.get('/status', (req, res) => {
    const isBotReady = botClient && botClient.isReady && botClient.isReady();
    res.json({
      status: 'ok',
      botConnected: Boolean(isBotReady),
      botTag: isBotReady ? botClient.client.user.tag : null,
      guildCount: isBotReady ? botClient.client.guilds.cache.size : 0,
      activeSessions: sessionManager.getActiveSessions().length,
      totalSessions: Object.keys(sessionManager.sessions).length,
      webBaseUrl: config.webBaseUrl || 'https://valobot.example.com',
      hasOAuth: Boolean(clientId && clientSecret)
    });
  });

  // 6. Guilds and Channels (Protected: Only show servers/channels user actually has access to!)
  router.get('/guilds', async (req, res) => {
    const user = getSessionUser(req);

    // If bot not ready, return empty list
    if (!botClient || !botClient.isReady || !botClient.isReady()) {
      return res.json([]);
    }

    // Security: Anonymous users see 0 channels to prevent spamming
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Please log in with Discord to view servers and launch sessions.',
        guilds: []
      });
    }

    try {
      const allowedGuilds = [];

      for (const [, guild] of botClient.client.guilds.cache) {
        // 1. Check if user belongs to this guild
        if (!user.guildIds || !user.guildIds.includes(guild.id)) {
          continue; // User is not in this guild
        }

        // 2. Fetch member to verify their actual permissions in this guild
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) continue;

        // 3. User must have permission to send messages in the guild
        const canSendInGuild = member.permissions.has(PermissionFlagsBits.SendMessages) ||
                               member.permissions.has(PermissionFlagsBits.ManageMessages) ||
                               member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                               member.permissions.has(PermissionFlagsBits.Administrator);

        if (!canSendInGuild) continue;

        // 4. Filter channels where both BOT and USER can send messages
        const channels = guild.channels.cache
          .filter(c => {
            if (!c.isTextBased()) return false;
            const botPerms = c.permissionsFor(guild.members.me);
            const userPerms = c.permissionsFor(member);
            const allowedEnv = process.env.ALLOWED_CHANNEL_IDS;
            const allowedList = allowedEnv ? allowedEnv.split(',').map(s => s.trim()).filter(Boolean) : [];
            if (allowedList.length > 0 && !allowedList.includes(c.id)) return false;
            return botPerms?.has('SendMessages') &&
                   userPerms?.has('SendMessages') &&
                   userPerms?.has('ViewChannel');
          })
          .map(c => ({ id: c.id, name: c.name }));

        if (channels.length === 0) continue;

        // Roles the user can ping (filter out @everyone unless admin)
        const roles = guild.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => ({ id: r.id, name: r.name }));

        // Allow @everyone mention only if member has MentionEveryone permission
        if (member.permissions.has(PermissionFlagsBits.MentionEveryone) || member.permissions.has(PermissionFlagsBits.Administrator)) {
          roles.unshift({ id: 'everyone', name: '@everyone' });
        }

        allowedGuilds.push({
          id: guild.id,
          name: guild.name,
          icon: guild.iconURL(),
          channels,
          roles
        });
      }

      res.json(allowedGuilds);
    } catch (err) {
      console.error('Error fetching filtered guilds:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 7. List active sessions
  router.get('/sessions', (req, res) => {
    const list = sessionManager.getAllSessions()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(session => ({
        ...session,
        roster: sessionManager.calculateRosters(session)
      }));
    res.json(list);
  });

  // 8. Single session
  router.get('/sessions/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({
      ...session,
      roster: sessionManager.calculateRosters(session)
    });
  });

  // 9. Dynamic canvas banner
  router.get('/sessions/:id/banner.png', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).send('Session not found');
    }
    const roster = sessionManager.calculateRosters(session);
    const buffer = renderSessionBanner(session, roster, session.status === 'cancelled');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buffer);
  });

  // 10. Create session from web UI (Strictly Protected & Sanitized)
  router.post('/sessions', async (req, res) => {
    try {
      const user = getSessionUser(req);

      // SECURITY 1: User MUST be authenticated via Discord OAuth
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required. Please log in with your Discord account to launch a stacking vote.'
        });
      }

      const {
        guildId,
        channelId,
        partyTime,
        voteDeadline,
        partySize,
        targetRoleId,
        targetRoleName,
        note
      } = req.body;

      if (!partyTime) {
        return res.status(400).json({ error: 'Party time is required.' });
      }

      if (!guildId || !channelId) {
        return res.status(400).json({ error: 'Discord Guild and Channel are required.' });
      }

      // SECURITY 2: Anti-Spam Cooldown per user
      const now = Date.now();
      const lastCreated = userCreationCooldowns.get(user.id) || 0;
      if (now - lastCreated < COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((COOLDOWN_MS - (now - lastCreated)) / 1000);
        return res.status(429).json({
          error: `Rate limit: Please wait ${remainingSeconds}s before launching another stacking vote.`
        });
      }

      // SECURITY 3: Enforce Only ONE Active Session per Channel
      const activeInChannel = sessionManager.getActiveSessions().find(s => s.channelId === channelId);
      if (activeInChannel) {
        return res.status(409).json({
          error: `An active recruitment session (#${activeInChannel.id}) is already running in this channel. Wait for it to end or cancel it first.`
        });
      }

      // SECURITY 4: Verify Discord bot and user permissions in the specified channel
      if (!botClient || !botClient.isReady || !botClient.isReady()) {
        return res.status(503).json({ error: 'Discord bot is not currently connected.' });
      }

      const guild = await botClient.client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return res.status(404).json({ error: 'Guild not found or bot is not a member.' });
      }

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return res.status(403).json({ error: 'You are not a member of this Discord server.' });
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Specified channel not found or not text-based.' });
      }

      const allowedEnv = process.env.ALLOWED_CHANNEL_IDS;
      const allowedList = allowedEnv ? allowedEnv.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (allowedList.length > 0 && !allowedList.includes(channelId)) {
        return res.status(403).json({ error: 'Recruitment sessions are locked to designated channels.' });
      }

      const userPerms = channel.permissionsFor(member);
      if (!userPerms?.has(PermissionFlagsBits.SendMessages) || !userPerms?.has(PermissionFlagsBits.ViewChannel)) {
        return res.status(403).json({ error: 'You do not have permission to send messages in this channel.' });
      }

      // SECURITY 5: Strict Header / Note Sanitization
      // Strips @everyone, @here, user/role mentions, control chars, limits to 50 chars
      const cleanNote = sanitizeNote(note);

      // SECURITY 6: Prevent unauthorized @everyone mentions
      let safeRoleId = targetRoleId;
      let safeRoleName = targetRoleName;
      if (targetRoleId === 'everyone' && !member.permissions.has(PermissionFlagsBits.MentionEveryone) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        safeRoleId = null;
        safeRoleName = 'Channel';
      }

      let targetMemberIds = [];
      if (channel.members) {
        targetMemberIds = channel.members
          .filter(m => !m.user?.bot)
          .map(m => m.id);
      }

      const creator = {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar
      };

      const session = sessionManager.createSession({
        guildId,
        channelId,
        creator,
        partyTime,
        partyTimestamp: req.body.partyTimestamp ? Number(req.body.partyTimestamp) : undefined,
        voteDeadline,
        voteDeadlineTimestamp: req.body.voteDeadlineTimestamp ? Number(req.body.voteDeadlineTimestamp) : undefined,
        partySize: Number(partySize) || 5,
        targetRoleId: safeRoleId || 'everyone',
        targetRoleName: safeRoleName || '@everyone',
        targetMemberIds,
        note: cleanNote
      });

      // Post to Discord channel
      try {
        const roster = sessionManager.calculateRosters(session);
        const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);
        const pingText = safeRoleId && safeRoleId !== 'everyone' ? `<@&${safeRoleId}>` : (safeRoleId === 'everyone' ? '@everyone' : '');
        payload.content = `🎮 **NEW VALORANT RECRUITMENT!** ${pingText} - A stacking party is forming!`;

        const message = await channel.send(payload);
        session.messageId = message.id;
        sessionManager.persist();
      } catch (botErr) {
        console.error('Failed to post to Discord channel:', botErr);
        return res.status(500).json({ error: `Discord posting failed: ${botErr.message}` });
      }

      // Register cooldown for user
      userCreationCooldowns.set(user.id, now);

      res.status(201).json({
        ...session,
        roster: sessionManager.calculateRosters(session)
      });
    } catch (err) {
      console.error('API create session error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 11. Cast vote from Web App (STRICT: Authentication required)
  router.post('/sessions/:id/vote', async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required. Please log in with your Discord account to vote.'
        });
      }

      const { voteType } = req.body;
      if (!voteType) {
        return res.status(400).json({ error: 'voteType is required' });
      }

      const userObj = {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null
      };

      const session = sessionManager.castVote(req.params.id, userObj, voteType, { source: 'web' });
      res.json({
        ...session,
        roster: sessionManager.calculateRosters(session)
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 12. Cancel session (STRICT: Authentication required)
  router.post('/sessions/:id/cancel', async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required. Please log in with Discord.'
        });
      }

      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Only host or authorized user
      const isCreator = user.id === session.creator.id;
      if (!isCreator) {
        return res.status(403).json({ error: 'Only the session host can cancel this session.' });
      }

      const updated = sessionManager.cancelSession(req.params.id, {
        id: user.id,
        username: user.displayName || user.username
      });

      res.json({
        ...updated,
        roster: sessionManager.calculateRosters(updated)
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 13. Purge all unauthenticated web votes
  router.post('/sessions/purge-unlogged', async (req, res) => {
    try {
      const purged = sessionManager.purgeUnloggedVotes();
      res.json({ success: true, purgedCount: purged });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createApiRouter
};
