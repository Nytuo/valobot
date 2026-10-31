const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { commands } = require('./commands');
const { handleCommand, handleModalSubmit, handleButton, updateDiscordMessage, repostSessionMessage, sendChannelReminder, sendPartyStartResult, handleAutocomplete } = require('./handlers');
const { captureBeforeStats, handleResultRequest, handleLinkCommand, handleUnlinkCommand } = require('./statsReport');
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

  // Guilds is enough for slash commands, embeds & buttons. GuildMembers (privileged) lets the bot list
  // every member who can see a channel, which the "didn't respond" list needs. If the intent is not enabled
  // in the Developer Portal, we log in again without it instead of crashing.
  let membersIntent = process.env.DISABLE_MEMBERS_INTENT !== 'true';
  let client = null;

  const buildClient = () => {
    const intents = [GatewayIntentBits.Guilds];
    if (membersIntent) intents.push(GatewayIntentBits.GuildMembers);
    client = new Client({ intents });
    registerClientHandlers(client);
  };

  const registerClientHandlers = (client) => {
  client.once('clientReady', async () => {
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
        console.log('✅ [Discord Bot] Slash commands registered successfully (' + commands.map(c => "/" + c.name).join(", ") + ')!');
      } catch (err) {
        console.error('❌ [Discord Bot] Failed to register slash commands:', err);
      }
    }

    if (membersIntent) {
      for (const [, guild] of client.guilds.cache) {
        await guild.members.fetch().catch(err => console.warn(`⚠️ [Discord Bot] Could not load members of ${guild.name}: ${err.message}`));
      }
      console.log('👥 [Discord Bot] Guild members loaded.');
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

  client.on('guildCreate', (guild) => {
    if (membersIntent) guild.members.fetch().catch(() => {});
  });

  client.on('error', (err) => console.error('❌ [Discord Bot] Client error:', err.message));
  client.on('warn', (msg) => console.warn('⚠️ [Discord Bot]', msg));

  // Interaction Router
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
        return;
      }

      if (interaction.isChatInputCommand()) {
        const cmdName = interaction.commandName;
        if (['valo', 'valorant', 'youwanttoplay'].includes(cmdName)) {
          await handleCommand(interaction, config);
        } else if (cmdName === 'valolink') {
          await handleLinkCommand(interaction, config);
        } else if (cmdName === 'valounlink') {
          await handleUnlinkCommand(interaction);
        } else if (cmdName === 'valoresult') {
          await handleResultRequest(interaction);
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

  };

  buildClient();

  // Sync session events back to Discord messages
  sessionManager.on('sessionUpdated', async (session, meta) => {
    if (meta?.source === 'discord_button') return;
    if (meta?.joined) {
      await repostSessionMessage(client, session, config, meta.user);
    } else {
      await updateDiscordMessage(client, session, config);
    }
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

  sessionManager.on('sessionPartyStart', async (session) => {
    await updateDiscordMessage(client, session, config); // disable vote buttons at real match time
    await sendPartyStartResult(client, session);
    await captureBeforeStats(client, session); // rank snapshot of the squad (linked players only)
  });

  return {
    get client() { return client; },
    start: async () => {
      try {
        await client.login(token);
      } catch (err) {
        if (membersIntent && /disallowed intents/i.test(err.message)) {
          console.warn('⚠️ [Discord Bot] "Server Members Intent" is not enabled in the Developer Portal (Bot > Privileged Gateway Intents). Retrying without it: the "didn\'t respond" list will be incomplete until you enable it.');
          membersIntent = false;
          try { client.destroy(); } catch {}
          buildClient();
          try {
            await client.login(token);
          } catch (retryErr) {
            console.error('❌ [Discord Bot] Login failed:', retryErr.message);
          }
          return;
        }
        console.error('❌ [Discord Bot] Login failed:', err.message);
      }
    },
    isReady: () => Boolean(client && client.isReady())
  };
}

module.exports = {
  createDiscordBot
};
