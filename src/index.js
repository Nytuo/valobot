require('dotenv').config();

// Enforce configured timezone for Node.js Date operations (defaults to Europe/Paris)
if (process.env.TIMEZONE || !process.env.TZ) {
  process.env.TZ = process.env.TIMEZONE || process.env.TZ || 'Europe/Paris';
}

const { createDiscordBot } = require('./bot/client');
const { createApp } = require('./server/app');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const WEB_BASE_URL = process.env.WEB_BASE_URL || 'https://valobot.example.com';

const botConfig = {
  discordToken: process.env.DISCORD_BOT_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID,
  webBaseUrl: WEB_BASE_URL
};

// 1. Initialize Discord Bot
const bot = createDiscordBot(botConfig);

// 2. Initialize Express & WebSocket server
const { app, server } = createApp(bot, { webBaseUrl: WEB_BASE_URL });

// 3. Start server
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`=======================================================`);
  console.log(`🚀 VALOBOT Server running on http://0.0.0.0:${PORT}`);
  console.log(`🌐 Public URL configured: ${WEB_BASE_URL}`);
  console.log(`🎯 Reverse proxy destination: Apache at valobot.example.com`);
  console.log(`=======================================================`);

  // Start Discord Bot
  await bot.start();
});

// A stray rejected promise must not take the bot down (or leak details to the user)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Valobot...');
  server.close(() => {
    process.exit(0);
  });
});
