import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readConfig } from '../config.js';
import { createDocxFixture } from './docx-fixture.js';
import { createStarterFixture } from './starter-fixture.js';

const config = readConfig();
mkdirSync(config.STORAGE_DIR, { recursive: true, mode: 0o700 });
const path = resolve(config.STORAGE_DIR, 'demo-tagged.docx');
writeFileSync(path, createDocxFixture(), { mode: 0o600 });
writeFileSync(resolve(config.STORAGE_DIR, 'starter-agreement.docx'), createStarterFixture(), { mode: 0o600 });
console.log('Created starter-agreement.docx for import and demo-tagged.docx for the tagged renderer in the configured storage directory.');
