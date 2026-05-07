# 📱 WhatsApp AI Agent

> Control your computer remotely via WhatsApp — powered by a local [Ollama](https://ollama.com) LLM.  
> Navigate files, send them to your phone, or ask the AI anything. **No data leaves your machine.**

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-20%2B-blue)
![Ollama](https://img.shields.io/badge/powered%20by-Ollama-orange)

---

## ✨ Features

- 📂 Browse and navigate your filesystem from WhatsApp
- 📤 Send files directly to your chat
- 🤖 Ask the local LLM anything — it can navigate and reason about your files
- 🔒 Owner-only access — all other senders are silently ignored
- 🛡️ Sandboxed to allowed directories — no shell execution, no traversal attacks

---

## 📋 Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 20+ LTS | `node -v` to check |
| **npm** | 10+ | Bundled with Node |
| **Ollama** | Latest | [ollama.com/download](https://ollama.com/download) |
| **llama3.2** | — | ~2 GB, pulled in step 3 |

> **Windows users:** Use backslashes in `ALLOWED_ROOTS`, e.g. `C:\Users\YourName\projects`

---

## 🚀 Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Muneeb21-hub/whatsapp-ai-agent
cd whatsapp-ai-agent
npm install
cp .env.example .env
```

### 2. Configure `.env`

| Variable | Description |
|---|---|
| `OWNER` | Your WhatsApp number — **digits only**, no `+` or spaces |
| `OLLAMA_URL` | Ollama server URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Model name (default: `llama3.2`) |
| `ALLOWED_ROOTS` | Comma-separated absolute paths the agent may access |
| `LOG_LEVEL` | `trace` / `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | `development` (pretty logs) or `production` (JSON) |

### 3. Start Ollama

```bash
# One-time model download (~2 GB)
ollama pull llama3.2

# Keep this running in a separate terminal
ollama serve

# Verify
curl http://localhost:11434/api/tags
```

### 4. Run the agent

```bash
# Development — auto-restarts on file changes
npm run dev

# Production
npm start
```

On first run, a **QR code** appears in the terminal. Scan it via:  
**WhatsApp → Settings → Linked Devices → Link a Device**

The session is saved in `auth/`. Subsequent starts skip the QR scan. To reset, delete `auth/` and restart.

---

## 💬 Command Reference

All commands must begin with `!` and be sent **from the OWNER number only**.

| Command | Example | Description |
|---|---|---|
| `!cd <path>` | `!cd /home/user/projects` | Change directory (absolute or relative) |
| `!ls [path]` | `!ls /home/user/downloads` | List directory contents |
| `!find <query> [in <path>]` | `!find invoice in /home/user` | Find files by name (case-insensitive) |
| `!send <filename>` | `!send report.pdf` | Send a file; `!send latest` for newest in cwd |
| `!ai <prompt>` | `!ai what files should I clean up?` | Ask the LLM — it can navigate and reply |

---

## 🔒 Security

### Owner lock
Only the `OWNER` phone number is processed. All other senders are silently ignored.

### Allowed roots
File operations (`cd`, `ls`, `find`, `send`) are restricted to:
- Paths listed in `ALLOWED_ROOTS`
- The project's `files/` directory (always included)

Access outside these roots returns `❌ Access denied` — the operation is never performed.

### Path traversal protection
All paths are resolved via `path.resolve()` before any check. `../../../etc/passwd`-style attacks are blocked.

### No shell execution
The agent performs read-only operations only. There is no `exec`, `spawn`, or shell injection risk.

---

## ⚙️ Keeping the Agent Online (PM2)

[PM2](https://pm2.keymetrics.io/) runs the agent in the background and auto-restarts on crashes.

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name "whatsapp-ai-agent"
pm2 save
pm2 startup        # Linux/macOS
pm2 startup windows # Windows
```

```bash
pm2 logs whatsapp-ai-agent
pm2 restart whatsapp-ai-agent
pm2 stop whatsapp-ai-agent
```

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| QR code expired | Restart: `npm run dev` |
| `ECONNREFUSED 127.0.0.1:11434` | Run `ollama serve` |
| `❌ Access denied` | Add the path to `ALLOWED_ROOTS` in `.env` |
| Session expired / logged out | `rm -rf auth/ && npm run dev` |
| `model 'llama3.2' not found` | `ollama pull llama3.2` |
| Want a different model | Set `OLLAMA_MODEL=mistral` (or any pulled model) in `.env` |

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Commit with [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`
3. Open a pull request against `main` with a clear description of what and why

For large changes, please open an issue first to discuss the approach.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
