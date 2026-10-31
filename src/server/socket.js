const { WebSocketServer } = require('ws');
const sessionManager = require('../services/sessionManager');
const { getSessionUser } = require('./auth');
const { isSameOrigin } = require('./security');

const MAX_CONNECTIONS_PER_IP = 10;
const HEARTBEAT_MS = 30000;

function setupWebSocket(server, { allowedOrigin } = {}) {
  const connectionsPerIp = new Map();

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 1024,
    // Browsers always send Origin on WebSocket handshakes: block cross-site hijacking
    verifyClient: ({ origin, req }, done) => {
      if (origin && !isSameOrigin(origin, req.headers.host, allowedOrigin)) {
        return done(false, 403, 'Forbidden');
      }
      // Only signed-in Discord users receive session data
      if (!getSessionUser(req)) {
        return done(false, 401, 'Unauthorized');
      }
      done(true);
    }
  });

  // A client only receives sessions of servers it belongs to
  const canSee = (ws, session) => Boolean(session.guildId) && ws.guildIds.has(session.guildId);

  wss.on('connection', (ws, req) => {
    const user = getSessionUser(req);
    if (!user) return ws.close(1008, 'Unauthorized');

    const ip = req.socket.remoteAddress || 'unknown';
    const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const key = forwarded || ip;
    const count = connectionsPerIp.get(key) || 0;
    if (count >= MAX_CONNECTIONS_PER_IP) return ws.close(1013, 'Too many connections');
    connectionsPerIp.set(key, count + 1);
    ws.on('close', () => {
      const left = (connectionsPerIp.get(key) || 1) - 1;
      if (left <= 0) connectionsPerIp.delete(key);
      else connectionsPerIp.set(key, left);
    });

    ws.guildIds = new Set(Array.isArray(user.guildIds) ? user.guildIds : []);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const sessions = sessionManager.getAllSessions()
      .filter(s => canSee(ws, s))
      .map(s => sessionManager.toPublic(s));
    ws.send(JSON.stringify({ type: 'INIT', sessions }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', time: Date.now() }));
        }
      } catch (err) {
        // ignore
      }
    });
    ws.on('error', () => {});
  });

  // Drop dead connections
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  function broadcastSession(type, session, wrap = (payload) => payload) {
    const msg = JSON.stringify({ type, payload: wrap(sessionManager.toPublic(session)) });
    for (const client of wss.clients) {
      if (client.readyState === 1 && canSee(client, session)) { // OPEN
        client.send(msg);
      }
    }
  }

  // Subscribe to sessionManager events
  sessionManager.on('sessionCreated', (session) => broadcastSession('SESSION_CREATED', session));
  // Vote metadata (who voted what, source…) stays server-side
  sessionManager.on('sessionUpdated', (session) => broadcastSession('SESSION_UPDATED', session, (session) => ({ session })));
  sessionManager.on('sessionCancelled', (session) => broadcastSession('SESSION_CANCELLED', session));
  sessionManager.on('sessionLocked', (session) => broadcastSession('SESSION_LOCKED', session));

  return { wss, broadcast: () => {} };
}

module.exports = {
  setupWebSocket
};
