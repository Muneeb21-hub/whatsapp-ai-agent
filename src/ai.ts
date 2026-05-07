import { Ollama } from 'ollama';
import { z } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';
import os from 'os';

// ── Ollama client ──────────────────────────────────────────────────────────────

const ollama = new Ollama({ host: config.OLLAMA_URL });

// ── Action schema ──────────────────────────────────────────────────────────────

export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cd'),          path: z.string() }),
  z.object({ action: z.literal('ls'),          path: z.string().optional() }),
  z.object({ action: z.literal('find'),        query: z.string() }),
  z.object({ action: z.literal('send_file'),   filename: z.string() }),
  z.object({ action: z.literal('read_file'),   filename: z.string() }),
  z.object({ action: z.literal('ai_response'), message: z.string() }),
  z.object({ action: z.literal('ask'),         question: z.string() }),
  z.object({ action: z.literal('deny'),        reason: z.string() }),
]);

export type Action = z.infer<typeof ActionSchema>;

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant that controls a computer remotely via WhatsApp.
You help the owner navigate the filesystem, find files, and answer questions.

CRITICAL: You MUST ALWAYS respond with a single, valid JSON object — nothing else.
No markdown, no code fences, no explanation outside the JSON.

Your JSON must match exactly ONE of these shapes:

{ "action": "cd",          "path": "<absolute or relative path>" }
{ "action": "ls",          "path": "<optional path>" }
{ "action": "find",        "query": "<search term>" }
{ "action": "send_file",   "filename": "<file name or 'latest'>" }
{ "action": "read_file",   "filename": "<file name>" }
{ "action": "ai_response", "message": "<your text reply>" }
{ "action": "ask",         "question": "<clarifying question>" }
{ "action": "deny",        "reason": "<reason you cannot fulfill this>" }

Rules:
- Use "cd" when the user wants to change directory.
- Use "ls" when the user wants to list files.
- Use "find" when the user wants to search for a file.
- Use "send_file" ONLY when the user explicitly asks to download or receive an EXISTING file from the PC. Do NOT use this to write code.
- Use "read_file" when you need to read the contents of a text file to answer the user's question (e.g. summarizing a document).
- Use "ai_response" to answer questions, generate code, write text, or have a conversational reply.
- Use "ask" when you need more information to fulfill the request.
- Use "deny" ONLY if the request is clearly dangerous, illegal, or unethical (e.g. deleting system files, hacking). Do NOT use "deny" for unclear, grammatically broken, or simple questions — those should use "ai_response" or "ask".
- NEVER return plain text. Only JSON.
- DEFAULT FALLBACK: If you are unsure which action to use, always choose "ai_response". Never use "deny" for ambiguous inputs.
- SYSTEM INFO RULE: If the user asks about CPU, RAM, memory, uptime, OS version, or any hardware/system info — even in broken grammar — you MUST answer with "ai_response" using the [CURRENT SYSTEM STATE] data provided at the end of this prompt. NEVER use "read_file", "send_file", or "deny" for system info questions.`;

// ── Parse with retry ───────────────────────────────────────────────────────────

async function parseWithRetry(
  raw: string,
  userMessage: string,
  history: string[],
): Promise<Action> {
  // First parse attempt
  const extracted = extractJson(raw);
  const first = ActionSchema.safeParse(extracted);
  if (first.success) return first.data;

  logger.warn({ raw }, 'First AI parse failed — retrying with error correction');

  // Retry with an error-correction prompt
  const correction = await ollama.chat({
    model: config.OLLAMA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(userMessage, history) },
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `Your previous response was not valid JSON matching the required schema. 
Parse error: ${first.error.message}
Please respond ONLY with a valid JSON object matching one of the specified shapes.`,
      },
    ],
  });

  const retryRaw = correction.message.content;
  const retryExtracted = extractJson(retryRaw);
  const second = ActionSchema.safeParse(retryExtracted);

  if (second.success) return second.data;

  logger.error({ retryRaw }, 'Second AI parse also failed — falling back to ai_response');

  // Final fallback: return the raw text as an ai_response
  return { action: 'ai_response', message: raw };
}

/**
 * Attempts to extract a JSON object from a potentially messy string
 * (e.g. the model may wrap it in markdown code fences).
 */
function extractJson(raw: string): unknown {
  // Strip <think>...</think> blocks from reasoning models (e.g. DeepSeek-R1, QwQ)
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const trimmed = withoutThink.trim();

  // Strip markdown code fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Try to find the first { ... } block
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildUserContent(prompt: string, history: string[]): string {
  const recent = history.slice(-5);
  const historyBlock =
    recent.length > 0
      ? `\nRecent session history (last ${recent.length} commands):\n${recent.map((h) => `  - ${h}`).join('\n')}\n`
      : '';
  return `${historyBlock}\nUser request: ${prompt}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Sends a prompt to the Ollama LLM and returns a typed Action.
 * Includes the last 5 history entries as context.
 */
export async function askAI(prompt: string, history: string[]): Promise<Action> {
  logger.debug({ model: config.OLLAMA_MODEL, prompt }, 'Sending prompt to Ollama');

  const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
  const cpuModel = os.cpus()[0]?.model || 'Unknown CPU';
  const osType = `${os.type()} ${os.release()}`;
  
  const systemState = `[CURRENT SYSTEM STATE]
OS: ${osType}
CPU: ${cpuModel} (${os.cpus().length} cores)
RAM: ${freeMem}GB free out of ${totalMem}GB
Uptime: ${(os.uptime() / 3600).toFixed(1)} hours`;

  const dynamicSystemPrompt = `${SYSTEM_PROMPT}\n\n${systemState}`;

  const response = await ollama.chat({
    model: config.OLLAMA_MODEL,
    messages: [
      { role: 'system', content: dynamicSystemPrompt },
      { role: 'user', content: buildUserContent(prompt, history) },
    ],
  });

  const raw = response.message.content;
  logger.debug({ raw }, 'Raw Ollama response');

  return parseWithRetry(raw, prompt, history);
}
