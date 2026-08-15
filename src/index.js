require('dotenv').config();

const path = require('node:path');
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client,
  EmbedBuilder, Events, GatewayIntentBits, ModalBuilder, PermissionsBitField,
  REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { Store } = require('./store');
const { buildTranscript } = require('./transcript');

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN is not set.');
const store = new Store(path.resolve(process.env.DATABASE_PATH || 'data/nodexa.json'));
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const commands = [
  new SlashCommandBuilder().setName('nodexa').setDescription('Configure Nodexa support')
    .addSubcommand(command => command.setName('setup').setDescription('Show the current Nodexa setup'))
    .addSubcommand(command => command.setName('tickets').setDescription('Set the ticket category, support role and log channel')
      .addChannelOption(option => option.setName('category').setDescription('Category for private ticket channels').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addRoleOption(option => option.setName('support_role').setDescription('Role that can see every ticket').setRequired(true))
      .addChannelOption(option => option.setName('log_channel').setDescription('Where closed transcripts are sent').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(command => command.setName('ticket-option-add').setDescription('Add a ticket choice to the panel')
      .addStringOption(option => option.setName('label').setDescription('Button/choice name').setRequired(true).setMaxLength(80))
      .addStringOption(option => option.setName('description').setDescription('Short explanation').setRequired(true).setMaxLength(100))
      .addStringOption(option => option.setName('emoji').setDescription('Optional emoji').setRequired(false).setMaxLength(32))
      .addRoleOption(option => option.setName('staff_role').setDescription('Optional role for this ticket type').setRequired(false)))
    .addSubcommand(command => command.setName('ticket-option-remove').setDescription('Remove a ticket choice')
      .addStringOption(option => option.setName('label').setDescription('Exact ticket option name').setRequired(true)))
    .addSubcommand(command => command.setName('ticket-opens').setDescription('Open or close new ticket requests')
      .addBooleanOption(option => option.setName('enabled').setDescription('Whether members can open new tickets').setRequired(true)))
    .addSubcommand(command => command.setName('panel').setDescription('Post the ticket panel')
      .addChannelOption(option => option.setName('channel').setDescription('Channel for the support panel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(command => command.setName('welcome').setDescription('Configure embedded welcome messages')
      .addChannelOption(option => option.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(option => option.setName('title').setDescription('Embed title').setRequired(true).setMaxLength(256))
      .addStringOption(option => option.setName('message').setDescription('Use {user}, {server}, {memberCount}').setRequired(true).setMaxLength(4000))
      .addStringOption(option => option.setName('colour').setDescription('Hex colour, e.g. #5865F2').setRequired(false)))
    .addSubcommand(command => command.setName('goodbye').setDescription('Configure embedded goodbye messages')
      .addChannelOption(option => option.setName('channel').setDescription('Goodbye channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(option => option.setName('title').setDescription('Embed title').setRequired(true).setMaxLength(256))
      .addStringOption(option => option.setName('message').setDescription('Use {user}, {server}, {memberCount}').setRequired(true).setMaxLength(4000))
      .addStringOption(option => option.setName('colour').setDescription('Hex colour, e.g. #ED4245').setRequired(false)))
    .toJSON()
];

function admin(member) { return member.permissions.has(PermissionsBitField.Flags.ManageGuild) || member.permissions.has(PermissionsBitField.Flags.Administrator); }
function support(member, config) {
  const roleIds = member.roles?.cache || new Map((member.roles || []).map(roleId => [roleId, true]));
  return admin(member) || (config.supportRoleId && roleIds.has(config.supportRoleId));
}
function cleanName(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ticket'; }
function template(text, guild, user) { return String(text).replaceAll('{user}', `<@${user.id}>`).replaceAll('{server}', guild.name).replaceAll('{memberCount}', String(guild.memberCount)); }
function colour(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback; }

function ticketPanel(config) {
  const embed = new EmbedBuilder().setTitle('Nodexa Support').setDescription(config.ticketsOpen ? 'Choose the option that best matches what you need help with.' : 'Ticket requests are currently closed.').setColor(config.ticketsOpen ? 0x5865F2 : 0xED4245);
  const rows = [];
  if (config.ticketsOpen && config.ticketOptions.length) {
    const select = new StringSelectMenuBuilder().setCustomId('nodexa:open-ticket').setPlaceholder('Choose a support option').addOptions(config.ticketOptions.slice(0, 25).map(option => ({ label: option.label, value: option.id, description: option.description, emoji: option.emoji || undefined })));
    rows.push(new ActionRowBuilder().addComponents(select));
  }
  return { embeds: [embed], components: rows };
}

function ticketControls() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('nodexa:claim-ticket').setLabel('Claim ticket').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('nodexa:close-ticket').setLabel('Close ticket').setStyle(ButtonStyle.Danger)
  )];
}

async function createTicket(interaction, option) {
  const guild = interaction.guild;
  const config = store.guild(guild.id);
  if (!config.ticketsOpen) return interaction.reply({ content: 'Ticket requests are currently closed.', ephemeral: true });
  if (!config.ticketCategoryId || !config.supportRoleId || !config.ticketLogChannelId) return interaction.reply({ content: 'Nodexa has not been fully configured yet.', ephemeral: true });
  const existing = store.activeTicketFor(guild.id, interaction.user.id);
  if (existing) return interaction.reply({ content: `You already have an open ticket: <#${existing.channelId}>`, ephemeral: true });
  const staffRoleIds = [...new Set([config.supportRoleId, option.staffRoleId].filter(Boolean))];
  const channel = await guild.channels.create({
    name: `${cleanName(option.label)}-${cleanName(interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: `Nodexa ticket for ${interaction.user.id} | ${option.label}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ...staffRoleIds.map(roleId => ({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }))
    ],
    reason: `Nodexa ticket opened: ${option.label}`
  });
  await store.setTicket(channel.id, { channelId: channel.id, guildId: guild.id, userId: interaction.user.id, optionLabel: option.label, openedAt: Date.now(), status: 'open', claimedBy: null });
  const embed = new EmbedBuilder().setTitle(`${option.label} ticket`).setDescription(`${interaction.user}, a support member will be with you shortly.\n\nPlease explain your issue clearly and do not share passwords or account codes.`).setColor(0x5865F2).setFooter({ text: 'Nodexa Support' });
  await channel.send({ content: `${interaction.user} ${staffRoleIds.map(roleId => `<@&${roleId}>`).join(' ')}`, embeds: [embed], components: ticketControls(), allowedMentions: { users: [interaction.user.id], roles: staffRoleIds } });
  await interaction.reply({ content: `Your ticket has been opened: ${channel}`, ephemeral: true });
}

async function allMessages(channel) {
  const messages = [];
  let before;
  while (messages.length < 5000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return messages;
}

async function closeTicket(interaction, channelId) {
  const ticket = store.ticket(channelId);
  if (!ticket || ticket.status !== 'open') return interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
  const config = store.guild(ticket.guildId);
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return interaction.editReply('The ticket channel no longer exists, so there is no transcript to create.');
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  const transcriptData = buildTranscript(channel, await allMessages(channel));
  const transcriptName = `nodexa-ticket-${channel.name}.html`;
  const transcriptAttachment = () => new AttachmentBuilder(Buffer.from(transcriptData), { name: transcriptName });
  const logChannel = interaction.guild.channels.cache.get(config.ticketLogChannelId);
  if (logChannel?.isTextBased()) await logChannel.send({ embeds: [new EmbedBuilder().setTitle('Ticket closed').setDescription(`**Ticket:** ${ticket.optionLabel}\n**Member:** <@${ticket.userId}>\n**Closed by:** ${interaction.user}`).setColor(0xED4245)], files: [transcriptAttachment()] });
  if (user) await user.send({ content: `Your Nodexa support ticket in **${interaction.guild.name}** has been closed. Your transcript is attached.`, files: [transcriptAttachment()] }).catch(() => null);
  await store.closeTicket(channelId);
  await interaction.editReply('Transcript sent to the log channel and ticket member where possible. This channel will now be deleted.');
  setTimeout(() => channel.delete('Nodexa ticket closed').catch(() => null), 5000);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  if (process.env.GUILD_ID) await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
  else await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

client.once(Events.ClientReady, async ready => {
  await registerCommands();
  console.log(`Nodexa online as ${ready.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'nodexa:open-ticket') {
      const config = store.guild(interaction.guild.id);
      const option = config.ticketOptions.find(item => item.id === interaction.values[0]);
      if (!option) return interaction.reply({ content: 'That ticket option no longer exists.', ephemeral: true });
      return createTicket(interaction, option);
    }
    if (interaction.isButton()) {
      const ticket = store.ticket(interaction.channelId);
      if (!ticket) return;
      const config = store.guild(interaction.guild.id);
      if (!support(interaction.member, config)) return interaction.reply({ content: 'Only support staff can use this.', ephemeral: true });
      if (interaction.customId === 'nodexa:claim-ticket') {
        ticket.claimedBy = interaction.user.id;
        await store.save();
        return interaction.reply({ content: `${interaction.user} has claimed this ticket.` });
      }
      if (interaction.customId === 'nodexa:close-ticket') {
        const confirm = new ButtonBuilder().setCustomId('nodexa:confirm-close-ticket').setLabel('Confirm close').setStyle(ButtonStyle.Danger);
        return interaction.reply({ content: 'Close this ticket and send its transcript?', components: [new ActionRowBuilder().addComponents(confirm)], ephemeral: true });
      }
      if (interaction.customId === 'nodexa:confirm-close-ticket') return closeTicket(interaction, interaction.channelId);
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'nodexa') return;
    if (!admin(interaction.member)) return interaction.reply({ content: 'You need Manage Server or Administrator to configure Nodexa.', ephemeral: true });
    const config = store.guild(interaction.guild.id);
    const action = interaction.options.getSubcommand();
    if (action === 'setup') return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Nodexa setup').setColor(0x5865F2).setDescription(`**Tickets:** ${config.ticketsOpen ? 'Open' : 'Closed'}\n**Category:** ${config.ticketCategoryId ? `<#${config.ticketCategoryId}>` : 'Not set'}\n**Support role:** ${config.supportRoleId ? `<@&${config.supportRoleId}>` : 'Not set'}\n**Ticket log:** ${config.ticketLogChannelId ? `<#${config.ticketLogChannelId}>` : 'Not set'}\n**Ticket options:** ${config.ticketOptions.map(option => option.label).join(', ') || 'None'}`)], ephemeral: true });
    if (action === 'tickets') {
      config.ticketCategoryId = interaction.options.getChannel('category').id;
      config.supportRoleId = interaction.options.getRole('support_role').id;
      config.ticketLogChannelId = interaction.options.getChannel('log_channel').id;
      await store.save();
      return interaction.reply({ content: 'Ticket category, support role and transcript log channel saved.', ephemeral: true });
    }
    if (action === 'ticket-option-add') {
      const label = interaction.options.getString('label');
      if (config.ticketOptions.some(option => option.label.toLowerCase() === label.toLowerCase())) return interaction.reply({ content: 'A ticket option with that name already exists.', ephemeral: true });
      if (config.ticketOptions.length >= 25) return interaction.reply({ content: 'Discord ticket menus allow a maximum of 25 options.', ephemeral: true });
      config.ticketOptions.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label, description: interaction.options.getString('description'), emoji: interaction.options.getString('emoji') || null, staffRoleId: interaction.options.getRole('staff_role')?.id || null });
      await store.save();
      return interaction.reply({ content: `Added **${label}** to the ticket panel.`, ephemeral: true });
    }
    if (action === 'ticket-option-remove') {
      const label = interaction.options.getString('label').toLowerCase();
      const before = config.ticketOptions.length;
      config.ticketOptions = config.ticketOptions.filter(option => option.label.toLowerCase() !== label);
      if (before === config.ticketOptions.length) return interaction.reply({ content: 'No ticket option with that exact name was found.', ephemeral: true });
      await store.save();
      return interaction.reply({ content: 'Ticket option removed. Existing tickets are unaffected.', ephemeral: true });
    }
    if (action === 'ticket-opens') { config.ticketsOpen = interaction.options.getBoolean('enabled'); await store.save(); return interaction.reply({ content: `New ticket requests are now **${config.ticketsOpen ? 'open' : 'closed'}**.`, ephemeral: true }); }
    if (action === 'panel') { const channel = interaction.options.getChannel('channel'); await channel.send(ticketPanel(config)); return interaction.reply({ content: `Ticket panel posted in ${channel}.`, ephemeral: true }); }
    if (action === 'welcome' || action === 'goodbye') {
      const setting = config[action];
      setting.channelId = interaction.options.getChannel('channel').id;
      setting.title = interaction.options.getString('title');
      setting.description = interaction.options.getString('message');
      setting.colour = colour(interaction.options.getString('colour'), action === 'welcome' ? '#5865F2' : '#ED4245');
      await store.save();
      return interaction.reply({ content: `${action === 'welcome' ? 'Welcome' : 'Goodbye'} embed saved.`, ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    if (interaction.deferred) await interaction.editReply('Something went wrong. Check the Nodexa hosting console.');
    else if (!interaction.replied) await interaction.reply({ content: 'Something went wrong. Check the Nodexa hosting console.', ephemeral: true });
  }
});

async function memberMessage(member, type) {
  const config = store.guild(member.guild.id);
  const setting = config[type];
  const channel = member.guild.channels.cache.get(setting.channelId);
  if (!channel?.isTextBased()) return;
  const embed = new EmbedBuilder().setTitle(template(setting.title, member.guild, member.user)).setDescription(template(setting.description, member.guild, member.user)).setColor(colour(setting.colour, type === 'welcome' ? '#5865F2' : '#ED4245')).setThumbnail(member.user.displayAvatarURL()).setFooter({ text: `Nodexa | ${member.guild.name}` });
  await channel.send({ embeds: [embed], allowedMentions: { users: [member.id] } });
}

client.on(Events.GuildMemberAdd, member => memberMessage(member, 'welcome').catch(console.error));
client.on(Events.GuildMemberRemove, member => memberMessage(member, 'goodbye').catch(console.error));

store.load().then(() => client.login(token));
