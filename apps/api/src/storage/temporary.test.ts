import { mkdtemp, mkdir, writeFile, utimes, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { cleanupExpiredExports } from './temporary.js';

it('removes only expired converter directories, preserving recent work, unrelated data and symlink targets', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'studio-expiry-'));
  try {
    const old = new Date(Date.now() - 172800000);
    for (const name of ['export-ABC123', 'export-RECENT', 'originals']) await mkdir(resolve(root, name));
    await writeFile(resolve(root, 'originals', 'source.docx'), 'private');
    await symlink(resolve(root, 'originals'), resolve(root, 'export-LINK12'));
    await writeFile(resolve(root, 'export-FILE12'), 'unrelated');
    for (const name of ['export-ABC123', 'originals', 'export-FILE12']) await utimes(resolve(root, name), old, old);
    await cleanupExpiredExports(root);
    expect((await readdir(root)).sort()).toEqual(['export-FILE12', 'export-LINK12', 'export-RECENT', 'originals']);
    await cleanupExpiredExports(resolve(root, 'absent'));
    await cleanupExpiredExports(resolve(root, 'export-LINK12'));
    expect(await readdir(resolve(root, 'originals'))).toEqual(['source.docx']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
