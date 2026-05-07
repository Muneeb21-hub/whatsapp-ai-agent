You are a senior full-stack AI engineer. Your task is to build a complete, 
production-ready project with zero placeholders and zero pseudo-code.

═══════════════════════════════════════════════════════
PROJECT: WhatsApp AI Agent System
═══════════════════════════════════════════════════════

GOAL:
Build a TypeScript-based system that lets an authorized user control their 
computer remotely via WhatsApp messages, powered by a local Ollama LLM. 
The system must support safe command execution, smart file navigation, 
and structured AI-driven action dispatch.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECH STACK (use EXACTLY these versions/packages)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Runtime & Language:
  - Node.js 20+ (LTS)
  - TypeScript 5.x
  - tsx (NOT ts-node) — run with: npx tsx src/index.ts

WhatsApp:
  - @whiskeysockets/baileys@latest   ← maintained fork of Baileys
  - @hapi/boom                        ← peer dep for Baileys
  - qrcode-terminal                   ← QR display in terminal

AI / LLM:
  - ollama (npm package, NOT raw axios) ← official Ollama JS client

Utilities:
  - zod@3.x                 ← runtime schema validation for AI JSON output
  - pino@9.x                ← structured production logging (NOT console.log)
  - pino-pretty             ← pretty dev logs
  - dotenv@16.x
  - glob@11.x               ← modern async file globbing (NOT manual recursion)

Dev:
  - @types/node
  - typescript

DO NOT use:
  - ts-node (use tsx instead)
  - axios (use the ollama package for AI, native fetch for anything else)
  - chalk (use pino for all logging)
  - Any deprecated Baileys import paths

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ai-agent/
├── src/
│   ├── index.ts          ← entry point: boots WhatsApp + wires everything
│   ├── whatsapp.ts       ← Baileys connection, QR, message listener
│   ├── command.ts        ← parses raw "!cmd args" strings into typed objects
│   ├── executor.ts       ← executes parsed commands, returns string results
│   ├── ai.ts             ← Ollama client, system prompt, JSON action parser
│   ├── memory.ts         ← per-JID session state (cwd, history)
│   ├── config.ts         ← loads + validates env vars via zod
│   └── logger.ts         ← pino logger singleton
├── files/                ← default allowed root for file operations
├── auth/                 ← Baileys auth state persistence
├── .env
├── .env.example
├── package.json
├── tsconfig.json
└── README.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE FEATURES — implement ALL of these completely
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. WHATSAPP CONNECTION (whatsapp.ts)
   - Use makeWASocket from @whiskeysockets/baileys
   - Use useMultiFileAuthState from baileys (stores creds in auth/)
   - Display QR via qrcode-terminal on first run
   - Reconnect automatically on DisconnectReason.connectionClosed
   - Only process messages from the OWNER JID (env var)
   - Only process messages whose body starts with "!"
   - Send typing indicator before every response

2. COMMAND PARSER (command.ts)
   - Parse into a discriminated union type:
     type Command =
       | { type: 'cd';   path: string }
       | { type: 'ls';   path?: string }
       | { type: 'find'; query: string; path?: string }
       | { type: 'send'; target: string | 'latest' }
       | { type: 'ai';   prompt: string }
       | { type: 'unknown'; raw: string }
   - Trim, lowercase the command token, preserve args as-is

3. SESSION MEMORY (memory.ts)
   - Map<jid, SessionState> where SessionState = { cwd: string, history: string[] }
   - getSession(jid): creates default session if missing (cwd = files/ abs path)
   - updateCwd(jid, newPath): validates path is within ALLOWED_ROOTS before saving
   - last 10 commands stored in history for AI context

