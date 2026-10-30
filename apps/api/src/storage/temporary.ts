import { lstat, opendir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;

// Only our converter's directories are disposable. Never follow symlinks or
// sweep originals, published templates, or unrelated files in this directory.
export async function cleanupExpiredExports(root: string, now = Date.now()) {
  try {
    if (!(await lstat(root)).isDirectory()) return;
    const entries = await opendir(root);
    for await (const entry of entries) {
      if (!entry.isDirectory() || !/^export-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
      const path = resolve(root, entry.name);
      const info = await lstat(path);
      if (info.isDirectory() && info.mtimeMs < now - DAY) await rm(path, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to clean expired PDF exports. Check local storage permissions.');
  }
}
