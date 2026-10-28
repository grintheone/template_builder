import { randomUUID, createHash } from 'node:crypto';
import PizZip from 'pizzip';
import { expect, it } from 'vitest';
import type { ReviewedField } from '@studio/shared';
import { compilationCorpus } from '../../testing/compilation-corpus.js';
import { createDocxFixture, paragraph } from '../../testing/docx-fixture.js';
import { indexDocx } from './indexer.js';
import { TemplateCompiler } from './compiler.js';

const sourceHash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function selection(source: Buffer, quote = 'Alex', start = 0): ReviewedField {
  const block = indexDocx(source).blocks.find((b) => b.section === 'body');
  return { id: randomUUID(), key: 'client_name', label: 'Client', type: 'text', required: true, formatting: {}, occurrences: [{ id: randomUUID(), blockId: block?.id ?? '', quote, start, end: start + quote.length }] };
}
for (const sample of compilationCorpus()) it(`real compiler: ${sample.name} matches independent expected XML bytes`, async () => {
  const fields = sample.selections.map((s): ReviewedField => ({ id: randomUUID(), key: s.key, label: s.key, type: 'text', required: true, formatting: {}, occurrences: [{ id: randomUUID(), blockId: indexDocx(sample.source).blocks.find((b) => b.text === s.text && b.section === s.section)?.id ?? '', quote: s.quote, start: s.start, end: s.start + s.quote.length }] }));
  const before = Buffer.from(sample.source);
  const result = new PizZip(await new TemplateCompiler().compile(sample.source, sourceHash(sample.source), fields));
  const expected = new PizZip(sample.expected);
  expect(Object.keys(result.files).sort()).toEqual(Object.keys(expected.files).sort());
  for (const path of Object.keys(expected.files).filter((p) => !expected.files[p]?.dir)) expect(result.file(path)?.asNodeBuffer()).toEqual(expected.file(path)?.asNodeBuffer());
  expect(sample.source).toEqual(before);
});
it('handles adjacent edits from original offsets and adds space preservation only where necessary', async () => {
  const source = createDocxFixture({ header: paragraph('Static'), footer: paragraph('Static'), body: paragraph('AlexBob tail') });
  const a = selection(source); const b = selection(source, 'Bob', 4); b.key = 'other_name';
  const result = await new TemplateCompiler().compile(source, sourceHash(source), [a, b]);
  expect(indexDocx(result).blocks[0]?.text).toBe('[[client_name]][[other_name]] tail');
});
for (const kind of ['overlap', 'missing', 'stale', 'surrogate', 'delimiter', 'bookmark', 'hyperlink', 'field'] as const) it(`rejects ${kind} without mutating source`, async () => {
  const bodies = {
    overlap: paragraph('Alex'), missing: paragraph('Alex'), stale: paragraph('Alex'), surrogate: paragraph('😀Alex'), delimiter: paragraph('Alex [[hidden]]'),
    bookmark: '<w:p><w:r><w:t>Al</w:t></w:r><w:bookmarkStart w:id="0" w:name="a"/><w:r><w:t>ex</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>',
    hyperlink: '<w:p><w:r><w:t>Al</w:t></w:r><w:hyperlink><w:r><w:t>ex</w:t></w:r></w:hyperlink></w:p>',
    field: '<w:p><w:r><w:t>Al</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>X</w:instrText><w:fldChar w:fldCharType="end"/><w:t>ex</w:t></w:r></w:p>',
  };
  const source = createDocxFixture({ header: paragraph('Static'), footer: paragraph('Static'), body: bodies[kind] }); const before = Buffer.from(source);
  const f = selection(source);
  const occurrence = f.occurrences[0]; if (!occurrence) throw new Error('Missing fixture occurrence');
  if (kind === 'overlap') f.occurrences.push({ ...occurrence, id: randomUUID() });
  if (kind === 'missing') occurrence.blockId = 'missing';
  if (kind === 'surrogate') Object.assign(occurrence, { quote: '\ude00', start: 1, end: 2 });
  await expect(new TemplateCompiler().compile(source, kind === 'stale' ? '0'.repeat(64) : sourceHash(source), [f])).rejects.toThrow();
  expect(source).toEqual(before);
});
it('preserves lexical markup, empty runs and XML escaping around a split selection', async () => {
  const source = createDocxFixture({ header: paragraph('Static'), footer: paragraph('Static'), body: `<w:p><w:r><w:rPr><w:b /></w:rPr><w:t>Al</w:t></w:r><w:r><w:t /></w:r><w:r><w:t>ex &amp; tail </w:t></w:r></w:p>` });
  const compiled = await new TemplateCompiler().compile(source, sourceHash(source), [selection(source)]);
  const xml = new PizZip(compiled).file('word/document.xml')?.asText();
  expect(xml).toContain('<w:rPr><w:b /></w:rPr><w:t>[[client_name]]</w:t>');
  expect(xml).toContain('<w:r><w:t /></w:r>');
  expect(xml).toContain('<w:t xml:space="preserve"> &amp; tail </w:t>');
});
it('refuses cross-paragraph quotes and unsupported rendering structures in untouched paragraphs', async () => {
  const source = createDocxFixture({ header: paragraph('Static'), footer: paragraph('Static'), body: paragraph('Al') + paragraph('ex') });
  await expect(new TemplateCompiler().compile(source, sourceHash(source), [selection(source)])).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
  const unsupported = createDocxFixture({ header: paragraph('Static'), footer: paragraph('Static'), body: `${paragraph('Alex')}<w:p><w:fldSimple w:instr="DATE"><w:r><w:t>Date</w:t></w:r></w:fldSimple></w:p>` });
  await expect(new TemplateCompiler().compile(unsupported, sourceHash(unsupported), [selection(unsupported)])).rejects.toMatchObject({ code: 'INVALID_TEMPLATE' });
});
