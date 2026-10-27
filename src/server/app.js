const express = require('express');
const path = require('path');
const http = require('http');
const { createApiRouter } = require('./routes');
const { setupWebSocket } = require('./socket');

function createApp(botClient, config = {}) {
  const app = express();
  const server = http.createServer(app);

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Trust proxy for Apache reverse proxy (X-Forwarded-For, X-Forwarded-Proto)
  app.set('trust proxy', 1);

  // Serve static assets from public/
  app.use(express.static(path.join(__dirname, '../../public')));

  // Setup WebSocket on HTTP server
  const { broadcast } = setupWebSocket(server);

  // Mount API router
  app.use('/api', createApiRouter(botClient, config));

  // Health check
  app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

  // Fallback route to serve the web UI index.html for client-side routing
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  return { app, server, broadcast };
}

module.exports = {
  createApp
};
