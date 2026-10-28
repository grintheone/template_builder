import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import type { AppConfig } from '../config.js';

export function openDatabase(config: Pick<AppConfig, 'DATABASE_PATH' | 'STORAGE_DIR'>) {
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true, mode: 0o700 });
  mkdirSync(config.STORAGE_DIR, { recursive: true, mode: 0o700 });
  const sqlite = new Database(config.DATABASE_PATH);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
    return { db, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
