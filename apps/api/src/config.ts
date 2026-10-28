import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: resolve(projectRoot, '.env'), quiet: true });

const envSchema = z.object({
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  OLLAMA_BASE_URL: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  }, 'Ollama must use a local loopback endpoint').default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().trim().min(1).default('qwen3:8b'),
  DATABASE_PATH: z.string().min(1).default('./data/app.sqlite'),
  STORAGE_DIR: z.string().min(1).default('./data/storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(15),
  SOFFICE_PATH: z.string().min(1).default('soffice'),
});

// Resolve against the repo, regardless of the workspace process's working directory.
// Existing symlink components must also remain inside the real local data directory.
export function localDataPath(value: string): string {
  const root = resolve(projectRoot, 'data');
  const target = resolve(projectRoot, value);
  const isInside = (base: string, path: string) => {
    const rel = relative(base, path);
    return rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
  };
  if (!isInside(root, target)) throw new Error('Private paths must be inside the project data directory');
  for (const path of [root, target]) {
    if (existsSync(path) && realpathSync(path) !== path) throw new Error('Private paths cannot use symlinks');
  }
  let parent = resolve(target, '..');
  while (isInside(root, parent)) {
    if (existsSync(parent) && realpathSync(parent) !== parent) throw new Error('Private paths cannot use symlinks');
    parent = resolve(parent, '..');
  }
  return target;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  return { ...parsed, DATABASE_PATH: localDataPath(parsed.DATABASE_PATH), STORAGE_DIR: localDataPath(parsed.STORAGE_DIR) };
}
export type AppConfig = ReturnType<typeof readConfig>;
