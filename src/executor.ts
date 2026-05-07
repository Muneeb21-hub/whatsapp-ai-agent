import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { isPathAllowed, getSession, updateCwd } from './memory.js';
import { logger } from './logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── cd ─────────────────────────────────────────────────────────────────────────

/**
 * Resolves the target path (relative to session cwd or absolute), validates it
 * against ALLOWED_ROOTS, and updates the session. Returns the new cwd string.
 */
export async function executeCd(jid: string, targetPath: string): Promise<string> {
  const session = getSession(jid);

  // Resolve relative paths against the current working directory
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(session.cwd, targetPath);

  if (!isPathAllowed(resolved)) {
    return `❌ Access denied: "${resolved}" is outside the allowed directories.`;
  }

  // Verify directory exists
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return `❌ Not a directory: "${resolved}"`;
    }
  } catch {
    return `❌ Directory not found: "${resolved}"`;
  }

  const changed = updateCwd(jid, resolved);
  if (!changed) {
    return `❌ Access denied: path is outside allowed roots.`;
  }

  logger.info({ jid, cwd: resolved }, 'cd executed');
  return `📁 Changed directory to:\n${resolved}`;
}

// ── ls ─────────────────────────────────────────────────────────────────────────

/**
 * Lists directory contents with [DIR] / [FILE] prefix and file sizes.
 */
export async function executeLs(jid: string, targetPath?: string): Promise<string> {
  const session = getSession(jid);
  const dir = targetPath
    ? path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(session.cwd, targetPath)
    : session.cwd;

  if (!isPathAllowed(dir)) {
    return `❌ Access denied: "${dir}" is outside the allowed directories.`;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    if (entries.length === 0) {
      return `📂 ${dir}\n(empty directory)`;
    }

    const lines: string[] = [`📂 ${dir}`, ''];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        lines.push(`  [DIR]  ${entry.name}`);
      } else {
        const filePath = path.join(dir, entry.name);
        let size = '';
        try {
          const stat = await fs.stat(filePath);
          size = `  (${formatBytes(stat.size)})`;
        } catch {
          size = '';
        }
        lines.push(`  [FILE] ${entry.name}${size}`);
      }
    }

    logger.info({ jid, dir, count: entries.length }, 'ls executed');
    return lines.join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Cannot list directory: ${msg}`;
  }
}

// ── find ───────────────────────────────────────────────────────────────────────

/**
 * Uses glob to find files/directories matching a partial name (case-insensitive)
 * within the allowed roots. Returns up to 20 results.
 */
export async function executeFind(
  jid: string,
  query: string,
  searchPath?: string,
): Promise<string> {
  const session = getSession(jid);

  const base = searchPath
    ? path.isAbsolute(searchPath)
      ? path.resolve(searchPath)
      : path.resolve(session.cwd, searchPath)
    : session.cwd;

  if (!isPathAllowed(base)) {
    return `❌ Access denied: "${base}" is outside the allowed directories.`;
  }

  // Build a case-insensitive glob pattern
  const pattern = `**/*${query}*`;

  try {
    const results = await glob(pattern, {
      cwd: base,
      nocase: true,
      absolute: true,
      maxDepth: 10,
    });

    const limited = results.slice(0, 20);

    if (limited.length === 0) {
      return `🔍 No results for "${query}" in ${base}`;
    }

    const lines = [`🔍 Results for "${query}" (${limited.length} of ${results.length}):`, ''];
    for (const r of limited) {
      lines.push(`  ${r}`);
    }

    logger.info({ jid, query, base, found: results.length }, 'find executed');
    return lines.join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Find error: ${msg}`;
  }
}

// ── send ───────────────────────────────────────────────────────────────────────

/**
 * Locates a file by exact name, partial match, or most-recently-modified if
 * target === 'latest'. Returns the absolute path so whatsapp.ts can send it.
 */
