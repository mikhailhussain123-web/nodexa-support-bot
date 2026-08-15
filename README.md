# Nodexa Support Bot

Nodexa is a standalone Node.js Discord support bot with configurable private tickets, HTML transcripts, embedded welcome/goodbye messages and ticket-log delivery.

## Discord setup

1. Create a new Discord application and bot called **Nodexa**.
2. In the Bot tab, enable **Server Members Intent** and **Message Content Intent**.
3. Invite it with the `bot` and `applications.commands` scopes. It needs Manage Channels, Manage Roles, Read Message History, Send Messages, Attach Files and View Channels.
4. On the hosting server, set `DISCORD_TOKEN` and optionally `GUILD_ID` in Environment Variables.

## First server setup

1. `/nodexa tickets` — choose ticket category, support role and transcript log channel.
2. `/nodexa ticket-option-add` — add one or more ticket options.
3. `/nodexa panel` — post the ticket panel.
4. `/nodexa welcome` and `/nodexa goodbye` — configure embedded member messages.

Use `{user}`, `{server}` and `{memberCount}` in welcome/goodbye text.

## Commands

- `/nodexa setup`
- `/nodexa tickets`
- `/nodexa ticket-option-add`
- `/nodexa ticket-option-remove`
- `/nodexa ticket-opens`
- `/nodexa panel`
- `/nodexa welcome`
- `/nodexa goodbye`
