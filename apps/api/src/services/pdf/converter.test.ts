import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PdfConverter } from './converter.js';
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fake(code: string, timeout = 2000) {
  const directory = await mkdtemp(resolve(tmpdir(), 'studio-pdf-test-')); directories.push(directory);
  const binary = resolve(directory, 'fake soffice');
  await writeFile(binary, `#!${process.execPath}\n${code}`, { mode: 0o700 });
  const temporary = resolve(directory, 'temporary');
  return { converter: new PdfConverter(binary, temporary, timeout), temporary };
}
it('uses separate private profiles, fixed filenames, no shell and cleans successful conversion', async () => {
  const s = await fake(`const fs = require('node:fs'); const path = require('node:path'); const args = process.argv.slice(2); const dir = args[args.indexOf('--outdir') + 1]; if (!args[0].startsWith('-env:UserInstallation=file:') || fs.readFileSync(path.join(dir, 'document.docx'), 'utf8') !== 'source') process.exit(1); fs.writeFileSync(path.join(dir, 'document.pdf'), '%PDF-1.7\\nfixture');`);
  expect((await s.converter.convert(Buffer.from('source'))).toString()).toContain('%PDF-');
  expect(await readdir(s.temporary)).toEqual([]);
  expect((await s.converter.convert(Buffer.from('source'))).toString()).toContain('%PDF-');
});
it('sanitizes conversion errors, invalid output, timeout and cleans every temp directory', async () => {
  for (const code of ["process.stderr.write('sensitive text'); process.exit(1)", 'process.exit(0)', 'setTimeout(() => {}, 10000)', "const fs=require('node:fs');const path=require('node:path');fs.writeFileSync(path.join(process.argv[process.argv.indexOf('--outdir')+1],'document.pdf'),'invalid')"]) {
    const s = await fake(code, 150);
    await expect(s.converter.convert(Buffer.from('private'))).rejects.toThrow(/LibreOffice|PDF export/);
    expect(await readdir(s.temporary)).toEqual([]);
  }
});
it('rejects concurrent conversions with an actionable busy response', async () => {
  const s = await fake('setTimeout(() => {}, 10000)', 150);
  const first = s.converter.convert(Buffer.from('source'));
  await expect(s.converter.convert(Buffer.from('source'))).rejects.toMatchObject({ code: 'PDF_BUSY' });
  await expect(first).rejects.toMatchObject({ code: 'PDF_FAILED' });
  expect(await readdir(s.temporary)).toEqual([]);
});
