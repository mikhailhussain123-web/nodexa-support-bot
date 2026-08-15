const fs = require('node:fs/promises');
const path = require('node:path');

const emptyData = () => ({ guilds: {}, tickets: {} });

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = emptyData();
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.data = { ...emptyData(), ...JSON.parse(await fs.readFile(this.filePath, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  async save() {
    const write = async () => {
      const temporary = `${this.filePath}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(this.data, null, 2), 'utf8');
      await fs.rename(temporary, this.filePath);
    };
    this.pendingWrite = this.pendingWrite.then(write, write);
    return this.pendingWrite;
  }

  guild(guildId) {
    if (!this.data.guilds[guildId]) {
      this.data.guilds[guildId] = {
        ticketOptions: [], ticketsOpen: true, ticketCategoryId: null,
        supportRoleId: null, ticketLogChannelId: null,
        welcome: { channelId: null, title: 'Welcome to {server}!', description: 'Welcome {user}! Please read the rules and enjoy your stay.', colour: '#5865F2' },
        goodbye: { channelId: null, title: 'Goodbye from {server}', description: '{user} has left the server.', colour: '#ED4245' }
      };
    }
    return this.data.guilds[guildId];
  }

  ticket(channelId) {
    return this.data.tickets[channelId] || null;
  }

  activeTicketFor(guildId, userId) {
    return Object.values(this.data.tickets).find(ticket => ticket.guildId === guildId && ticket.userId === userId && ticket.status === 'open') || null;
  }

  async setTicket(channelId, ticket) {
    this.data.tickets[channelId] = ticket;
    await this.save();
  }

  async closeTicket(channelId) {
    if (!this.data.tickets[channelId]) return null;
    this.data.tickets[channelId].status = 'closed';
    this.data.tickets[channelId].closedAt = Date.now();
    await this.save();
    return this.data.tickets[channelId];
  }
}

module.exports = { Store };
