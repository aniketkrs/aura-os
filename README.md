# ✦ Aura OS

**Terminal-Native AI Operating System — Project Z×Claw**

[![npm version](https://img.shields.io/npm/v/aura-os?color=a78bfa&style=flat-square)](https://www.npmjs.com/package/aura-os)
[![npm downloads](https://img.shields.io/npm/dm/aura-os?color=22d3ee&style=flat-square)](https://www.npmjs.com/package/aura-os)
[![license](https://img.shields.io/npm/l/aura-os?color=34d399&style=flat-square)](LICENSE)
[![node](https://img.shields.io/node/v/aura-os?color=f59e0b&style=flat-square)](package.json)

> Everything happens inside your terminal. No browser, no GUI, no pop-ups.
> Chat with AI, manage tasks, read email, browse the web, run agents — all from one place.

---

## Install & Run

```bash
# Install globally
npm install -g aura-os

# Run
aura-os

# Or use npx (no install needed)
npx aura-os
```

### From Source

```bash
git clone https://github.com/aniketkrs/aura-os.git
cd aura-os
npm install
npm start
```

On first launch, Aura OS runs onboarding: name, role, purpose, and PIN setup.
**Every subsequent launch requires your PIN.**

---

## ✨ Features

- 🦕 **Cute boot animation** — dino greets you on startup
- 💬 **Natural language** — type "check my mail" instead of `/mail inbox`
- 🤖 **AI Chat** — OpenAI, Anthropic, Gemini, Mistral, or local Ollama
- 📧 **Email** — read inbox, compose, send (IMAP/SMTP)
- 🌐 **Web Browser** — browse any URL right in the terminal
- 📋 **Tasks** — create, track, and complete tasks
- 📅 **Calendar** — view upcoming events
- 🧠 **Agents** — 8 built-in agents + custom agent builder
- 🔒 **Secure** — PIN auth, encrypted storage, API key protection
- 🎨 **Unique ASCII banners** — each agent has its own art & color

---

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Full command reference |
| `/dash` | Dashboard |
| `/chat [msg]` | Chat with Aura LLM |
| `/task add <title>` | Create a task |
| `/task list` | List all tasks |
| `/mail inbox` | View email inbox |
| `/mail send` | Compose email |
| `/browse <url>` | Browse URL in terminal |
| `/search <query>` | Web search |
| `/agent start <name>` | Start an agent |
| `/model <name>` | Switch LLM model |
| `/status` | System status |
| `/quit` | Exit |

### Natural Language (no slash needed!)

| Just type... | Does... |
|---|---|
| `check my mail` | Opens inbox |
| `show my tasks` | Lists tasks |
| `search for react` | Web search |
| `open youtube.com` | Opens browser |
| `who am I` | Shows profile |

---

## 🤖 Built-in Agents

| Agent | Description |
|-------|-------------|
| Memory Keeper | Consolidates and persists context |
| Task Tracker | Monitors tasks, surfaces high-priority items |
| Research Agent | Background research tasks |
| Briefing Agent | Daily executive briefings |
| Calendar Agent | Meeting reminders |
| Writing Agent | Grammar and style suggestions |
| Study Agent | Study session tracking |

---

## LLM Models

Supports multiple providers — set API keys with `/apikey <provider>`:

| Provider | Models |
|----------|--------|
| Gemini | gemini-2.0-flash, gemini-2.5-pro |
| OpenAI | gpt-4o, gpt-4o-mini |
| Anthropic | claude-sonnet-4-5, claude-haiku |
| Mistral | mistral-large, mistral-small |
| Ollama | Any local model |

---

## Security

- PIN required on **every launch**
- PBKDF2 hashed (100k rounds, SHA-512)
- 5 failed attempts → 5-minute lockout
- API keys stored in `~/.aura/.keys.json` with `chmod 600`
- Session destroyed on exit
- API key leak detection in chat input

---

## Roles

| Role | Auto-started agents |
|------|---------------------|
| Developer | memory-keeper, task-tracker |
| Researcher | memory-keeper, research-agent |
| Executive | memory-keeper, briefing-agent, calendar-agent |
| Designer | memory-keeper |
| Student | memory-keeper, study-agent, research-agent |
| Writer | memory-keeper, writing-agent |

---

## Requirements

- Node.js ≥ 18
- At least one LLM API key (or Ollama for local)

---

## License

MIT © [Aniket Kumar](https://github.com/aniketkrs)
