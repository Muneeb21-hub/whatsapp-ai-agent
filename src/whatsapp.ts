import fs from 'fs/promises';
import path from 'path';
import qrcode from 'qrcode-terminal';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
  type BaileysEventMap,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { config } from './config.js';
import { logger } from './logger.js';
import { parseCommand } from './command.js';
import { getSession, addHistory } from './memory.js';
import { executeCd, executeLs, executeFind, executeSend, executeSystem, executePs, executeKill, executeMedia, executeRm, executeMv, executeCp, executeZip, executeUnzip, executeReadFile } from './executor.js';
import { askAI } from './ai.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Normalises a sender JID to its bare phone number so we can compare it to
 * the OWNER env var, which stores digits only (no domain suffix).
 *
 * Examples:
 *   "12345678901@s.whatsapp.net"  →  "12345678901"
 *   "12345678901@lid"             →  "12345678901"
 */
function normaliseJid(jid: string): string {
  return jid.split('@')[0].replace(/[^0-9]/g, '');
}

function isOwner(jid: string): boolean {
  return normaliseJid(jid) === config.OWNER;
}

// ── Core message handler ───────────────────────────────────────────────────────

async function handleMessage(sock: WASocket, message: BaileysEventMap['messages.upsert']['messages'][number]): Promise<void> {
  const jid = message.key.remoteJid;
  if (!jid) return;

  // When fromMe=true the owner is sending from their own device (self-chat /
  // Saved Messages). The remoteJid is their own number — treat it as the sender.
  const sender = message.key.fromMe
    ? (message.key.remoteJid ?? '')
    : (message.key.participant ?? message.key.remoteJid ?? '');

  // ── Diagnostic log — always emitted at debug level ─────────────────────────
  logger.debug(
    {
      jid,
      sender,
      fromMe: message.key.fromMe,
      owner: config.OWNER,
      senderNorm: sender.split('@')[0].replace(/[^0-9]/g, ''),
      jidNorm: jid.split('@')[0].replace(/[^0-9]/g, ''),
      msgTypes: Object.keys(message.message ?? {}),
    },
    'handleMessage: evaluating incoming message',
  );

  // If fromMe=true, it's definitively from the authenticated account (the owner),
  // even if the JID happens to be a linked device ID (@lid) rather than a phone number.
  if (!message.key.fromMe && !isOwner(sender) && !isOwner(jid)) {
    logger.debug({ sender, jid, fromMe: message.key.fromMe }, 'Message from non-owner — ignored');
    return;
  }

  const inner = message.message;

  // ── Media Handling ─────────────────────────────────────────────────────────
  const hasMedia = !!(inner?.imageMessage || inner?.documentMessage || inner?.videoMessage || inner?.audioMessage);
  
  if (hasMedia) {
    const caption = inner?.imageMessage?.caption || inner?.documentMessage?.caption || inner?.videoMessage?.caption || '';
    
    if (caption.toLowerCase().includes('!save')) {
      try {
        const buffer = await downloadMediaMessage(message, 'buffer', { });
        
        const mimeType = inner?.imageMessage?.mimetype || inner?.documentMessage?.mimetype || inner?.videoMessage?.mimetype || inner?.audioMessage?.mimetype || '';
        const originalFileName = inner?.documentMessage?.fileName || '';
        
        let ext = '';
        if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
        else if (mimeType.includes('png')) ext = '.png';
        else if (mimeType.includes('mp4')) ext = '.mp4';
        else if (mimeType.includes('pdf')) ext = '.pdf';
        else if (mimeType.includes('audio')) ext = '.ogg';
        else if (mimeType.includes('webp')) ext = '.webp';
        
        const fileName = originalFileName || `media_${Date.now()}${ext}`;
        
        const dirPath = path.resolve(process.cwd(), 'files');
        await fs.mkdir(dirPath, { recursive: true });
        const filePath = path.join(dirPath, fileName);
        
        await fs.writeFile(filePath, buffer as Buffer);
        logger.info({ jid, filePath }, 'Downloaded media due to !save command');
        
        await sock.sendMessage(jid, { text: `✅ Saved media to:\n${filePath}` });
        
        // Remove the !save command from caption, then process the rest (e.g., !save !ai what is this)
        const remainingCaption = caption.replace(/!save/i, '').trim();
        if (!remainingCaption) return; // No other commands
        
        if (inner) {
          inner.conversation = remainingCaption;
        }
      } catch (err) {
        logger.error({ err }, 'Failed to download media');
        await sock.sendMessage(jid, { text: `❌ Failed to download media: ${String(err)}` });
        return;
      }
    } else {
      // No !save command. Ignore the file, but process the text caption if it exists.
      if (!caption) return;
      if (inner) {
        inner.conversation = caption;
      }
    }
  }

  // Extract text from all known message shapes, including multi-device
  // wrappers (ephemeralMessage, viewOnceMessage) that Baileys uses.
  const body: string =
    inner?.conversation ??
    inner?.extendedTextMessage?.text ??
    inner?.ephemeralMessage?.message?.conversation ??
    inner?.ephemeralMessage?.message?.extendedTextMessage?.text ??
    inner?.viewOnceMessage?.message?.conversation ??
    inner?.viewOnceMessage?.message?.extendedTextMessage?.text ??
    inner?.buttonsResponseMessage?.selectedDisplayText ??
    '';

  if (!body) {
    const msgKeys = Object.keys(inner ?? {});
    // Ignore internal WhatsApp protocol messages silently (read receipts, reactions, etc)
    if (msgKeys.includes('protocolMessage') || msgKeys.includes('senderKeyDistributionMessage') || msgKeys.includes('reactionMessage')) {
      return;
    }

    logger.warn(
      { jid, fromMe: message.key.fromMe, msgTypes: msgKeys },
      'Message body is empty — decryption may have failed or unsupported message type',
    );
    return;
  }

  if (!body.startsWith('!')) {
    logger.debug({ jid, bodyPreview: body.slice(0, 40) }, 'Message does not start with ! — ignored');
    return;
  }

  logger.info({ jid, body }, 'Message received from owner');

  // Typing indicator
  await sock.sendPresenceUpdate('composing', jid);

  const session = getSession(jid);
  const command = parseCommand(body);
  addHistory(jid, body);

  logger.info({ jid, command }, 'Command parsed');

  let reply = '';

  try {
    switch (command.type) {
      case 'cd': {
        reply = await executeCd(jid, command.path);
        break;
      }

      case 'ls': {
        reply = await executeLs(jid, command.path);
        break;
      }

      case 'find': {
        reply = await executeFind(jid, command.query, command.path);
        break;
      }

      case 'send': {
        const result = await executeSend(jid, command.target);
        if (typeof result === 'string') {
          // It's an error message
          reply = result;
        } else {
          // Send file as document
          try {
            const fileBuffer = await fs.readFile(result.filePath);
            const fileName = path.basename(result.filePath);
            await sock.sendPresenceUpdate('available', jid);
            await sock.sendMessage(jid, {
              document: fileBuffer,
              fileName,
              mimetype: 'application/octet-stream',
              caption: `📎 ${fileName}`,
            });
            logger.info({ jid, filePath: result.filePath }, 'File sent');
            return; // No text reply needed
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            reply = `❌ Failed to send file: ${msg}`;
          }
        }
        break;
      }

      case 'system': {
        reply = await executeSystem(jid, command.action);
        break;
      }

      case 'ps': {
        reply = await executePs(jid);
        break;
      }

      case 'kill': {
        reply = await executeKill(jid, command.process);
        break;
      }

      case 'media': {
        reply = await executeMedia(jid, command.action);
        break;
      }

      case 'rm': {
        reply = await executeRm(jid, command.path);
        break;
      }

      case 'mv': {
        reply = await executeMv(jid, command.src, command.dest);
        break;
      }

      case 'cp': {
        reply = await executeCp(jid, command.src, command.dest);
        break;
      }

      case 'zip': {
        reply = await executeZip(jid, command.archive, command.src);
        break;
      }

      case 'unzip': {
        reply = await executeUnzip(jid, command.archive, command.dest);
        break;
      }

      case 'ai': {
        logger.info({ jid, prompt: command.prompt }, 'Forwarding to AI');
        const action = await askAI(command.prompt, session.history);
        logger.info({ jid, action }, 'AI action received');

        switch (action.action) {
          case 'cd':
            reply = await executeCd(jid, action.path);
            break;
          case 'ls':
            reply = await executeLs(jid, action.path);
            break;
          case 'find':
            reply = await executeFind(jid, action.query);
            break;
          case 'send_file': {
            const r = await executeSend(jid, action.filename);
            if (typeof r === 'string') {
              reply = r;
            } else {
              try {
                const fileBuffer = await fs.readFile(r.filePath);
                const fileName = path.basename(r.filePath);
                await sock.sendPresenceUpdate('available', jid);
                await sock.sendMessage(jid, {
                  document: fileBuffer,
                  fileName,
                  mimetype: 'application/octet-stream',
                  caption: `📎 ${fileName}`,
                });
                logger.info({ jid, filePath: r.filePath }, 'File sent via AI action');
                return;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                reply = `❌ Failed to send file: ${msg}`;
              }
            }
            break;
          }
          case 'read_file': {
            const content = await executeReadFile(jid, action.filename);
            if (content.startsWith('❌')) {
              reply = content;
            } else {
              const newPrompt = `[System: Contents of ${action.filename}]\n${content}\n\n[User's original request]: ${command.prompt}`;
              logger.info({ jid, filename: action.filename }, 'Agentic loop: calling AI again with file contents');
              const followUp = await askAI(newPrompt, session.history);
              if (followUp.action === 'ai_response') {
                reply = followUp.message;
              } else {
                reply = `🤖 Reached max agent steps. Last action: ${followUp.action}`;
              }
            }
            break;
          }
          case 'ai_response':
            reply = action.message;
            break;
          case 'ask':
            reply = `🤔 ${action.question}`;
            break;
          case 'deny':
            reply = `🚫 ${action.reason}`;
            break;
        }
        break;
      }

      case 'unknown':
      default:
        reply = `❓ Unknown command. Try: !ls, !cd <path>, !find <name>, !send <file>, !ai <prompt>`;
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ jid, err }, 'Unhandled error in message handler');
    reply = `⚠️ Internal error: ${msg}`;
  }

  await sock.sendPresenceUpdate('available', jid);

  if (reply) {
    await sock.sendMessage(jid, { text: reply });
    logger.info({ jid, replyLength: reply.length }, 'Reply sent');
  }
}

