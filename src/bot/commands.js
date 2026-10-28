const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require('discord.js');

function createCommandOptions(builder) {
  return builder
    .addStringOption(option =>
      option
        .setName('party_time')
        .setDescription('Match start time (Combobox choices or custom: e.g. 21:00, in 1h)')
        .setRequired(false)
        .addChoices(
          { name: 'in 15m (+15 mins from now)', value: 'in 15m' },
          { name: 'in 30m (+30 mins from now)', value: 'in 30m' },
          { name: 'in 45m (+45 mins from now)', value: 'in 45m' },
          { name: 'in 1h (+1 hour from now)', value: 'in 1h' },
          { name: 'in 1h30 (+1.5 hours from now)', value: 'in 1h30' },
          { name: 'in 2h (+2 hours from now)', value: 'in 2h' },
          { name: '19:00 (7:00 PM)', value: '19:00' },
          { name: '19:30 (7:30 PM)', value: '19:30' },
          { name: '20:00 (8:00 PM)', value: '20:00' },
          { name: '20:30 (8:30 PM)', value: '20:30' },
          { name: '21:00 (Prime time - 9:00 PM)', value: '21:00' },
          { name: '21:30 (9:30 PM)', value: '21:30' },
          { name: '22:00 (10:00 PM)', value: '22:00' },
          { name: '22:30 (10:30 PM)', value: '22:30' },
          { name: '23:00 (11:00 PM)', value: '23:00' },
          { name: '00:00 (Midnight)', value: '00:00' }
        )
    )
    .addStringOption(option =>
      option
        .setName('vote_deadline')
        .setDescription('Vote deadline before match (Combobox choices: 5m, 10m, 15m, 30m, 45m, 1h before)')
        .setRequired(false)
        .addChoices(
          { name: '15m before (Default - 15 mins prior)', value: '15m before' },
          { name: '5m before (5 mins prior)', value: '5m before' },
          { name: '10m before (10 mins prior)', value: '10m before' },
          { name: '30m before (30 mins prior)', value: '30m before' },
          { name: '45m before (45 mins prior)', value: '45m before' },
          { name: '1h before (1 hour prior)', value: '1h before' },
          { name: 'in 15m (+15 mins from now)', value: 'in 15m' },
          { name: 'in 30m (+30 mins from now)', value: 'in 30m' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('party_size')
        .setDescription('Stack size: 5 (Full Stack), 3 (Trio), 2 (Duo). Default: 5')
        .setRequired(false)
        .addChoices(
          { name: '5 Players (Full Stack)', value: 5 },
          { name: '3 Players (Trio Stack)', value: 3 },
          { name: '2 Players (Duo Stack)', value: 2 }
        )
    )
    .addRoleOption(option =>
      option
        .setName('target_role')
        .setDescription('Role to ping for the vote (defaults to @everyone)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('note')
        .setDescription('Game mode / note (e.g. Ranked Ascendant+, Chill Unrated, Swiftplay)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('ping_target')
        .setDescription('Who to ping: everyone, role, only on time, or silent (Default: everyone)')
        .setRequired(false)
        .addChoices(
          { name: '@everyone (Ping all channel members)', value: 'everyone' },
          { name: 'Target Role only', value: 'role' },
          { name: 'Only on time (No initial ping, notify prior to match)', value: 'only_on_time' },
          { name: 'Silent (No pings at all)', value: 'none' }
        )
    )
    .addStringOption(option =>
      option
        .setName('reminder_prior')
        .setDescription('When to ping unresponsive users before match (Default: 30m prior)')
        .setRequired(false)
        .addChoices(
          { name: '30m (30 minutes before match - Default)', value: '30m' },
          { name: '5m (5 minutes before match)', value: '5m' },
          { name: '10m (10 minutes before match)', value: '10m' },
          { name: '15m (15 minutes before match)', value: '15m' },
          { name: '45m (45 minutes before match)', value: '45m' },
          { name: '1h (1 hour before match)', value: '1h' },
          { name: 'Disabled (No reminder ping)', value: 'off' }
        )
    );
}

// 1. /valo
const valoCommand = createCommandOptions(
  new SlashCommandBuilder()
    .setName('valo')
    .setDescription('Create a Valorant stacking vote session')
);

// 2. /valorant (alias)
const valorantCommand = createCommandOptions(
  new SlashCommandBuilder()
    .setName('valorant')
    .setDescription('Create a Valorant stacking vote session')
);

// 3. /youwanttoplay (alias)
const youwanttoplayCommand = createCommandOptions(
  new SlashCommandBuilder()
    .setName('youwanttoplay')
    .setDescription('Create a Valorant stacking vote session')
);

// Interactive Modal for the sender UI
function buildCreateSessionModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_create_session')
    .setTitle('Launch Valorant Stacking Session');

  const partyTimeInput = new TextInputBuilder()
    .setCustomId('input_party_time')
    .setLabel('Match Start Time (e.g. 21:00 or in 1h)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('21:00')
    .setRequired(true);

  const deadlineInput = new TextInputBuilder()
    .setCustomId('input_vote_deadline')
    .setLabel('Vote Deadline (e.g. 20:30 or 15m before)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('15m before')
    .setRequired(false);

  const partySizeInput = new TextInputBuilder()
    .setCustomId('input_party_size')
    .setLabel('Stack Size: 2, 3, or 5 (Default: 5)')
    .setStyle(TextInputStyle.Short)
    .setValue('5')
    .setMaxLength(1)
    .setRequired(false);

  const noteInput = new TextInputBuilder()
    .setCustomId('input_note')
    .setLabel('Mode / Rank / Note')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ranked Ascendant/Immortal')
    .setRequired(false);

  const pingSettingsInput = new TextInputBuilder()
    .setCustomId('input_ping_settings')
    .setLabel('Ping: everyone, role, only on time | 30m')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('everyone, 30m (or: only on time, 15m, off)')
    .setValue('everyone, 30m')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(partyTimeInput),
    new ActionRowBuilder().addComponents(deadlineInput),
    new ActionRowBuilder().addComponents(partySizeInput),
    new ActionRowBuilder().addComponents(noteInput),
    new ActionRowBuilder().addComponents(pingSettingsInput)
  );

  return modal;
}

module.exports = {
  commands: [valoCommand, valorantCommand, youwanttoplayCommand],
  buildCreateSessionModal
};
