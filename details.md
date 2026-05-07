# WhatsApp AI Agent - Project Details

## Overview
The **WhatsApp AI Agent** is a Node.js-based application written in TypeScript that allows users to remotely control their computer via WhatsApp messages. The system leverages the `@whiskeysockets/baileys` library to connect to WhatsApp and uses a local **Ollama LLM** (Large Language Model) to intelligently parse commands and answer system-related queries.

## Core Capabilities
The agent acts as a secure remote assistant with the following major capabilities:

1. **WhatsApp Integration**:
   - Uses `baileys` for real-time connection.
   - Authentication is done via QR code scanning in the terminal.
   - Strict owner authentication: It only processes messages from the designated `OWNER` phone number configured in the environment variables, ensuring that unauthorized users cannot execute commands on the host machine.
   - Handles media messages (like saving images/documents) via the `!save` command.

2. **File System & Directory Management**:
   - Navigate directories (`!cd`, `!ls`)
   - Find files (`!find`)
   - Send files from PC to WhatsApp (`!send`)
   - Move, copy, and delete files/folders (`!mv`, `!cp`, `!rm`)
   - Archive and extract files (`!zip`, `!unzip`)

3. **System & Process Control**:
   - Process management (`!ps`, `!kill`)
   - Media controls (`!media`)
   - System actions (`!system`)

4. **Agentic AI Assistance (`!ai` command)**:
   - Powered by a local Ollama instance (no cloud API dependencies for LLM).
   - Driven by a strict Zod schema enforcing JSON-only output from the model.
   - The AI can autonomously execute actions based on conversational prompts. Supported autonomous actions include `cd`, `ls`, `find`, `send_file`, `read_file`, asking clarifying questions (`ask`), or responding textually (`ai_response`).
   - The AI has context awareness of the current system state, such as CPU model, free RAM, OS version, and uptime, and uses an error-correction loop if it fails to output valid JSON.

## Key Files & Architecture
- **`src/index.ts`**: The entry point. Bootstraps the application, handles global error catching, and starts the WhatsApp connection.
- **`src/whatsapp.ts`**: Handles WhatsApp connection logic, QR code generation, session management, and the core message routing and parsing loop.
- **`src/command.ts`**: The command parser. Takes raw text and maps it to a discriminated union of command objects (e.g., `cd`, `ls`, `ai`).
- **`src/ai.ts`**: Manages the integration with the Ollama LLM. It defines the JSON schema for AI actions using Zod, establishes the system prompt, handles automatic error correction (retry logic if LLM outputs invalid JSON), and exposes the `askAI` function.
- **`src/executor.ts`**: (Referenced) Contains the actual system execution logic for operations like navigating directories, searching, killing processes, and media control.
- **`package.json`**: Contains dependencies and scripts for building and running the project via `tsx`.

## Technology Stack
- **Language**: TypeScript / Node.js
- **WhatsApp Library**: `@whiskeysockets/baileys`
- **AI Integration**: `ollama` (Local LLM connection)
- **Validation**: `zod`
- **Logging**: `pino`, `pino-pretty`
- **Utility**: `qrcode-terminal` (QR display), `dotenv` (Environment config)
- **Runtime Tooling**: `tsx` (TypeScript Executor)

## Setup & Execution
The application uses the following `package.json` scripts:
- `npm run dev`: Runs the application in watch mode using `tsx`.
- `npm run start`: Starts the application in production mode.
- `npm run build`: Compiles TypeScript down to JavaScript.
- `npm run lint`: Runs the TypeScript compiler for type checking.

*Note: For the application to function correctly, an active instance of Ollama needs to be running locally with the configured model available.*
