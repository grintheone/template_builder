import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './index.js';
import { appMetadata } from './schema.js';
import { readConfig } from '../config.js';
import { mkdirSync } from 'node:fs';

describe('database migrations', () => {
  it('creates the schema and can reapply migrations without losing data', () => {
    const base = readConfig({});
    mkdirSync(base.STORAGE_DIR, { recursive: true });
    const directory = mkdtempSync(resolve(base.STORAGE_DIR, 'db-test-'));
    const config = { DATABASE_PATH: resolve(directory, 'test.sqlite'), STORAGE_DIR: resolve(directory, 'files') };
    try {
      const first = openDatabase(config);
      try { first.db.insert(appMetadata).values({ key: 'test', value: 'preserved' }).run(); }
      finally { first.close(); }
      const second = openDatabase(config);
      try { expect(second.db.select().from(appMetadata).all()).toEqual([{ key: 'test', value: 'preserved' }]); }
      finally { second.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
