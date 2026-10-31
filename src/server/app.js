const express = require('express');
const path = require('path');
const http = require('http');
const { createApiRouter } = require('./routes');
const { setupWebSocket } = require('./socket');
const { securityHeaders, rateLimit, sameOriginGuard } = require('./security');

function createApp(botClient, config = {}) {
  const app = express();
  const server = http.createServer(app);

  const webBaseUrl = (config.webBaseUrl || process.env.WEB_BASE_URL || 'https://valobot.example.com').replace(/\/$/, '');
  let allowedOrigin = webBaseUrl;
  try { allowedOrigin = new URL(webBaseUrl).origin; } catch {}

  // Trust proxy for Apache reverse proxy (X-Forwarded-For, X-Forwarded-Proto)
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers + small JSON bodies only
  app.use(securityHeaders({ secure: webBaseUrl.startsWith('https://') }));
  app.use(express.json({ limit: '10kb' }));

  // Serve static assets from public/
  app.use(express.static(path.join(__dirname, '../../public'), { dotfiles: 'ignore' }));

  // Setup WebSocket on HTTP server
  const { broadcast } = setupWebSocket(server, { allowedOrigin });

  // API: rate limits (stricter on auth), CSRF origin guard, then routes
  app.use('/api/auth', rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Too many login attempts, slow down.' }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));
  app.use('/api', sameOriginGuard(allowedOrigin));
  app.use('/api', createApiRouter(botClient, config));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Health check
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Fallback route to serve the web UI index.html for client-side routing
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  // Last-resort error handler: never leak stack traces or internals
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'Payload too large' });
    }
    if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal error' });
  });

  return { app, server, broadcast };
}

module.exports = {
  createApp
};
