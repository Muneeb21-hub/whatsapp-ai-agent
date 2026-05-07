# 🚀 Future Feature Improvements for WhatsApp AI Agent

This document outlines potential features to elevate the MVP from a basic file navigator and chatbot into a fully-fledged, autonomous remote PC assistant.

---

## 1. 🖥️ System & OS Control
Give the agent the ability to interact with the host operating system beyond just the filesystem.

- **Power Management**: Commands to sleep, lock, or shut down the PC (`!system sleep`, `!system lock`).
- **System Metrics**: Ask the AI about system health (`!ai how is my CPU and RAM doing?`).
- **Process Management**: View or kill running applications (`!ps`, `!kill chrome`).
- **Media Controls**: Play, pause, or change the volume of the host PC remotely.

## 2. 📂 Advanced File Manipulation
Currently, the agent can only navigate (`cd`, `ls`) and send files. It should be able to modify them.

- **Receive & Save**: Send images, PDFs, or videos via WhatsApp to the bot, and have it automatically save them to the host PC's `files/` directory.
- **Modify Files**: Commands to delete (`rm`), move (`mv`), copy (`cp`), or zip/unzip archives remotely.
- **Read File Content**: Allow the AI to read text-based files directly (`!ai summarize the contents of report.txt`).

## 3. 🧠 Upgraded AI Capabilities
Expand the LLM's sensory inputs and reasoning capabilities.

- **Vision Support**: If you are running an Ollama vision model (like Llama 3.2 Vision), allow sending images to the bot for analysis (`!ai what is in this picture?`).
- **Voice Note Commands**: Integrate a local Whisper model so you can send voice notes to the bot instead of typing `!cd` or `!ai`.
- **Web Search Tools**: Give the AI the ability to search the web and summarize articles for you.

## 4. 🔒 Security & Multi-User Access
Improve the security and accessibility of the bot.

- **Role-Based Access**: Allow family members or colleagues to use the bot, but restrict them to "Read-Only" mode (can `ls` but cannot `cd` out of a specific folder or use `ai`).
- **SQLite Audit Log**: Replace plain text logs with a database to easily search past commands and interactions.
- **Self-Destructing Messages**: Have the bot automatically delete sensitive files or outputs from the WhatsApp chat after a set period.

## 5. 🤖 Autonomous "Computer Use" (Agentic Actions)
Turn the bot into an actual computer-use agent.

- **Browser Automation**: Give the AI access to Playwright/Puppeteer so it can navigate websites, scrape data, or submit forms on your behalf.
- **Long-Running Tasks**: Allow the bot to execute background scripts and notify you on WhatsApp when they finish (`!run build_project.sh`).
- **Scheduled Alerts**: Ask the AI to monitor a folder or a stock price and message you proactively when a condition is met.
