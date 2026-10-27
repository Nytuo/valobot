const { WebSocketServer } = require('ws');
const sessionManager = require('../services/sessionManager');

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    // Send initial active sessions
    const sessions = sessionManager.getAllSessions().map(s => ({
      ...s,
      roster: sessionManager.calculateRosters(s)
    }));
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
  });

  function broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload });
    for (const client of wss.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(msg);
      }
    }
  }

  // Subscribe to sessionManager events
  sessionManager.on('sessionCreated', (session) => {
    broadcast('SESSION_CREATED', {
      ...session,
      roster: sessionManager.calculateRosters(session)
    });
  });

  sessionManager.on('sessionUpdated', (session, meta) => {
    broadcast('SESSION_UPDATED', {
      session: {
        ...session,
        roster: sessionManager.calculateRosters(session)
      },
      meta
    });
  });

  sessionManager.on('sessionCancelled', (session) => {
    broadcast('SESSION_CANCELLED', {
      ...session,
      roster: sessionManager.calculateRosters(session)
    });
  });

  sessionManager.on('sessionLocked', (session) => {
    broadcast('SESSION_LOCKED', {
      ...session,
      roster: sessionManager.calculateRosters(session)
    });
  });

  return { wss, broadcast };
}

module.exports = {
  setupWebSocket
};
