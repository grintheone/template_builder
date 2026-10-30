import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { expect, it } from 'vitest';
import type { ReviewedField } from '@studio/shared';
import { createComplexDocxFixture } from '../../testing/docx-fixture.js';
import { hashSource, TemplateCompiler } from './compiler.js';
import { indexDocx } from './indexer.js';
import { DocxRenderer } from './renderer.js';
import { validatePackage } from './validate-package.js';

const limit = 15 * 1024 * 1024;
const change = (edit: (zip: PizZip) => void) => {
  const zip = new PizZip(createComplexDocxFixture());
  edit(zip);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

it('imports, compiles and renders complex passive parts without changing their bytes', async () => {
  const source = createComplexDocxFixture();
  const before = Buffer.from(source);
  await validatePackage(source, limit, 'import');
  const { blocks, warnings } = indexDocx(source);
  for (const label of ['Comments', 'Charts', 'SmartArt', 'Custom XML']) expect(warnings.join(' ')).toContain(label);
  expect(blocks.find((b) => b.text === 'Commented clause')?.supported).toBe(false);
  expect(blocks.some((b) => b.location.includes('tbl[') && b.supported)).toBe(true);
  const block = blocks.find((b) => b.text === 'Alex');
  expect(block?.supported).toBe(true);
  const field: ReviewedField = { id: randomUUID(), key: 'client_name', label: 'Client', type: 'text', required: true, formatting: {}, occurrences: [{ id: randomUUID(), blockId: block?.id ?? '', quote: 'Alex', start: 0, end: 4 }] };
  const compiled = await new TemplateCompiler().compile(source, hashSource(source), [field]);
  const rendered = await new DocxRenderer().render(compiled, { client_name: 'Мария & Co' });
  const original = new PizZip(source);
  for (const output of [compiled, rendered]) {
    const zip = new PizZip(output);
    expect(Object.keys(zip.files).sort()).toEqual(Object.keys(original.files).sort());
    for (const [path, entry] of Object.entries(original.files)) {
      if (!entry.dir && path !== 'word/document.xml') expect(zip.file(path)?.asNodeBuffer(), path).toEqual(entry.asNodeBuffer());
    }
    const xml = zip.file('word/document.xml')?.asText() ?? '';
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('<w:commentRangeStart w:id="0"/>');
    expect(xml).toContain('<w:commentReference w:id="0"/>');
  }
  expect(indexDocx(rendered).blocks.find((b) => b.id === block?.id)?.text).toBe('Мария & Co');
  expect(source).toEqual(before);
});

it.each(['word/charts/chart2.xml', 'customXml/item2.xml', 'word/comments.xml'])('validates XML in newly supported part %s', async (path) => {
  await expect(validatePackage(change((zip) => zip.file(path, '<broken>')), limit, 'import')).rejects.toMatchObject({ code: 'INVALID_DOCX' });
  await expect(validatePackage(change((zip) => zip.file(path, '<!DOCTYPE a [<!ENTITY x "secret">]><a>&x;</a>')), limit, 'import')).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCX' });
});

it.each(['word/charts/chart1.xml', 'word/diagrams/data1.xml', 'customXml/item1.xml', 'word/comments.xml'])('rejects unrenderable delimiters in preserved %s', async (path) => {
  const source = change((zip) => zip.file(path, '<root>[[unfilled]]</root>'));
  await expect(validatePackage(source, limit, 'import')).resolves.toBeInstanceOf(Map);
  await expect(validatePackage(source, limit)).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCX' });
});

it.each([
  ['word/embeddings/Microsoft_Excel_Worksheet.xlsx', /embedded objects or workbooks/],
  ['word/vbaProject.bin', /macros or ActiveX/],
  ['word/activeX/activeX1.xml', /macros or ActiveX/],
  ['_xmlsignatures/sig1.xml', /signed DOCX/],
  ['word/private-customer-name.xml', /outside the supported allowlist/],
])('rejects unsafe or unknown part %s with a sanitized explanation', async (path, message) => {
  const source = change((zip) => zip.file(path, '<secret/>'));
  await expect(validatePackage(source, limit, 'import')).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCX', message: expect.stringMatching(message) });
  try { await validatePackage(source, limit, 'import'); } catch (error) { expect(String(error)).not.toContain(path); }
});

it('still rejects external resources and embedded workbook relationships in chart parts', async () => {
  for (const relation of [
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://example.invalid/private-image.png"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/book.xlsx"/>',
  ]) {
    const source = change((zip) => zip.file('word/charts/_rels/chart1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relation}</Relationships>`));
    await expect(validatePackage(source, limit, 'import')).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCX' });
  }
});

it('checks prohibited content types in Default declarations as well as Overrides', async () => {
  const source = change((zip) => zip.file('[Content_Types].xml', (zip.file('[Content_Types].xml')?.asText() ?? '').replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>')));
  await expect(validatePackage(source, limit, 'import')).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCX' });
});

it('accepts the remaining passive Word extensions and image filename variants', async () => {
  const source = change((zip) => {
    for (const path of [
      'word/commentsExtensible.xml', 'word/commentsIds.xml', 'word/people.xml',
      'word/charts/colors1.xml', 'word/diagrams/drawing1.xml', 'word/diagrams/layout1.xml',
      'word/diagrams/quickStyle1.xml', 'word/diagrams/colors1.xml',
    ]) zip.file(path, '<root/>');
    for (const path of ['word/_rels/comments.xml.rels', 'word/diagrams/_rels/data1.xml.rels']) {
      zip.file(path, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    }
    const image = zip.file('word/media/pixel.png')?.asNodeBuffer();
    if (!image) throw new Error('Missing fixture image');
    zip.file('word/media/Company Logo.PNG', image);
  });
  await expect(validatePackage(source, limit, 'import')).resolves.toBeInstanceOf(Map);
  const output = new PizZip(await new DocxRenderer().render(source, {}));
  const original = new PizZip(source);
  for (const [path, entry] of Object.entries(original.files)) {
    if (!entry.dir) expect(output.file(path)?.asNodeBuffer(), path).toEqual(entry.asNodeBuffer());
  }
});
