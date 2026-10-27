const crypto = require('crypto');

const SESSION_SECRET = process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_BOT_TOKEN || 'valobot_default_secret_key_32bytes!!';

function signToken(data) {
  const json = JSON.stringify(data);
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(json).digest('hex');
  return Buffer.from(json).toString('base64url') + '.' + hmac;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, hmac] = parts;
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8');
    const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(json).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      return null;
    }
    const data = JSON.parse(json);
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch (err) {
    return null;
  }
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

function getDiscordOAuthUrl(clientId, redirectUri, state = 'auth') {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
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
    const err = await tokenRes.text();
    throw new Error(`Discord OAuth token exchange failed: ${err}`);
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

  return {
    user: {
      id: user.id,
      username: user.username,
      globalName: user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null
    },
    userGuilds: guilds.map(g => ({
      id: g.id,
      name: g.name,
      permissions: g.permissions,
      owner: g.owner
    }))
  };
}

// Sanitization & Anti-abuse validation for header / notes
function sanitizeNote(input) {
  if (!input || typeof input !== 'string') return 'Competitive 5-Stack';

  let sanitized = input
    .replace(/<@&?\d+>/g, '') // remove user & role mention tags (<@123>, <@&123>)
    .replace(/@everyone/gi, '') // remove @everyone
    .replace(/@here/gi, '') // remove @here
    .replace(/<#\d+>/g, '') // remove channel tags
    .replace(/[\r\n\t]/g, ' ') // remove newlines/tabs
    .replace(/\s+/g, ' ') // collapse multi-spaces
    .trim();

  // Enforce strict length: max 50 characters
  if (sanitized.length > 50) {
    sanitized = sanitized.substring(0, 50).trim();
  }

  if (sanitized.length < 2) {
    return 'Competitive 5-Stack';
  }

  return sanitized;
}

module.exports = {
  signToken,
  verifyToken,
  getSessionUser,
  getDiscordOAuthUrl,
  exchangeOAuthCode,
  sanitizeNote
};