export async function executeSend(jid: string, target: string): Promise<string | { filePath: string }> {
  const session = getSession(jid);

  if (!isPathAllowed(session.cwd)) {
    return `❌ Access denied: current directory is outside allowed roots.`;
  }

  try {
    const entries = await fs.readdir(session.cwd, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile());

    if (target === 'latest') {
      if (files.length === 0) {
        return `❌ No files found in ${session.cwd}`;
      }

      // Find the most recently modified file
      let latestFile = '';
      let latestMtime = 0;

      for (const f of files) {
        const fp = path.join(session.cwd, f.name);
        const stat = await fs.stat(fp);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestFile = fp;
        }
      }

      logger.info({ jid, filePath: latestFile }, 'send latest resolved');
      return { filePath: latestFile };
    }

    // Try exact match first
    const exact = files.find((f) => f.name === target);
    if (exact) {
      const fp = path.join(session.cwd, exact.name);
      logger.info({ jid, filePath: fp }, 'send exact match');
      return { filePath: fp };
    }

    // Fall back to partial match (case-insensitive)
    const partial = files.find((f) => f.name.toLowerCase().includes(target.toLowerCase()));
    if (partial) {
      const fp = path.join(session.cwd, partial.name);
      logger.info({ jid, filePath: fp, target }, 'send partial match');
      return { filePath: fp };
    }

    return `❌ File not found: "${target}" in ${session.cwd}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Send error: ${msg}`;
  }
}

// ── System & OS Control ────────────────────────────────────────────────────────

