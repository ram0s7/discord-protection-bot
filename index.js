const { Client, IntentsBitField, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, AuditLogEvent } = require('discord.js');
const fs = require('fs');

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildBans,
    IntentsBitField.Flags.GuildIntegrations,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions
  ]
});

const settingsFile = './settings.json';
let settings = { antiRaid: {} };

// Load settings from file
if (fs.existsSync(settingsFile)) {
  settings = JSON.parse(fs.readFileSync(settingsFile));
}

// Save settings to file
function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

// Initialize anti-raid settings for a guild
function initializeGuildSettings(guildId) {
  if (!guildId) return;
  if (!settings.antiRaid[guildId]) {
    settings.antiRaid[guildId] = {
      antiBot: false,
      antiFake: { enabled: false, minDays: 7 },
      channelDelete: false,
      channelCreate: false,
      roleDelete: false,
      ban: false,
      unban: false,
      kick: false
    };
    saveSettings();
  }
}

// Utility function to add delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('roleall')
    .setDescription('Assign a role to all members')
    .addRoleOption(option =>
      option.setName('role').setDescription('The role to assign').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
  new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('Configure anti-raid protections (Owner only)')
    .setDefaultMemberPermissions(0) // No default permissions; owner check in handler
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await client.application.commands.set(commands);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  try {
    const { commandName, guildId, guild, user } = interaction;

    if (!guild || !guildId) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    initializeGuildSettings(guildId);

    if (commandName === 'roleall') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: 'You need Manage Roles permission.', ephemeral: true });
      }

      const role = interaction.options.getRole('role');
      if (!role) {
        return interaction.reply({ content: 'Role not found.', ephemeral: true });
      }

      await interaction.deferReply();
      const members = await guild.members.fetch();
      let count = 0;

      for (const member of members.values()) {
        if (!member.roles.cache.has(role.id)) {
          try {
            await member.roles.add(role);
            count++;
            await delay(100); // Avoid rate limits
          } catch (error) {
            console.error(`Failed to add role to ${member.user.tag}:`, error);
          }
        }
      }

      await interaction.editReply(`Assigned ${role.name} to ${count} members.`);
    } else if (commandName === 'antiraid') {
      if (guild.ownerId !== user.id) {
        return interaction.reply({ content: 'Only the server owner can use this command.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Anti-Raid Protection')
        .setDescription('Configure the anti-raid options for your server.')
        .setColor('#4c89c7');

      const buttons = [
        new ButtonBuilder()
          .setCustomId(`antiBot_${guildId}`)
          .setLabel(`Anti-Bot: ${settings.antiRaid[guildId].antiBot ? 'ON' : 'OFF'}`)
          .setStyle(settings.antiRaid[guildId].antiBot ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`antiFake_${guildId}`)
          .setLabel(`Anti-Fake: ${settings.antiRaid[guildId].antiFake.enabled ? `ON (${settings.antiRaid[guildId].antiFake.minDays} days)` : 'OFF'}`)
          .setStyle(settings.antiRaid[guildId].antiFake.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`channelDelete_${guildId}`)
          .setLabel(`Channel Delete: ${settings.antiRaid[guildId].channelDelete ? 'ON' : 'OFF'}`)
          .setStyle(settings.antiRaid[guildId].channelDelete ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`channelCreate_${guildId}`)
          .setLabel(`Channel Create: ${settings.antiRaid[guildId].channelCreate ? 'ON' : 'OFF'}`)
          .setStyle(settings.antiRaid[guildId].channelCreate ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`roleDelete_${guildId}`)
          .setLabel(`Role Delete: ${settings.antiRaid[guildId].roleDelete ? 'ON' : 'OFF'}`)
          .setStyle(settings.antiRaid[guildId].roleDelete ? ButtonStyle.Success : ButtonStyle.Danger)
      ];

      const row1 = new ActionRowBuilder().addComponents(buttons.slice(0, 3));
      const row2 = new ActionRowBuilder().addComponents(buttons.slice(3, 5));

      const message = await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });

      // Create a collector for button interactions
      const collector = message.createMessageComponentCollector({ time: 300000 }); // 5 minutes

      collector.on('collect', async i => {
        try {
          if (i.user.id !== interaction.user.id) {
            return i.reply({ content: 'Only the command issuer can use these buttons.', ephemeral: true });
          }

          const [action, collectedGuildId] = i.customId.split('_');
          if (collectedGuildId !== guildId) {
            console.log(`Guild ID mismatch in button interaction: expected ${guildId}, got ${collectedGuildId}`);
            return;
          }

          initializeGuildSettings(guildId);

          // Update settings based on action
          if (action === 'antiBot') {
            settings.antiRaid[guildId].antiBot = !settings.antiRaid[guildId].antiBot;
          } else if (['channelDelete', 'channelCreate', 'roleDelete'].includes(action)) {
            settings.antiRaid[guildId][action] = !settings.antiRaid[guildId][action];
          } else if (action === 'antiFake') {
            const modal = new ModalBuilder()
              .setCustomId(`antiFakeModal_${guildId}`)
              .setTitle('Anti-Fake Settings');

            const input = new TextInputBuilder()
              .setCustomId('minDays')
              .setLabel('Minimum account age (days)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Enter a number (e.g., 7)')
              .setRequired(true);

            const row = new ActionRowBuilder().addComponents(input);
            modal.addComponents(row);

            await i.showModal(modal);
            return; // Modal doesn't update the message
          } else {
            console.log(`Unknown button action: ${action}`);
            return;
          }

          saveSettings();

          // Regenerate buttons with updated states
          const updatedButtons = [
            new ButtonBuilder()
              .setCustomId(`antiBot_${guildId}`)
              .setLabel(`Anti-Bot: ${settings.antiRaid[guildId].antiBot ? 'ON' : 'OFF'}`)
              .setStyle(settings.antiRaid[guildId].antiBot ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`antiFake_${guildId}`)
              .setLabel(`Anti-Fake: ${settings.antiRaid[guildId].antiFake.enabled ? `ON (${settings.antiRaid[guildId].antiFake.minDays} days)` : 'OFF'}`)
              .setStyle(settings.antiRaid[guildId].antiFake.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`channelDelete_${guildId}`)
              .setLabel(`Channel Delete: ${settings.antiRaid[guildId].channelDelete ? 'ON' : 'OFF'}`)
              .setStyle(settings.antiRaid[guildId].channelDelete ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`channelCreate_${guildId}`)
              .setLabel(`Channel Create: ${settings.antiRaid[guildId].channelCreate ? 'ON' : 'OFF'}`)
              .setStyle(settings.antiRaid[guildId].channelCreate ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`roleDelete_${guildId}`)
              .setLabel(`Role Delete: ${settings.antiRaid[guildId].roleDelete ? 'ON' : 'OFF'}`)
              .setStyle(settings.antiRaid[guildId].roleDelete ? ButtonStyle.Success : ButtonStyle.Danger)
          ];

          const updatedRow1 = new ActionRowBuilder().addComponents(updatedButtons.slice(0, 3));
          const updatedRow2 = new ActionRowBuilder().addComponents(updatedButtons.slice(3, 5));

          await i.deferUpdate(); // Defer to handle state
          await i.editReply({
            embeds: [embed],
            components: [updatedRow1, updatedRow2]
          });
        } catch (error) {
          console.error(`Error handling button interaction (action: ${i.customId}, guild: ${guildId}, replied: ${i.replied}, deferred: ${i.deferred}):`, error);
          if (!i.replied && !i.deferred) {
            await i.reply({ content: 'An error occurred while processing the button.', ephemeral: true }).catch(err => console.error('Failed to reply to button error:', err));
          }
        }
      });

      collector.on('end', async () => {
        await interaction.editReply({ components: [], embeds: [embed.setDescription('Anti-raid settings closed.')] }).catch(err => console.error('Failed to end collector:', err));
      });
    }
  } catch (error) {
    console.error(`Error handling slash command (${commandName}, guild: ${guildId}):`, error);
    if (!interaction.replied) {
      await interaction.reply({ content: 'An error occurred while processing the command.', ephemeral: true }).catch(err => console.error('Failed to reply to command error:', err));
    }
  }
});

