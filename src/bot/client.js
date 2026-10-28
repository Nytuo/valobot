const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { commands } = require('./commands');
const { handleCommand, handleModalSubmit, handleButton, updateDiscordMessage, sendChannelReminder } = require('./handlers');
const sessionManager = require('../services/sessionManager');

function createDiscordBot(config) {
  const token = config.discordToken || process.env.DISCORD_BOT_TOKEN;
  const clientId = config.discordClientId || process.env.DISCORD_CLIENT_ID;
  const guildId = config.discordGuildId || process.env.DISCORD_GUILD_ID; // optional test guild for instant slash commands

  if (!token) {
    console.warn('⚠️ [Discord Bot] DISCORD_BOT_TOKEN is not set. Bot will run in mock/standby mode.');
    return {
      client: null,
      start: async () => console.log('ℹ️ [Discord Bot] Skipped login (no token provided). Web dashboard is fully accessible!'),
      isReady: () => false
    };
  }

  // Only standard GatewayIntentBits.Guilds is required for slash commands, embeds & buttons.
  // This does NOT require any privileged intents (no "Used disallowed intents" error).
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds
    ]
  });

  client.once('ready', async () => {
    console.log(`🤖 [Discord Bot] Logged in as ${client.user.tag}!`);
    console.log(`📡 [Discord Bot] Serving ${client.guilds.cache.size} guild(s).`);

    // Register Slash Commands
    if (clientId) {
      try {
        const rest = new REST({ version: '10' }).setToken(token);
        const commandData = commands.map(c => c.toJSON());

        if (guildId) {
          console.log(`⚡ [Discord Bot] Registering commands for test guild: ${guildId}`);
          await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
        } else {
          console.log('🌍 [Discord Bot] Registering global application commands...');
          await rest.put(Routes.applicationCommands(clientId), { body: commandData });
        }
        console.log('✅ [Discord Bot] Slash commands registered successfully (/valo, /valorant, /youwanttoplay)!');
      } catch (err) {
        console.error('❌ [Discord Bot] Failed to register slash commands:', err);
      }
    }

    // Refresh active Discord messages (rewrites timezones and applies vote purges to Discord feed)
    try {
      const activeSessions = sessionManager.getActiveSessions();
      for (const session of activeSessions) {
        if (session.channelId && session.messageId) {
          console.log(`🔄 [Discord Bot] Rewriting Discord message for active session ${session.id}...`);
          await updateDiscordMessage(client, session, config);
        }
      }
    } catch (refreshErr) {
      console.warn('⚠️ [Discord Bot] Active session refresh notice:', refreshErr.message);
    }
  });

  // Interaction Router
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const cmdName = interaction.commandName;
        if (['valo', 'valorant', 'youwanttoplay'].includes(cmdName)) {
          await handleCommand(interaction, config);
        }
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction, config);
      } else if (interaction.isButton()) {
        await handleButton(interaction, config);
      }
    } catch (err) {
      console.error('❌ Error handling interaction:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ An error occurred while processing this interaction.',
          ephemeral: true
        }).catch(() => {});
      }
    }
  });

  // Sync session events back to Discord messages
  sessionManager.on('sessionUpdated', async (session, meta) => {
    if (meta?.source === 'discord_button') return;
    await updateDiscordMessage(client, session, config);
  });

  sessionManager.on('sessionCancelled', async (session) => {
    await updateDiscordMessage(client, session, config);
  });

  sessionManager.on('sessionLocked', async (session) => {
    await updateDiscordMessage(client, session, config);
  });

  // 30m Prior Reminder Event
  sessionManager.on('sessionReminder', async (session) => {
    await sendChannelReminder(client, session, config);
  });

  return {
    client,
    start: async () => {
      try {
        await client.login(token);
      } catch (err) {
        console.error('❌ [Discord Bot] Login failed:', err.message);
      }
    },
    isReady: () => client.isReady()
  };
}

module.exports = {
  createDiscordBot
};
