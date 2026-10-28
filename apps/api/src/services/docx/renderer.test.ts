import { createHash } from 'node:crypto';
import PizZip from 'pizzip';
import { describe, expect, it, vi } from 'vitest';
import { createDocxFixture, paragraph } from '../../testing/docx-fixture.js';
import { DocxRenderer } from './renderer.js';
import { parseXml } from './validate-package.js';

const renderer = new DocxRenderer();
const values = { client_name: 'Иван & 李 <Company> 😀', amount: 0 };
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const text = (zip: PizZip, path: string) => {
  const part = zip.file(path);
  if (!part) throw new Error('Fixture part missing');
  return parseXml(part.asNodeBuffer()).documentElement?.textContent ?? '';
};
const modified = (change: (zip: PizZip) => void) => {
  const zip = new PizZip(createDocxFixture());
  change(zip);
  return zip.generate({ type: 'nodebuffer' });
};

describe('DocxRenderer', () => {
  it('renders paragraphs, a split run, a table, repeated fields, headers and footers', async () => {
    const rendered = new PizZip(await renderer.render(createDocxFixture(), values));
    const body = text(rendered, 'word/document.xml');
    expect(body.match(/Иван & 李 <Company> 😀/g)).toHaveLength(3);
    expect(body).toContain('0 USD');
    expect(body).toContain('Пример соглашения — 合同.');
    expect(body).not.toContain('[[');
    expect(body).not.toContain('undefined');
    expect(text(rendered, 'word/header1.xml')).toContain(values.client_name);
    expect(text(rendered, 'word/footer1.xml')).toContain(values.client_name);
    expect(rendered.file('word/document.xml')?.asText()).toContain('&amp;');
  });
  it('preserves source bytes and supports repeated independent renders', async () => {
    const source = createDocxFixture();
    const originalHash = hash(source);
    const first = await renderer.render(source, { client_name: 'First', amount: 1 });
    const second = await renderer.render(source, { client_name: 'Second', amount: 2 });
    expect(hash(source)).toBe(originalHash);
    expect(text(new PizZip(first), 'word/document.xml')).toContain('First');
    expect(text(new PizZip(second), 'word/document.xml')).toContain('Second');
    expect(text(new PizZip(second), 'word/document.xml')).not.toContain('First');
  });
  it('preserves non-target ZIP parts and formatting/structure in target parts', async () => {
    const source = createDocxFixture();
    const original = new PizZip(source);
    const rendered = new PizZip(await renderer.render(source, values));
    expect(Object.keys(rendered.files).sort()).toEqual(Object.keys(original.files).sort());
    for (const path of Object.keys(original.files)) {
      if (/word\/(document|header1|footer1)\.xml$/.test(path) || original.files[path]?.dir) continue;
      expect(rendered.file(path)?.asNodeBuffer()).toEqual(original.file(path)?.asNodeBuffer());
    }
    const xml = rendered.file('word/document.xml')?.asText() ?? '';
    for (const marker of ['<w:b/>', '<w:i/>', 'w:val="285B47"', 'w:val="36"', '<w:tbl>', '<w:numPr>', '<w:drawing>', '<w:sectPr>']) expect(xml).toContain(marker);
  });
  it('leaves a header/footer with no placeholders byte-identical', async () => {
    const source = createDocxFixture({ header: paragraph('Static header'), footer: paragraph('Static footer') });
    const output = new PizZip(await renderer.render(source, values));
    expect(output.file('word/header1.xml')?.asText()).toBe(new PizZip(source).file('word/header1.xml')?.asText());
    expect(output.file('word/footer1.xml')?.asText()).toBe(new PizZip(source).file('word/footer1.xml')?.asText());
  });
  it('renders explicit blank values, negative numbers and multiline text', async () => {
    const output = new PizZip(await renderer.render(createDocxFixture(), { client_name: 'Line 1\nLine 2', amount: -12.5 }));
    expect(output.file('word/document.xml')?.asText()).toContain('<w:br/>');
    expect(text(output, 'word/document.xml')).toContain('-12.5 USD');
    expect(text(new PizZip(await renderer.render(createDocxFixture(), { client_name: '', amount: 0 })), 'word/header1.xml')).not.toContain('undefined');
  });
  it.each([{ amount: 1 }, { ...values, unknown_key: 'x' }, { client_name: undefined, amount: 0 }, { client_name: null, amount: 0 }])('rejects missing, unknown or invalid values: %o', async (input) => {
    await expect(renderer.render(createDocxFixture(), input)).rejects.toMatchObject({ code: expect.stringMatching(/FIELD_MISMATCH|INVALID_VALUES/) });
  });
  it.each(['[[client_name]', 'client_name]]', '[[client.name]]', '[[@client_name]]', '[[#client_name]]x[[/client_name]]', '[[=<< >>=]]<<client_name>>'])('rejects malformed or unsupported tags without logging source text', async (tag) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const source = createDocxFixture({ body: paragraph(tag) });
      const originalHash = hash(source);
      await expect(renderer.render(source, values)).rejects.toMatchObject({ code: 'INVALID_TEMPLATE' });
      expect(hash(source)).toBe(originalHash);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally { log.mockRestore(); error.mockRestore(); }
  });
  it('supports templates without placeholders only with an empty values object', async () => {
    const source = createDocxFixture({ body: paragraph('Plain document'), header: paragraph('Header'), footer: paragraph('Footer') });
    await expect(renderer.render(source, {})).resolves.toBeInstanceOf(Buffer);
    await expect(renderer.render(source, { unused: 'x' })).rejects.toMatchObject({ code: 'FIELD_MISMATCH' });
  });
  it('bounds output amplification from repeated large values', async () => {
    const source = createDocxFixture({ body: paragraph('[[client_name]]'.repeat(200)) });
    await expect(renderer.render(source, { client_name: 'x'.repeat(10000) })).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
  });
  it('rejects oversize input before ZIP parsing', async () => {
    await expect(new DocxRenderer(10).render(createDocxFixture(), values)).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
  });
  it.each([Buffer.from('not a zip'), Buffer.from('PK\u0003\u0004broken')])('rejects corrupt packages', async (source) => {
    await expect(renderer.render(source, values)).rejects.toMatchObject({ code: 'INVALID_DOCX' });
  });
  it('rejects missing main XML, malformed XML, macros, unknown parts, and DTDs', async () => {
    const sources = [
      modified((zip) => zip.remove('word/document.xml')),
      modified((zip) => zip.file('word/document.xml', '<w:document>broken')),
      modified((zip) => zip.file('word/vbaProject.bin', 'macro')),
      modified((zip) => zip.file('word/embeddings/object.bin', 'object')),
      modified((zip) => zip.file('word/settings.xml', '<!DOCTYPE x [<!ENTITY x "boom">]><x>&x;</x>')),
    ];
    for (const source of sources) await expect(renderer.render(source, values)).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_DOCX|UNSUPPORTED_DOCX/) });
  });
  it('rejects tracked edits, field codes and text boxes explicitly', async () => {
    for (const body of [`<w:ins>${paragraph('[[client_name]]')}</w:ins>`, '<w:p><w:fldSimple w:instr="DATE"/></w:p>', `<w:p><w:r><w:txbxContent>${paragraph('[[client_name]]')}</w:txbxContent></w:r></w:p>`]) {
      await expect(renderer.render(createDocxFixture({ body }), values)).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCX' });
    }
  });
  it('rejects archive path traversal', async () => {
    const source = modified((zip) => zip.file('../escape.xml', '<x/>'));
    await expect(renderer.render(source, values)).rejects.toMatchObject({ code: 'INVALID_DOCX' });
  });
  it('rejects encrypted entries and excessive advertised expansion', async () => {
    const source = createDocxFixture();
    const central = source.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const encrypted = Buffer.from(source);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    await expect(renderer.render(encrypted, values)).rejects.toMatchObject({ code: 'INVALID_DOCX' });
    const inflated = Buffer.from(source);
    inflated.writeUInt32LE(11 * 1024 * 1024, central + 24);
    await expect(renderer.render(inflated, values)).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
  });
});
