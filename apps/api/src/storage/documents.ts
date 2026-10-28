import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import { localDataPath } from '../config.js';
import { openDatabase } from '../db/index.js';
import { documents } from '../db/schema.js';
import { validatePackage } from '../services/docx/validate-package.js';
import { indexDocx } from '../services/docx/indexer.js';

const hash = (source: Buffer) => createHash('sha256').update(source).digest('hex');
export class DocumentStore {
  private database;
  constructor(private config: AppConfig, private maxUploadBytes: number) { this.database = openDatabase(config); }
  close() { this.database.close(); }
  async import(source: Buffer) {
    await validatePackage(source, this.maxUploadBytes, 'import');
    indexDocx(source); // Fail before storage if indexing cannot be completed safely.
    const documentId = randomUUID();
    const sourceHash = hash(source);
    const directory = localDataPath(resolve(this.config.STORAGE_DIR, 'originals'));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const sourcePath = localDataPath(resolve(directory, `${documentId}.docx`));
    await writeFile(sourcePath, source, { flag: 'wx', mode: 0o400 });
    try {
      this.database.db.insert(documents).values({ id: documentId, sourcePath, sourceHash, createdAt: new Date().toISOString() }).run();
    } catch (error) { await unlink(sourcePath); throw error; }
    return { documentId, sourceHash };
  }
  async blocks(documentId: string) {
    const record = this.database.db.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!record) return undefined;
    const expected = resolve(this.config.STORAGE_DIR, 'originals', `${documentId}.docx`);
    if (record.sourcePath !== expected) throw new Error('Invalid private source path');
    const source = await readFile(localDataPath(record.sourcePath));
    if (hash(source) !== record.sourceHash) throw new Error('Source integrity check failed');
    await validatePackage(source, this.maxUploadBytes, 'import');
    return { documentId, sourceHash: record.sourceHash, ...indexDocx(source) };
  }
}
