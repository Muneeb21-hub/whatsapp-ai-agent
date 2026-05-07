import 'dotenv/config';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ConfigSchema = z.object({
  OWNER: z
    .string()
    .min(7, 'OWNER must be a valid phone number (digits only, no + or spaces)')
    .regex(/^\d+$/, 'OWNER must contain digits only — no +, spaces, or dashes'),

  OLLAMA_URL: z
    .string()
    .url('OLLAMA_URL must be a valid URL (e.g. http://localhost:11434)')
    .default('http://localhost:11434'),

  OLLAMA_MODEL: z.string().min(1, 'OLLAMA_MODEL cannot be empty').default('llama3.2'),

  ALLOWED_ROOTS: z
    .string()
    .optional()
    .transform((val) => {
      const roots: string[] = [];
      if (val) {
        roots.push(...val.split(',').map((p) => path.resolve(p.trim())));
      }
      return roots;
    }),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

type RawConfig = z.input<typeof ConfigSchema>;
type Config = z.output<typeof ConfigSchema> & {
  FILES_DIR: string;
  AUTH_DIR: string;
};

function loadConfig(): Config {
  const raw: RawConfig = {
    OWNER: process.env.OWNER ?? '',
    OLLAMA_URL: process.env.OLLAMA_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
    LOG_LEVEL: (process.env.LOG_LEVEL as RawConfig['LOG_LEVEL']) ?? 'info',
    NODE_ENV: (process.env.NODE_ENV as RawConfig['NODE_ENV']) ?? 'development',
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[config] Invalid environment variables:\n${issues}`);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const filesDir = path.resolve(projectRoot, 'files');
  const authDir = path.resolve(projectRoot, 'auth');

  // Always include the project's files/ directory as an allowed root
  const allowedRoots = result.data.ALLOWED_ROOTS ?? [];
  if (!allowedRoots.includes(filesDir)) {
    allowedRoots.push(filesDir);
  }

  return {
    ...result.data,
    ALLOWED_ROOTS: allowedRoots,
    FILES_DIR: filesDir,
    AUTH_DIR: authDir,
  };
}

export const config = loadConfig();
export type { Config };
