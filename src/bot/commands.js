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
        .setDescription('Match start time (e.g. 21:00, 21h30, in 1h)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('vote_deadline')
        .setDescription('Vote deadline time (e.g. 20:30, 15m before). Default: 15m before party.')
        .setRequired(false)
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

  modal.addComponents(
    new ActionRowBuilder().addComponents(partyTimeInput),
    new ActionRowBuilder().addComponents(deadlineInput),
    new ActionRowBuilder().addComponents(partySizeInput),
    new ActionRowBuilder().addComponents(noteInput)
  );

  return modal;
}

module.exports = {
  commands: [valoCommand, valorantCommand, youwanttoplayCommand],
  buildCreateSessionModal
};