export async function executeSystem(jid: string, action: string): Promise<string> {
  try {
    switch (action) {
      case 'lock':
        await execAsync('rundll32.exe user32.dll,LockWorkStation');
        logger.info({ jid }, 'System locked');
        return '🔒 PC Locked successfully.';
      case 'sleep':
        // Note: hibernation must be disabled (powercfg -h off) for this to sleep instead of hibernate
        await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
        logger.info({ jid }, 'System put to sleep');
        return '💤 PC put to sleep.';
      case 'shutdown':
        await execAsync('shutdown /s /t 0');
        logger.info({ jid }, 'System shutting down');
        return '🛑 PC is shutting down now!';
      default:
        return `❌ Unknown system action: "${action}". Available: lock, sleep, shutdown.`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ System error: ${msg}`;
  }
}

export async function executePs(jid: string): Promise<string> {
  try {
    const { stdout } = await execAsync('tasklist /NH /FO CSV');
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
    // Parse CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
    const parsed = lines.map((line) => {
      const parts = line.split('","');
      if (parts.length < 5) return null;
      return {
        name: parts[0].replace(/"/g, ''),
        pid: parts[1],
        mem: parts[4].replace(/"/g, ''),
      };
    }).filter(Boolean) as { name: string; pid: string; mem: string }[];

    // Sort by memory descending roughly
    const sorted = parsed.sort((a, b) => {
      const memA = parseInt(a.mem.replace(/[^0-9]/g, ''), 10) || 0;
      const memB = parseInt(b.mem.replace(/[^0-9]/g, ''), 10) || 0;
      return memB - memA;
    });

    const top = sorted.slice(0, 15); // WhatsApp limit so return top 15
    const output = ['📊 Top Processes:'];
    for (const p of top) {
      output.push(`- ${p.name} (PID: ${p.pid}) -> ${p.mem}`);
    }

    logger.info({ jid }, 'ps executed');
    return output.join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Process list error: ${msg}`;
  }
}

export async function executeKill(jid: string, process: string): Promise<string> {
  try {
    // If it's a number, it's a PID, otherwise image name
    const isPid = /^\d+$/.test(process);
    const flag = isPid ? '/PID' : '/IM';
    const name = isPid ? process : (!process.toLowerCase().endsWith('.exe') ? `${process}.exe` : process);
    
    await execAsync(`taskkill ${flag} "${name}" /F`);
    logger.info({ jid, process }, 'kill executed');
    return `💀 Process killed successfully: ${process}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Kill error (maybe not found?): ${msg}`;
  }
}

export async function executeMedia(jid: string, action: string): Promise<string> {
  try {
    let keycode = '';
    let emoji = '';
    switch (action) {
      case 'play':
      case 'pause':
      case 'playpause':
        keycode = '179';
        emoji = '⏯️';
        break;
      case 'volup':
      case 'up':
        keycode = '175';
        emoji = '🔊';
        break;
      case 'voldown':
      case 'down':
        keycode = '174';
        emoji = '🔉';
        break;
      case 'next':
        keycode = '176';
        emoji = '⏭️';
        break;
      case 'prev':
        keycode = '177';
        emoji = '⏮️';
        break;
      case 'mute':
        keycode = '173';
        emoji = '🔇';
        break;
      default:
        return `❌ Unknown media action: "${action}". Available: play, pause, volup, voldown, next, prev, mute.`;
    }

    // Use PowerShell SendKeys
    await execAsync(`powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys([char]${keycode})"`);
    logger.info({ jid, action }, 'media command executed');
    return `${emoji} Media action applied: ${action}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Media control error: ${msg}`;
  }
}

// ── File Modification ──────────────────────────────────────────────────────────

export async function executeRm(jid: string, targetPath: string): Promise<string> {
  const session = getSession(jid);
  const resolved = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(session.cwd, targetPath);
  if (!isPathAllowed(resolved)) return `❌ Access denied: "${resolved}"`;

  try {
    await fs.rm(resolved, { recursive: true, force: true });
    logger.info({ jid, path: resolved }, 'rm executed');
    return `🗑️ Deleted: ${resolved}`;
  } catch (err) {
    return `❌ Delete error: ${String(err)}`;
  }
}

export async function executeMv(jid: string, src: string, dest: string): Promise<string> {
  const session = getSession(jid);
  const resSrc = path.isAbsolute(src) ? path.resolve(src) : path.resolve(session.cwd, src);
  const resDest = path.isAbsolute(dest) ? path.resolve(dest) : path.resolve(session.cwd, dest);
  if (!isPathAllowed(resSrc) || !isPathAllowed(resDest)) return `❌ Access denied`;

  try {
    await fs.rename(resSrc, resDest);
    logger.info({ jid, src: resSrc, dest: resDest }, 'mv executed');
    return `📦 Moved:\nFrom: ${resSrc}\nTo: ${resDest}`;
  } catch (err) {
    return `❌ Move error: ${String(err)}`;
  }
}

export async function executeCp(jid: string, src: string, dest: string): Promise<string> {
  const session = getSession(jid);
  const resSrc = path.isAbsolute(src) ? path.resolve(src) : path.resolve(session.cwd, src);
  const resDest = path.isAbsolute(dest) ? path.resolve(dest) : path.resolve(session.cwd, dest);
  if (!isPathAllowed(resSrc) || !isPathAllowed(resDest)) return `❌ Access denied`;

  try {
    await fs.cp(resSrc, resDest, { recursive: true });
    logger.info({ jid, src: resSrc, dest: resDest }, 'cp executed');
    return `📋 Copied:\nFrom: ${resSrc}\nTo: ${resDest}`;
  } catch (err) {
    return `❌ Copy error: ${String(err)}`;
  }
}

export async function executeZip(jid: string, archive: string, src: string): Promise<string> {
  const session = getSession(jid);
  const resArchive = path.isAbsolute(archive) ? path.resolve(archive) : path.resolve(session.cwd, archive);
  const resSrc = path.isAbsolute(src) ? path.resolve(src) : path.resolve(session.cwd, src);
  if (!isPathAllowed(resArchive) || !isPathAllowed(resSrc)) return `❌ Access denied`;

  try {
    await execAsync(`powershell -c "Compress-Archive -Path '${resSrc}' -DestinationPath '${resArchive}' -Force"`);
    logger.info({ jid, archive: resArchive, src: resSrc }, 'zip executed');
    return `🗜️ Zipped:\nSource: ${resSrc}\nArchive: ${resArchive}`;
  } catch (err) {
    return `❌ Zip error: ${String(err)}`;
  }
}

export async function executeUnzip(jid: string, archive: string, dest: string): Promise<string> {
  const session = getSession(jid);
  const resArchive = path.isAbsolute(archive) ? path.resolve(archive) : path.resolve(session.cwd, archive);
  const resDest = path.isAbsolute(dest) ? path.resolve(dest) : path.resolve(session.cwd, dest);
  if (!isPathAllowed(resArchive) || !isPathAllowed(resDest)) return `❌ Access denied`;

  try {
    await execAsync(`powershell -c "Expand-Archive -Path '${resArchive}' -DestinationPath '${resDest}' -Force"`);
    logger.info({ jid, archive: resArchive, dest: resDest }, 'unzip executed');
    return `📂 Unzipped:\nArchive: ${resArchive}\nTo: ${resDest}`;
  } catch (err) {
    return `❌ Unzip error: ${String(err)}`;
  }
}

export async function executeReadFile(jid: string, filename: string): Promise<string> {
  const session = getSession(jid);
  const target = path.isAbsolute(filename) ? path.resolve(filename) : path.resolve(session.cwd, filename);
  if (!isPathAllowed(target)) return `❌ Access denied: "${target}"`;

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return `❌ Not a file: "${target}"`;
    if (stat.size > 20480) { // 20 KB limit
      return `❌ File too large to read (Max 20KB). Size: ${formatBytes(stat.size)}`;
    }
    const content = await fs.readFile(target, 'utf8');
    logger.info({ jid, target }, 'read_file executed');
    return content;
  } catch (err) {
    return `❌ Read error: ${String(err)}`;
  }
}
