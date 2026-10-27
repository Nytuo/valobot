<h1 align="center">
  <a href="https://github.com/Nytuo/Valobot">
    <img src="public/assets/banner.png" alt="Valobot Banner" width="auto" height="260">
  </a>
</h1>
<div align="center">
<h2>Valobot</h2>
Find and stack mates for Valorant the easy way — Discord Bot & Real-Time Web Hub
  <br />
  <br />
  <a href="https://github.com/Nytuo/Valobot/issues/new?assignees=&labels=bug&template=01_BUG_REPORT.md&title=bug%3A+">Report a Bug</a>
  ·
  <a href="https://github.com/Nytuo/Valobot/issues/new?assignees=&labels=enhancement&template=02_FEATURE_REQUEST.md&title=feat%3A+">Request a Feature</a>
  ·
  <a href="https://github.com/Nytuo/Valobot/discussions">Ask a Question</a>

</div>

<div align="center">
<br />

[![Project license](https://img.shields.io/github/license/Nytuo/Valobot.svg?style=flat-square)](LICENSE)
[![code with love by Nytuo](https://img.shields.io/badge/%3C%2F%3E%20with%20%E2%99%A5%20by-Nytuo-ff1414.svg?style=flat-square)](https://github.com/Nytuo)
[![docker](https://img.shields.io/badge/docker_compose-ready-2496ed.svg?style=flat-square&logo=docker)](docker-compose.yml)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865f2.svg?style=flat-square&logo=discord)](https://discord.js.org/)

</div>

<details open="open">
<summary>Table of Contents</summary>

- [About](#about)
- [What Valobot Can Do](#what-valobot-can-do)
- [6-Way Voting System](#6-way-voting-system)
- [Smart Stacking & Roster Algorithm](#smart-stacking--roster-algorithm)
- [Diagonal CANCELLED Rubber Stamp](#diagonal-cancelled-rubber-stamp)
- [Web Dashboard (valobot.example.com)](#web-dashboard-valobotnytuofr)
- [Security & Anti-Spam Protections](#security--anti-spam-protections)
- [Docker Compose Deployment](#docker-compose-deployment)
- [Apache Reverse Proxy (valobot.example.com)](#apache-reverse-proxy-valobotnytuofr)
- [Discord Bot & OAuth2 Setup](#discord-bot--oauth2-setup)
- [Technologies](#technologies)
- [Authors & contributors](#authors--contributors)
- [License](#license)

</details>

---

## About

**Valobot** is a self-hosted Discord bot and real-time Web Application engineered to organize and fill Valorant party stacks (Duo, Trio, or Full 5-Stack).

Instead of sending messy group messages, players launch a recruitment session via Discord slash commands or directly through the web dashboard. Teammates vote on their availability with a single click, and the bot automatically sorts players into Team 1, forms a secondary Team 2 if counts permit, routes extra players to reserves, and seals cancelled sessions with an authentic diagonal rubber stamp.

---

## What Valobot Can Do

- **Flexible Party Sizes:**
  - `5-Stack` (Full team)
  - `Trio` (3-stack)
  - `Duo` (2-stack)

- **Slash Commands with Aliases:**
  - Launch votes directly using `/valo`, `/valorant`, or `/youwanttoplay`
  - Pass custom parameters (`party_time`, `vote_deadline`, `party_size`, `target_role`, `note`)
  - Sender Modal UI: typing `/valo` with no arguments opens an interactive Discord modal form

- **Discord Relative Countdown Timers:**
  - Native Discord timestamps (`<t:TIMESTAMP:F>`, `<t:TIMESTAMP:R>`) adapt to every user's local timezone
  - Auto-locking: when the vote deadline is reached, voting closes and the final roster is announced

- **Automatic Host Auto-Vote:**
  - The session creator is automatically voted as *"I'm sure to be there"* upon launch, with the ability to modify or withdraw their vote later

- **Real-Time Web Dashboard (`valobot.example.com`):**
  - Dark Valorant HUD theme (Radianite red `#ff4655`, dark slate `#0f1923`, neon mint `#00f59b`)
  - Live bi-directional synchronization powered by WebSockets
  - Live visual slot indicators (#1 to #5) showing locked players and open spots
  - Interactive web voting directly from your browser

- **Channel Lockdown & Admin Containment:**
  - Contain Valobot commands to a designated channel via `ALLOWED_CHANNEL_IDS` or Discord's native Integration settings
  - Prevents bot commands from cluttering general channels

---

## 6-Way Voting System

Members cast their availability by clicking interactive buttons under the Discord message or on the Web App:

| Vote Option | Icon | Description & Priority Logic |
|---|---|---|
| **I'm sure to be there** | 🟢 | First-come, first-served slot in the active stack (Team 1). Overflow creates Team 2. |
| **Will try (Maybe)** | 🟡 | Tentative players listed under the tentative reserves queue. |
| **If a last** | 🟣 | Automatically drafted into the stack if exactly 1 player is needed to complete the party (e.g. 4/5). |
| **If needed (Backup)** | 🟠 | Reserve queue ordered by chronological timestamp of response. |
| **No** | 🔴 | Clearly marks unavailable teammates. |
| **Didn't respond** | ⚪ | Automatically identifies and tracks invited role members who haven't voted yet. |
| **Clear Vote** | 🗑️ | Allows any player to change or remove their vote before deadline. |

---

## Smart Stacking & Roster Algorithm

Valobot automatically calculates optimal team allocation in real time:

1. **Team 1:** Takes the first $N$ *"Sure"* players in order of response timestamp.
2. **Team 2 & Additional Teams:** If the count of *"Sure"* players reaches or exceeds $2N$ (e.g. 10 players for a 5-stack), a secondary squad is automatically created!
3. **"If a Last" Completion Rule:** When an active team needs only 1 player to reach capacity ($N - 1$), the first player with the *"If a last"* vote is automatically promoted into the roster.
4. **Reserves Queue:** Unassigned *"Sure"*, *"If a last"*, and *"Backup"* players are placed in the reserve list in strict chronological order.

---

## Diagonal CANCELLED Rubber Stamp

If the host or a server administrator clicks **"🛑 Cancel Vote"**:

- The message **remains in the Discord feed** without being deleted.
- All voting buttons are locked and disabled.
- The server-side Canvas rendering engine (`@napi-rs/canvas`) generates a high-resolution PNG banner overlaid with an authentic, tilted rubber stamp reading **`CANCELLED`** in bold crimson ink with distress textures.
- The web app mirrors the same diagonal stamp animation in real time.

---

## Web Dashboard (`valobot.example.com`)

Valobot includes a companion web dashboard running on Node.js and WebSockets behind your Apache reverse proxy:

- **Live Stacking Overview:** Real-time roster view, countdown timers, and team status.
- **Web Session Launcher:** Launch recruitment votes to specific Discord channels with custom time chips (`+30m`, `+1h`, `21:00`, `15m before`).
- **Interactive Web Voting:** Players can vote directly from their web browser.
- **Demo Mode:** Includes a *"✨ Load Demo Session"* button to test and preview stacking rosters without needing an active bot connection.

---

## Security & Anti-Spam Protections

To prevent channel spamming and unauthorized pings:

- **Discord OAuth2 Authentication:** Anonymous visitors cannot view servers or launch sessions. Logging in with Discord checks actual guild memberships and permissions.
- **Permission-Filtered Channels:** Users can only select channels where they have `SendMessages` and `ViewChannel` permissions.
- **Strict Header Sanitization:** All `@everyone`, `@here`, `<@user>`, and `<@&role>` mention tags are stripped automatically. Titles are limited to 50 characters with preset mode chips (*Ranked*, *Premier*, *Unrated*, *Swiftplay*, *Custom 5v5*).
- **One Active Session per Channel:** Prevents duplicate concurrent sessions from running in the same channel.
- **Anti-Spam Cooldown:** Enforces a 3-minute cooldown per user between session launches.

---

## Docker Compose Deployment

Valobot is designed to be executed under **Docker Compose**:

### 1. Configuration (`.env`)

Copy `.env.example` to `.env` and fill in your values:

```env
# Port for Node.js server and Docker port mapping
PORT=6788

# Public URL behind reverse proxy
WEB_BASE_URL=https://valobot.example.com

# Discord Bot Credentials
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here

# (Optional) Restrict commands to specific channel ID(s)
ALLOWED_CHANNEL_IDS=
```

> 💡 **Automatic Port Propagation:** Setting `PORT=6788` in `.env` automatically maps the host port `6788:6788`, passes `PORT=6788` into the container, and starts Express on port `6788`.

### 2. Start the Service

```bash
# Build image and start container in background
docker compose up -d --build

# View real-time logs
docker compose logs -f

# Stop the container
docker compose down
```

---

## Apache Reverse Proxy (`valobot.example.com`)

The project includes a ready-to-use VirtualHost configuration in [`apache/valobot.conf`](apache/valobot.conf):

```apache
<VirtualHost *:80>
    ServerName valobot.example.com
    RewriteEngine On
    RewriteCond %{SERVER_NAME} =valobot.example.com
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]
</VirtualHost>

<VirtualHost *:443>
    ServerName valobot.example.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/example.com/privkey.pem
    IncludeOptional /etc/letsencrypt/options-ssl-apache.conf

    ProxyPreserveHost On
    ProxyRequests Off

    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    # WebSocket Proxy
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)           ws://127.0.0.1:6788/$1 [P,L]

    ProxyPass /ws ws://127.0.0.1:6788/ws
    ProxyPassReverse /ws ws://127.0.0.1:6788/ws

    # Main Web App & API
    ProxyPass / http://127.0.0.1:6788/
    ProxyPassReverse / http://127.0.0.1:6788/

    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-XSS-Protection "1; mode=block"

    ErrorLog logs/valobot_error.log
    CustomLog logs/valobot_access.log combined
</VirtualHost>
```

> ⚠️ If Apache runs inside Docker on an external network (e.g. `proxy-nw`), replace `127.0.0.1:6788` with `valobot:6788`.

---

## Discord Bot & OAuth2 Setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select your application.
2. Under **Bot**:
   - Reset and copy your token into `DISCORD_BOT_TOKEN`.
   - Only standard **Guilds** intent is required (no privileged intents needed).
3. Under **OAuth2 > General**:
   - Reset and copy your **Client Secret** into `DISCORD_CLIENT_SECRET`.
   - Add your redirect URI: `https://valobot.example.com/api/auth/callback`.
4. Under **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`.
   - Bot Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`.
   - Open the generated URL to invite Valobot to your Discord server.

---

## Technologies

<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
  <img src="https://img.shields.io/badge/NodeJS-black?style=for-the-badge&logo=node.js"/>
  <img src="https://img.shields.io/badge/Discord.js-black?style=for-the-badge&logo=discord"/>
  <img src="https://img.shields.io/badge/Express-black?style=for-the-badge&logo=express"/>
  <img src="https://img.shields.io/badge/Docker-black?style=for-the-badge&logo=docker"/>
  <img src="https://img.shields.io/badge/Apache-black?style=for-the-badge&logo=apache"/>
  <img src="https://img.shields.io/badge/WebSocket-black?style=for-the-badge&logo=socketdotio"/>
  <img src="https://img.shields.io/badge/Canvas-black?style=for-the-badge&logo=html5"/>
</div>

---

## Authors & contributors

The original setup of this repository is by [Arnaud BEUX (Nytuo)](https://github.com/Nytuo).

For a full list of all authors and contributors, see [the contributors page](https://github.com/Nytuo/Valobot/contributors).

---

## License

Valobot is licensed under the **GNU General Public License v3**.
Valobot is provided **"as is"** without any **warranty**. Use at your own risk.
See [LICENSE](LICENSE) for more information.
