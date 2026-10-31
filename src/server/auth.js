const crypto = require('crypto');

// Signing secret: dedicated SESSION_SECRET, else derived (never the raw credential), else random per boot.
function resolveSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    return process.env.SESSION_SECRET;
  }
  const base = process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_BOT_TOKEN;
  console.warn('⚠️ [Security] SESSION_SECRET is missing or shorter than 32 chars. Set it in .env (e.g. `openssl rand -hex 32`).');
  if (base) {
    return crypto.createHmac('sha256', base).update('valobot:session-signing:v1').digest('hex');
  }
  return crypto.randomBytes(32).toString('hex'); // sessions will not survive a restart
}

const SESSION_SECRET = resolveSessionSecret();

function signToken(data) {
  const json = JSON.stringify(data);
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(json).digest('hex');
  return Buffer.from(json).toString('base64url') + '.' + hmac;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, hmac] = parts;
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8');
    const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(json).digest('hex');
    if (hmac.length !== expectedHmac.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      return null;
    }
    const data = JSON.parse(json);
    if (typeof data.exp !== 'number' || Date.now() > data.exp) return null;
    if (typeof data.id !== 'string' || !/^\d{5,25}$/.test(data.id)) return null;
    return data;
  } catch (err) {
    return null;
  }
}

// Cookie helpers (HttpOnly + SameSite=Lax, plus Secure when served over HTTPS)
function buildCookie(name, value, { maxAgeSeconds, secure }) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function newOAuthState() {
  return crypto.randomBytes(16).toString('hex');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    try {
      list[name] = decodeURIComponent(value);
    } catch {
      list[name] = value;
    }
  });

  return list;
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.valobot_session;
  if (!token) return null;
  return verifyToken(token);
}

function getDiscordOAuthUrl(clientId, redirectUri, state = 'auth', scope = 'identify guilds') {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeOAuthCode(clientId, clientSecret, code, redirectUri) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!tokenRes.ok) {
    console.error('Discord OAuth token exchange failed with status', tokenRes.status);
    throw new Error('Discord OAuth token exchange failed');
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Fetch user info
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!userRes.ok) throw new Error('Failed to fetch Discord user info');
  const user = await userRes.json();

  // Fetch user guilds
  const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const guilds = guildsRes.ok ? await guildsRes.json() : [];

  // Riot account connected on the Discord profile (null if none / not shared)
  let riotId = null;
  try {
    const connRes = await fetch('https://discord.com/api/users/@me/connections', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (connRes.ok) {
      const connections = await connRes.json();
      const riot = Array.isArray(connections) ? connections.find(c => c.type === 'riotgames') : null;
      if (riot && typeof riot.name === 'string') riotId = riot.name;
    }
  } catch {}

  return {
    user: {
      id: user.id,
      username: user.username,
      globalName: user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null
    },
    riotId,
    userGuilds: guilds.map(g => ({
      id: g.id,
      name: g.name,
      permissions: g.permissions,
      owner: g.owner
    }))
  };
}

// Strip Discord mentions, links, markdown link syntax, control and bidi characters
function cleanText(input) {
  return String(input)
    .replace(/<@[!&]?\d+>/g, '') // user & role mentions
    .replace(/<#\d+>/g, '') // channel mentions
    .replace(/@(everyone|here)/gi, '')
    .replace(/https?:\/\/\S+/gi, '') // links
    .replace(/discord\.gg\/\S+/gi, '')
    .replace(/[\[\]()`]/g, '') // masked links / code spans
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sanitization & Anti-abuse validation for header / notes
function sanitizeNote(input) {
  if (!input || typeof input !== 'string') return 'Competitive 5-Stack';

  let sanitized = cleanText(input.slice(0, 200));

  // Enforce strict length: max 50 characters
  if (sanitized.length > 50) {
    sanitized = sanitized.substring(0, 50).trim();
  }

  if (sanitized.length < 2) {
    return 'Competitive 5-Stack';
  }

  return sanitized;
}

// Display names are user-controlled: neutralize markdown and mentions before echoing them in bot messages
function safeName(name) {
  const cleaned = cleanText(String(name || 'Joueur').slice(0, 64)).replace(/[*_~|>\\]/g, '');
  return cleaned.slice(0, 32) || 'Joueur';
}

module.exports = {
  signToken,
  verifyToken,
  getSessionUser,
  getDiscordOAuthUrl,
  exchangeOAuthCode,
  sanitizeNote,
  safeName,
  buildCookie,
  newOAuthState,
  safeEqual,
  parseCookies
};