// ── Connection bootstrap ───────────────────────────────────────────────────────

export async function startWhatsApp(): Promise<void> {
  // Ensure auth directory exists
  await fs.mkdir(config.AUTH_DIR, { recursive: true });
  // Ensure files directory exists
  await fs.mkdir(config.FILES_DIR, { recursive: true });

  const connect = async (): Promise<void> => {
    const { state, saveCreds } = await useMultiFileAuthState(config.AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    logger.info({ version }, 'Connecting to WhatsApp');

    // ── In-memory message store for retry decryption ─────────────────────────
    // Baileys calls getMessage() when WhatsApp requests a message retry
    // (visible as "timed out waiting for message" in the logs). Without this,
    // every retried message is permanently lost — causing the intermittent
    // "sometimes responds, sometimes doesn't" behaviour.
    const MAX_STORED = 200;
    type StoredMsg = WAMessage;
    const msgStore = new Map<string, StoredMsg>();

    function cacheMessage(msg: WAMessage): void {
      const jid = msg.key.remoteJid;
      const id = msg.key.id;
      if (!jid || !id) return;
      msgStore.set(`${jid}:${id}`, msg);
      if (msgStore.size > MAX_STORED) {
        const oldest = msgStore.keys().next().value;
        if (oldest) msgStore.delete(oldest);
      }
    }

    const getMessage = async (
      key: { remoteJid?: string | null; id?: string | null },
    ) => {
      if (!key.remoteJid || !key.id) return undefined;
      const msg = msgStore.get(`${key.remoteJid}:${key.id}`);
      return msg?.message ?? undefined;
    };

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: logger.child({ module: 'baileys' }) as unknown as Parameters<typeof makeWASocket>[0]['logger'],
      markOnlineOnConnect: true,
      getMessage,
    });

    // Populate the store from history-sync batches (correct event name in this Baileys version)
    sock.ev.on('messaging-history.set', ({ messages: batch }) => {
      for (const msg of batch) cacheMessage(msg);
    });

    // ── QR code display ──────────────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('Scan the QR code below with WhatsApp:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        logger.warn({ reason, shouldReconnect }, 'Connection closed');

        if (shouldReconnect) {
          logger.info('Reconnecting in 3 seconds...');
          setTimeout(connect, 3000);
        } else {
          logger.error('Logged out from WhatsApp. Delete the auth/ folder and restart to re-authenticate.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        logger.info('✅ WhatsApp connection established');
      }
    });

    // ── Credential persistence ───────────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Message listener ─────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // ── Diagnostic log — always emitted at debug level ───────────────────
      logger.debug({ type, count: messages.length }, 'messages.upsert event fired');

      // Cache all incoming messages so getMessage() can serve retries
      for (const msg of messages) cacheMessage(msg);

      // Only act on live notifications, not history-sync replays
      if (type !== 'notify') return;

      for (const message of messages) {
        const jid = message.key.remoteJid ?? '';

        // Ignore WhatsApp Status broadcasts — they cause decrypt errors
        // because we don't hold the sender's group session keys.
        if (jid === 'status@broadcast') continue;

        // Wrap each message individually: one failure (e.g. Ollama timeout)
        // must never prevent subsequent messages from being processed.
        try {
          await handleMessage(sock, message);
        } catch (err) {
          logger.error({ err, jid }, 'Unexpected error processing message — skipping');
        }
      }
    });
  };

  await connect();
}
