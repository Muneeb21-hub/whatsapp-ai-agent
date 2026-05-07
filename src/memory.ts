import path from 'path';
import { config } from './config.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionState {
  cwd: string;
  history: string[];
}

// ── In-memory store ────────────────────────────────────────────────────────────

const sessions = new Map<string, SessionState>();

// ── Security helper (shared with executor) ─────────────────────────────────────

/**
 * Returns true if the resolved absolute path starts with one of the
 * ALLOWED_ROOTS. Prevents path-traversal attacks.
 */
export function isPathAllowed(p: string): boolean {
  const resolved = path.resolve(p);
  return config.ALLOWED_ROOTS.some((root) => resolved.startsWith(root + path.sep) || resolved === root);
}

// ── Session API ────────────────────────────────────────────────────────────────

/**
 * Returns the session for a given JID, creating a default one if it does not
 * exist yet. The default cwd is the project's files/ directory.
 */
export function getSession(jid: string): SessionState {
  if (!sessions.has(jid)) {
    const newSession: SessionState = {
      cwd: config.FILES_DIR,
      history: [],
    };
    sessions.set(jid, newSession);
    logger.debug({ jid, cwd: newSession.cwd }, 'Created new session');
  }
  return sessions.get(jid)!;
}

/**
 * Updates the session's cwd after validating the new path is within
 * ALLOWED_ROOTS. Returns true on success, false if the path is denied.
 */
export function updateCwd(jid: string, newPath: string): boolean {
  const resolved = path.resolve(newPath);
  if (!isPathAllowed(resolved)) {
    logger.warn({ jid, attempted: resolved }, 'Path change denied — outside allowed roots');
    return false;
  }
  const session = getSession(jid);
  session.cwd = resolved;
  logger.debug({ jid, cwd: resolved }, 'CWD updated');
  return true;
}

/**
 * Appends a command string to the session history (capped at 10 entries).
 */
export function addHistory(jid: string, entry: string): void {
  const session = getSession(jid);
  session.history.push(entry);
  if (session.history.length > 10) {
    session.history.shift();
  }
}