// Handle modal submissions
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;

  try {
    const [action, guildId] = interaction.customId.split('_');
    if (!guildId || action !== 'antiFakeModal') {
      console.log(`Invalid modal submission: ${interaction.customId}`);
      return;
    }

    initializeGuildSettings(guildId);

    const minDaysInput = interaction.fields.getTextInputValue('minDays').trim();
    const minDays = parseInt(minDaysInput);

    if (isNaN(minDays) || minDays < 0 || minDaysInput === '') {
      return interaction.reply({ content: 'Please enter a valid positive number of days.', ephemeral: true });
    }

    settings.antiRaid[guildId].antiFake.enabled = true;
    settings.antiRaid[guildId].antiFake.minDays = minDays;
    saveSettings();
    await interaction.reply({ content: `Anti-Fake is now ON with a minimum account age of ${minDays} days.`, ephemeral: true });
  } catch (error) {
    console.error(`Error handling modal submission (guild: ${interaction.guildId}):`, error);
    if (!interaction.replied) {
      await interaction.reply({ content: 'An error occurred while processing the modal.', ephemeral: true }).catch(err => console.error('Failed to reply to modal error:', err));
    }
  }
});

// Anti-raid event handlers
client.on('guildMemberAdd', async member => {
  const { guild } = member;
  if (!guild) return;

  initializeGuildSettings(guild.id);

  if (settings.antiRaid[guild.id].antiBot && member.user.bot) {
    try {
      if (!guild.members.me || !guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        console.log('Missing Kick Members permission or bot member cache for anti-bot action.');
        return;
      }
      await member.kick('Anti-Bot protection enabled.');
      console.log(`Kicked bot ${member.user.tag}`);
    } catch (error) {
      console.error(`Failed to kick bot ${member.user.tag}:`, error);
    }
  }

  if (settings.antiRaid[guild.id].antiFake.enabled) {
    const accountAgeDays = (Date.now() - member.user.createdAt) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < settings.antiRaid[guild.id].antiFake.minDays) {
      try {
        if (!guild.members.me || !guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          console.log('Missing Kick Members permission or bot member cache for anti-fake action.');
          return;
        }
        await member.kick(`Account too new (${accountAgeDays.toFixed(1)} days). Minimum: ${settings.antiRaid[guild.id].antiFake.minDays} days.`);
        console.log(`Kicked new account ${member.user.tag}`);
      } catch (error) {
        console.error(`Failed to kick ${member.user.tag}:`, error);
      }
    }
  }
});