4. FILE EXECUTOR (executor.ts)
   - cd: resolve path (relative to session cwd OR absolute), validate within 
         ALLOWED_ROOTS, update session, return new cwd string
   - ls: use fs.promises.readdir with withFileTypes, return formatted list 
         showing [DIR] or [FILE] prefix and file sizes
   - find: use glob() from the glob package, match partial names case-insensitively
           within allowed roots, return up to 20 results
   - send: locate file by exact name or partial match; if target === 'latest', 
           find the most recently modified file in cwd; return absolute path 
           (whatsapp.ts will handle the actual sendMessage with document type)
   - All operations must catch errors and return human-readable error strings

5. AI MODULE (ai.ts)
   - Use the ollama npm package: import { Ollama } from 'ollama'
   - Default model: llama3.2 (configurable via OLLAMA_MODEL env var)
   - System prompt must instruct the model to ALWAYS return valid JSON matching 
     this Zod schema:
       const ActionSchema = z.discriminatedUnion('action', [
         z.object({ action: z.literal('cd'),          path: z.string() }),
         z.object({ action: z.literal('ls'),          path: z.string().optional() }),
         z.object({ action: z.literal('find'),        query: z.string() }),
         z.object({ action: z.literal('send_file'),   filename: z.string() }),
         z.object({ action: z.literal('ai_response'), message: z.string() }),
         z.object({ action: z.literal('ask'),         question: z.string() }),
         z.object({ action: z.literal('deny'),        reason: z.string() }),
       ])
   - Parse model output with ActionSchema.safeParse(); on failure, retry once 
     with an error-correction message; if still failing, return ai_response 
     with the raw text
   - Pass last 5 session history items as context in the user message

6. SECURITY
   - ALLOWED_ROOTS: string[] from env var ALLOWED_ROOTS (comma-separated abs paths)
     plus the default files/ directory
   - isPathAllowed(p): returns true only if path.resolve(p) starts with one of 
     the allowed roots
   - All cd, ls, find, send operations must call isPathAllowed before proceeding
   - OWNER check: compare sender JID (stripping @s.whatsapp.net if needed) 
     against OWNER env var

7. LOGGING (logger.ts)
   - Export a pino logger with level from LOG_LEVEL env var (default: 'info')
   - Use pino-pretty in development (NODE_ENV !== 'production')
   - Log: connection events, message receipt, command parsed, action taken, errors

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENVIRONMENT VARIABLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

.env.example must contain:
  OWNER=1234567890          # WhatsApp number, digits only, no + or spaces
  OLLAMA_URL=http://localhost:11434
  OLLAMA_MODEL=llama3.2
  ALLOWED_ROOTS=/home/user/projects,/home/user/documents
  LOG_LEVEL=info
  NODE_ENV=development

config.ts must validate all vars with zod at startup and throw a clear 
error if any required var is missing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PACKAGE.JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "scripts": {
    "dev":   "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc",
    "lint":  "tsc --noEmit"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TSCONFIG.JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}

package.json must include "type": "module"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE COMMANDS TO SUPPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  !cd /home/user/projects
  !cd ../documents        ← relative to session cwd
  !ls
  !ls /home/user/downloads
  !find report
  !send report.pdf
  !send latest
  !ai what files should I clean up in this folder?
  !ai explain machine learning in 3 bullet points

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
README.md — must include all of the following sections
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. Prerequisites (Node 20+, Ollama installed, model pulled)
  2. Installation (npm install, copy .env.example → .env, fill vars)
  3. Running Ollama (ollama pull llama3.2, ollama serve)
  4. Starting the agent (npm run dev)
  5. WhatsApp QR scan instructions
  6. Full command reference table
  7. Security notes (allowed roots, owner lock)
  8. Keeping the agent online (pm2 example)
  9. Troubleshooting (QR expired, Ollama unreachable, path denied)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✗ No placeholders, TODOs, or "implement this" comments  
✗ No pseudo-code  
✗ No skipped files  
✗ No ts-node, no axios, no chalk  
✗ No console.log (use pino logger)  
✓ Every file must be complete and immediately runnable  
✓ Output file-by-file with the full path as a header  
✓ Code must work with: npm run dev

Generate the complete project now, file by file.