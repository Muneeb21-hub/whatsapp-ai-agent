// ── Command discriminated union ────────────────────────────────────────────────

export type Command =
  | { type: 'cd'; path: string }
  | { type: 'ls'; path?: string }
  | { type: 'find'; query: string; path?: string }
  | { type: 'send'; target: string | 'latest' }
  | { type: 'ai'; prompt: string }
  | { type: 'system'; action: string }
  | { type: 'ps' }
  | { type: 'kill'; process: string }
  | { type: 'media'; action: string }
  | { type: 'rm'; path: string }
  | { type: 'mv'; src: string; dest: string }
  | { type: 'cp'; src: string; dest: string }
  | { type: 'zip'; archive: string; src: string }
  | { type: 'unzip'; archive: string; dest: string }
  | { type: 'unknown'; raw: string };

// ── Parser ─────────────────────────────────────────────────────────────────────

/**
 * Parses a raw WhatsApp message body that starts with "!" into a typed Command.
 *
 * Rules:
 *   - Strip the leading "!"
 *   - The first token (lowercased) becomes the command type
 *   - Remaining text is treated as arguments, whitespace preserved
 */
export function parseCommand(raw: string): Command {
  // Strip leading "!" and trim surrounding whitespace
  const body = raw.startsWith('!') ? raw.slice(1).trimStart() : raw.trimStart();

  // Split into [commandToken, ...rest] on the first run of whitespace
  const spaceIdx = body.search(/\s/);
  const token = spaceIdx === -1 ? body : body.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : body.slice(spaceIdx + 1);

  const cmd = token.toLowerCase();
  const trimmedArgs = args.trim();

  switch (cmd) {
    case 'cd':
      if (!trimmedArgs) return { type: 'unknown', raw };
      return { type: 'cd', path: trimmedArgs };

    case 'ls':
      return { type: 'ls', path: trimmedArgs || undefined };

    case 'find': {
      if (!trimmedArgs) return { type: 'unknown', raw };
      // Optionally support "!find <query> in <path>"
      const inMatch = trimmedArgs.match(/^(.+?)\s+in\s+(\S+)$/i);
      if (inMatch) {
        return { type: 'find', query: inMatch[1].trim(), path: inMatch[2] };
      }
      return { type: 'find', query: trimmedArgs };
    }

    case 'send':
      if (!trimmedArgs) return { type: 'unknown', raw };
      return { type: 'send', target: trimmedArgs };

    case 'ai':
      if (!trimmedArgs) return { type: 'unknown', raw };
      return { type: 'ai', prompt: trimmedArgs };

    case 'system':
      if (!trimmedArgs) return { type: 'unknown', raw };
      return { type: 'system', action: trimmedArgs.toLowerCase() };

    case 'ps':
      return { type: 'ps' };

    case 'kill':
      if (!trimmedArgs) return { type: 'unknown', raw };
      return { type: 'kill', process: trimmedArgs };

    case 'media':
      if (!trimmedArgs) return { type: 'unknown', raw };
      return { type: 'media', action: trimmedArgs.toLowerCase() };

    case 'rm':
      if (!trimmedArgs) return { type: 'unknown', raw };
      return { type: 'rm', path: trimmedArgs };

    case 'mv': {
      const match = trimmedArgs.match(/^"([^"]+)"\s+"([^"]+)"|^(\S+)\s+(.+)$/);
      if (!match) return { type: 'unknown', raw };
      return { type: 'mv', src: match[1] || match[3], dest: match[2] || match[4] };
    }

    case 'cp': {
      const match = trimmedArgs.match(/^"([^"]+)"\s+"([^"]+)"|^(\S+)\s+(.+)$/);
      if (!match) return { type: 'unknown', raw };
      return { type: 'cp', src: match[1] || match[3], dest: match[2] || match[4] };
    }

    case 'zip': {
      const match = trimmedArgs.match(/^"([^"]+)"\s+"([^"]+)"|^(\S+)\s+(.+)$/);
      if (!match) return { type: 'unknown', raw };
      return { type: 'zip', archive: match[1] || match[3], src: match[2] || match[4] };
    }

    case 'unzip': {
      const match = trimmedArgs.match(/^"([^"]+)"\s+"([^"]+)"|^(\S+)\s+(.+)$/);
      if (!match) return { type: 'unknown', raw };
      return { type: 'unzip', archive: match[1] || match[3], dest: match[2] || match[4] };
    }

    default:
      return { type: 'unknown', raw };
  }
}