client.on('channelDelete', async channel => {
  const { guild } = channel;
  if (!guild) return;

  initializeGuildSettings(guild.id);

  if (settings.antiRaid[guild.id].channelDelete) {
    try {
      if (!guild.members.me || !guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        console.log('Missing View Audit Log permission or bot member cache for channel delete protection.');
        return;
      }
      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        console.log('Missing Ban Members permission for channel delete protection.');
        return;
      }
      await delay(1000); // Wait for audit log availability
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
      const entry = auditLogs.entries.first();
      if (!entry) {
        console.log(`No audit log entry found for channel deletion: ${channel.name}`);
        return;
      }
      const { executor } = entry;
      if (executor.id === client.user.id) {
        console.log('Ignoring channel deletion by bot itself.');
        return;
      }
      await guild.members.ban(executor.id, { reason: 'Deleted a channel with anti-raid protection enabled.' });
      console.log(`Banned ${executor.tag} for deleting channel ${channel.name}`);
    } catch (error) {
      console.error(`Failed to ban for channel deletion (${channel.name}):`, error);
    }
  }
});

client.on('channelCreate', async channel => {
  const { guild } = channel;
  if (!guild) return;

  initializeGuildSettings(guild.id);

  if (settings.antiRaid[guild.id].channelCreate) {
    try {
      if (!guild.members.me || !guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        console.log('Missing View Audit Log permission or bot member cache for channel create protection.');
        return;
      }
      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        console.log('Missing Ban Members permission for channel create protection.');
        return;
      }
      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        console.log('Missing Manage Channels permission for channel create protection.');
        return;
      }
      await delay(1000); // Wait for audit log availability
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 });
      const entry = auditLogs.entries.first();
      if (!entry) {
        console.log(`No audit log entry found for channel creation: ${channel.name}`);
        return;
      }
      const { executor } = entry;
      if (executor.id === client.user.id) {
        console.log('Ignoring channel creation by bot itself.');
        return;
      }
      await guild.members.ban(executor.id, { reason: 'Created a channel with anti-raid protection enabled.' });
      await channel.delete('Anti-raid protection enabled.');
      console.log(`Banned ${executor.tag} for creating channel ${channel.name}`);
    } catch (error) {
      console.error(`Failed to ban or delete channel (${channel.name}):`, error);
    }
  }
});

client.on('roleDelete', async role => {
  const { guild } = role;
  if (!guild) return;

  initializeGuildSettings(guild.id);

  if (settings.antiRaid[guild.id].roleDelete) {
    try {
      if (!guild.members.me || !guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        console.log('Missing View Audit Log permission or bot member cache for role delete protection.');
        return;
      }
      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        console.log('Missing Ban Members permission for role delete protection.');
        return;
      }
      await delay(1000); // Wait for audit log availability
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
      const entry = auditLogs.entries.first();
      if (!entry) {
        console.log(`No audit log entry found for role deletion: ${role.name}`);
        return;
      }
      const { executor } = entry;
      if (executor.id === client.user.id) {
        console.log('Ignoring role deletion by bot itself.');
        return;
      }
      await guild.members.ban(executor.id, { reason: 'Deleted a role with anti-raid protection enabled.' });
      console.log(`Banned ${executor.tag} for deleting role ${role.name}`);
    } catch (error) {
      console.error(`Failed to ban for role deletion (${role.name}):`, error);
    }
  }
});

client.login('bot_token');
