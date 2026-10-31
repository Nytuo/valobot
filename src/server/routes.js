const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const sessionManager = require('../services/sessionManager');
const { buildSessionMessagePayload } = require('../bot/embedBuilder');
const { renderSessionBanner } = require('../bot/stampRenderer');
const phrases = require('../bot/phrases');
const { resolveTargetMemberIds } = require('../bot/handlers');
const profiles = require('../services/profiles');
const valorantStats = require('../services/valorantStats');
const {
  signToken,
  getSessionUser,
  getDiscordOAuthUrl,
  exchangeOAuthCode,
  sanitizeNote,
  buildCookie,
  newOAuthState,
  safeEqual,
  parseCookies
} = require('./auth');

// Anti-spam tracker (cooldown per user in ms)
const userCreationCooldowns = new Map();
const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const SNOWFLAKE = /^\d{5,25}$/;
const PING_TARGETS = ['everyone', 'role', 'only_on_time', 'none'];
const REMINDER_PRIORS = ['off', '5m', '10m', '15m', '30m', '45m', '1h'];

function allowedChannelList() {
  const allowedEnv = process.env.ALLOWED_CHANNEL_IDS;
  return allowedEnv ? allowedEnv.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function createApiRouter(botClient, config = {}) {
  const router = express.Router();
  const clientId = config.discordClientId || process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const webBaseUrl = (config.webBaseUrl || process.env.WEB_BASE_URL || 'https://valobot.example.com').replace(/\/$/, '');
  const redirectUri = `${webBaseUrl}/api/auth/callback`;
  const secureCookies = webBaseUrl.startsWith('https://');

  const isBotReady = () => Boolean(botClient && botClient.isReady && botClient.isReady());

  // Requires a signed-in user; answers 401 otherwise
  const requireUser = (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Please log in with your Discord account.' });
      return null;
    }
    return user;
  };

  // A user may only see / act on sessions of servers they belong to, in channels they can view
  async function userCanAccessSession(user, session) {
    if (!session || !session.guildId) return false;
    if (!Array.isArray(user.guildIds) || !user.guildIds.includes(session.guildId)) return false;
    if (!isBotReady()) return true; // fall back to the membership snapshot taken at login

    const guild = botClient.client.guilds.cache.get(session.guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return false;
    const channel = session.channelId ? guild.channels.cache.get(session.channelId) : null;
    if (channel && !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return false;
    return true;
  }

  // Looks up a session and checks access; sends the error response itself and returns null on failure
  async function loadAccessibleSession(req, res, user) {
    const session = sessionManager.getSession(req.params.id);
    // Same answer for "missing" and "forbidden" so ids can't be probed
    if (!session || !(await userCanAccessSession(user, session))) {
      res.status(404).json({ error: 'Session not found' });
      return null;
    }
    return session;
  }

  // --- AUTH ROUTES ---

  // 1. Initiate Discord OAuth2 Login (with anti-CSRF state)
  router.get('/auth/login', (req, res) => {
    if (!clientId) {
      return res.status(500).send('Login is not configured on this server.');
    }
    const state = newOAuthState();
    res.setHeader('Set-Cookie', buildCookie('valobot_oauth_state', state, { maxAgeSeconds: 600, secure: secureCookies }));
    res.redirect(getDiscordOAuthUrl(clientId, redirectUri, state));
  });

  // 1b. One-click Riot account link (scope: identify + connections only, no session is created)
  router.get('/auth/riot', (req, res) => {
    if (!clientId) {
      return res.status(500).send('Login is not configured on this server.');
    }
    const state = `riot.${newOAuthState()}`;
    res.setHeader('Set-Cookie', buildCookie('valobot_oauth_state', state, { maxAgeSeconds: 600, secure: secureCookies }));
    res.redirect(getDiscordOAuthUrl(clientId, redirectUri, state, 'identify connections'));
  });

  // 2. OAuth2 Callback
  router.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const expectedState = parseCookies(req).valobot_oauth_state;
    const clearState = buildCookie('valobot_oauth_state', '', { maxAgeSeconds: 0, secure: secureCookies });

    if (typeof code !== 'string' || !code || code.length > 512) {
      res.setHeader('Set-Cookie', clearState);
      return res.redirect('/?error=missing_code');
    }
    if (!safeEqual(String(state || ''), expectedState || '')) {
      res.setHeader('Set-Cookie', clearState);
      return res.redirect('/?error=invalid_state');
    }

    try {
      if (!clientSecret) {
        throw new Error('DISCORD_CLIENT_SECRET is missing from server configuration.');
      }

      // Riot link flow: read the Riot Games connection of the Discord profile, store it, no login
      if (String(state).startsWith('riot.')) {
        const { user: riotUser, riotId } = await exchangeOAuthCode(clientId, clientSecret, code, redirectUri);
        res.setHeader('Set-Cookie', clearState);
        const parsedRiot = profiles.parseRiotId(riotId);
        if (!parsedRiot) return res.redirect('/?riot=none');

        const existing = profiles.getProfile(riotUser.id);
        const region = existing?.region || profiles.DEFAULT_REGION;
        let puuid = null;
        if (valorantStats.isConfigured()) {
          puuid = await valorantStats.getRank({ ...parsedRiot, region }).then(r => r?.puuid || null).catch(() => null);
        }
        profiles.setProfile(riotUser.id, { ...parsedRiot, region, puuid, source: 'discord' });
        return res.redirect('/?riot=linked');
      }

      const { user, userGuilds } = await exchangeOAuthCode(clientId, clientSecret, code, redirectUri);

      // Only keep guilds where the bot is present: smaller cookie, nothing about the user's other servers
      const botGuildIds = isBotReady() ? botClient.client.guilds.cache : null;
      const guildIds = userGuilds
        .map(g => g.id)
        .filter(id => !botGuildIds || botGuildIds.has(id));

      const sessionPayload = {
        id: user.id,
        username: user.username,
        displayName: user.globalName || user.username,
        avatar: user.avatar,
        guildIds,
        exp: Date.now() + SESSION_TTL_SECONDS * 1000
      };

      const token = signToken(sessionPayload);
      res.setHeader('Set-Cookie', [
        buildCookie('valobot_session', token, { maxAgeSeconds: SESSION_TTL_SECONDS, secure: secureCookies }),
        clearState
      ]);
      res.redirect('/?login=success');
    } catch (err) {
      // Never reflect upstream error text to the browser
      console.error('OAuth Callback error:', err.message);
      res.setHeader('Set-Cookie', clearState);
      res.redirect('/?error=login_failed');
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
    res.setHeader('Set-Cookie', buildCookie('valobot_session', '', { maxAgeSeconds: 0, secure: secureCookies }));
    res.json({ status: 'logged_out' });
  });

  // --- STATUS & SESSIONS ---

  // 5. System Status (anonymous callers only learn whether things are up)
  router.get('/status', (req, res) => {
    const ready = isBotReady();
    const user = getSessionUser(req);
    const body = {
      status: 'ok',
      botConnected: ready,
      hasOAuth: Boolean(clientId && clientSecret)
    };
    if (user) {
      body.botTag = ready ? botClient.client.user.tag : null;
      body.guildCount = ready ? botClient.client.guilds.cache.size : 0;
      body.activeSessions = sessionManager.getActiveSessions().length;
    }
    res.json(body);
  });

  // 6. Guilds and Channels (Protected: Only show servers/channels user actually has access to!)
  router.get('/guilds', async (req, res) => {
    const user = getSessionUser(req);

    // If bot not ready, return empty list
    if (!isBotReady()) {
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
      const allowedList = allowedChannelList();

      for (const [, guild] of botClient.client.guilds.cache) {
        // 1. Check if user belongs to this guild
        if (!user.guildIds || !user.guildIds.includes(guild.id)) {
          continue; // User is not in this guild
        }

        // 2. Fetch member to verify their actual permissions in this guild
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) continue;

        // 3. Filter channels where both BOT and USER can view and send messages
        const channels = guild.channels.cache
          .filter(c => {
            if (!c.isTextBased() || c.isThread?.() || c.isDMBased?.()) return false;
            const botPerms = c.permissionsFor(guild.members.me);
            const userPerms = c.permissionsFor(member);
            if (allowedList.length > 0 && !allowedList.includes(c.id)) return false;
            return botPerms?.has(PermissionFlagsBits.SendMessages) &&
                   botPerms?.has(PermissionFlagsBits.ViewChannel) &&
                   userPerms?.has(PermissionFlagsBits.SendMessages) &&
                   userPerms?.has(PermissionFlagsBits.ViewChannel);
          })
          .map(c => ({ id: c.id, name: c.name }));

        if (channels.length === 0) continue;

        const canMentionEveryone = member.permissions.has(PermissionFlagsBits.MentionEveryone) ||
                                   member.permissions.has(PermissionFlagsBits.Administrator);

        // Roles the user is actually allowed to ping
        const roles = guild.roles.cache
          .filter(r => r.id !== guild.id && !r.managed && (canMentionEveryone || r.mentionable))
          .map(r => ({ id: r.id, name: r.name }));

        if (canMentionEveryone) {
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
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // 7. List sessions (only those the caller is allowed to see)
  router.get('/sessions', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    try {
      const all = sessionManager.getAllSessions().sort((a, b) => b.createdAt - a.createdAt);
      const checks = await Promise.all(all.map(s => userCanAccessSession(user, s)));
      res.json(all.filter((_, i) => checks[i]).map(s => sessionManager.toPublic(s)));
    } catch (err) {
      console.error('Error listing sessions:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // 8. Single session
  router.get('/sessions/:id', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const session = await loadAccessibleSession(req, res, user);
    if (!session) return;
    res.json(sessionManager.toPublic(session));
  });

  // 9. Dynamic canvas banner
  router.get('/sessions/:id/banner.png', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const session = await loadAccessibleSession(req, res, user);
    if (!session) return;
    const roster = sessionManager.calculateRosters(session);
    const buffer = renderSessionBanner(session, roster, session.status === 'cancelled');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(buffer);
  });

  // 10. Create session from web UI (Strictly Protected & Sanitized)
  router.post('/sessions', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    // Reserve the cooldown slot up front so parallel requests can't bypass it
    const now = Date.now();
    const lastCreated = userCreationCooldowns.get(user.id) || 0;
    if (now - lastCreated < COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((COOLDOWN_MS - (now - lastCreated)) / 1000);
      return res.status(429).json({
        error: `Rate limit: Please wait ${remainingSeconds}s before launching another stacking vote.`
      });
    }
    userCreationCooldowns.set(user.id, now);
    const releaseCooldown = () => userCreationCooldowns.delete(user.id);

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { guildId, channelId, partyTime, voteDeadline, partySize, targetRoleId, note } = body;

      if (typeof partyTime !== 'string' || !partyTime.trim() || partyTime.length > 64) {
        releaseCooldown();
        return res.status(400).json({ error: 'Party time is required.' });
      }

      if (typeof guildId !== 'string' || typeof channelId !== 'string' || !SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) {
        releaseCooldown();
        return res.status(400).json({ error: 'Discord Guild and Channel are required.' });
      }

      // SECURITY: Enforce Only ONE Active Session per Channel
      const activeInChannel = sessionManager.getActiveSessions().find(s => s.channelId === channelId);
      if (activeInChannel) {
        releaseCooldown();
        return res.status(409).json({
          error: 'An active recruitment session is already running in this channel. Wait for it to end or cancel it first.'
        });
      }

      // SECURITY: Verify Discord bot and user permissions in the specified channel
      if (!isBotReady()) {
        releaseCooldown();
        return res.status(503).json({ error: 'Discord bot is not currently connected.' });
      }

      if (!user.guildIds || !user.guildIds.includes(guildId)) {
        releaseCooldown();
        return res.status(403).json({ error: 'You are not a member of this Discord server.' });
      }

      const guild = botClient.client.guilds.cache.get(guildId);
      if (!guild) {
        releaseCooldown();
        return res.status(404).json({ error: 'Guild not found or bot is not a member.' });
      }

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        releaseCooldown();
        return res.status(403).json({ error: 'You are not a member of this Discord server.' });
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased() || channel.isThread?.() || channel.isDMBased?.()) {
        releaseCooldown();
        return res.status(404).json({ error: 'Specified channel not found or not text-based.' });
      }

      const allowedList = allowedChannelList();
      if (allowedList.length > 0 && !allowedList.includes(channelId)) {
        releaseCooldown();
        return res.status(403).json({ error: 'Recruitment sessions are locked to designated channels.' });
      }

      const userPerms = channel.permissionsFor(member);
      if (!userPerms?.has(PermissionFlagsBits.SendMessages) || !userPerms?.has(PermissionFlagsBits.ViewChannel)) {
        releaseCooldown();
        return res.status(403).json({ error: 'You do not have permission to send messages in this channel.' });
      }

      const botPerms = channel.permissionsFor(guild.members.me);
      if (!botPerms?.has(PermissionFlagsBits.SendMessages) || !botPerms?.has(PermissionFlagsBits.ViewChannel)) {
        releaseCooldown();
        return res.status(403).json({ error: 'The bot cannot post in this channel.' });
      }

      // Strict header / note sanitization (mentions, links, control chars, 50 chars max)
      const cleanNote = sanitizeNote(note);

      // SECURITY: the role to ping is verified server-side. Name comes from Discord, never from the client,
      // and the user may only ping what they could ping themselves.
      const canMentionEveryone = member.permissions.has(PermissionFlagsBits.MentionEveryone) ||
                                 member.permissions.has(PermissionFlagsBits.Administrator);
      let safeRoleId = null;
      let safeRoleName = 'Channel';
      if (targetRoleId === 'everyone' && canMentionEveryone) {
        safeRoleId = 'everyone';
        safeRoleName = '@everyone';
      } else if (typeof targetRoleId === 'string' && SNOWFLAKE.test(targetRoleId)) {
        const role = guild.roles.cache.get(targetRoleId);
        if (role && role.id !== guild.id && !role.managed && (canMentionEveryone || role.mentionable)) {
          safeRoleId = role.id;
          safeRoleName = role.name;
        }
      }

      const targetMemberIds = await resolveTargetMemberIds(guild, channel, safeRoleId);

      const creator = {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar
      };

      const pingTarget = PING_TARGETS.includes(body.pingTarget) ? body.pingTarget : 'everyone';
      const reminderPrior = REMINDER_PRIORS.includes(body.reminderPrior) ? body.reminderPrior : '30m';

      const session = sessionManager.createSession({
        guildId,
        channelId,
        creator,
        partyTime,
        partyTimestamp: body.partyTimestamp,
        voteDeadline: typeof voteDeadline === 'string' ? voteDeadline : undefined,
        voteDeadlineTimestamp: body.voteDeadlineTimestamp,
        partySize: Number(partySize) || 5,
        targetRoleId: safeRoleId || 'everyone',
        targetRoleName: safeRoleName || '@everyone',
        targetMemberIds,
        pingTarget,
        reminderPrior,
        note: cleanNote
      });

      // Post to Discord channel
      try {
        const roster = sessionManager.calculateRosters(session);
        const payload = buildSessionMessagePayload(session, roster, config.webBaseUrl);

        let pingText = '';
        const allowedMentions = { parse: [] };
        if (pingTarget !== 'none' && pingTarget !== 'only_on_time' && safeRoleId) {
          if (safeRoleId === 'everyone') {
            pingText = '@everyone';
            allowedMentions.parse = ['everyone'];
          } else {
            pingText = `<@&${safeRoleId}>`;
            allowedMentions.roles = [safeRoleId];
          }
        }

        payload.content = pingText
          ? `🎮 **ÇA RECRUTE POUR VALO !** ${pingText}\n${phrases.pick(phrases.recruitment)}`
          : `🎮 **ÇA RECRUTE POUR VALO !** *(Notifs : ${pingTarget === 'only_on_time' ? 'juste à l\'heure H' : 'silencieux, mode ninja'})*\n${phrases.pick(phrases.recruitment)}`;
        payload.allowedMentions = allowedMentions;

        const message = await channel.send(payload);
        session.messageId = message.id;
        sessionManager.persist();
      } catch (botErr) {
        console.error('Failed to post to Discord channel:', botErr);
        sessionManager.cancelSession(session.id, creator);
        releaseCooldown();
        return res.status(502).json({ error: 'Discord posting failed.' });
      }

      res.status(201).json(sessionManager.toPublic(session));
    } catch (err) {
      releaseCooldown();
      // Validation errors raised by the session manager are user-facing; anything else stays in the logs
      const isValidation = /^(Tu as déjà|L'heure du match)/.test(err.message || '');
      if (!isValidation) console.error('API create session error:', err);
      res.status(isValidation ? 400 : 500).json({ error: isValidation ? err.message : 'Internal error' });
    }
  });

  // 11. Cast vote from Web App (STRICT: Authentication + server membership required)
  router.post('/sessions/:id/vote', async (req, res) => {
    try {
      const user = requireUser(req, res);
      if (!user) return;
      const existing = await loadAccessibleSession(req, res, user);
      if (!existing) return;

      const voteType = req.body && req.body.voteType;
      if (typeof voteType !== 'string' || !voteType) {
        return res.status(400).json({ error: 'voteType is required' });
      }

      const userObj = {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null
      };

      const session = sessionManager.castVote(existing.id, userObj, voteType, { source: 'web' });
      res.json(sessionManager.toPublic(session));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 12. Cancel session (STRICT: Authentication required, host only)
  router.post('/sessions/:id/cancel', async (req, res) => {
    try {
      const user = requireUser(req, res);
      if (!user) return;
      const session = await loadAccessibleSession(req, res, user);
      if (!session) return;

      if (user.id !== session.creator.id) {
        return res.status(403).json({ error: 'Only the session host can cancel this session.' });
      }

      const updated = sessionManager.cancelSession(session.id, {
        id: user.id,
        username: user.displayName || user.username
      });

      res.json(sessionManager.toPublic(updated));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createApiRouter
};
