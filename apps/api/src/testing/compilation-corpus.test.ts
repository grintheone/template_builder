import { createHash } from 'node:crypto';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { compilationCorpus } from './compilation-corpus.js';
import { createDocxFixture, paragraph } from './docx-fixture.js';
import { indexDocx } from '../services/docx/indexer.js';
import { parseXml, validatePackage } from '../services/docx/validate-package.js';
import { resolveOccurrence } from '../services/ai/match-resolver.js';
import { DocxRenderer } from '../services/docx/renderer.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const hash = (source: Buffer) => createHash('sha256').update(source).digest('hex');

describe('independent compilation acceptance corpus (hand-authored expected outputs)', () => {
  for (const sample of compilationCorpus()) {
    it(`${sample.name}: verifies selected ranges, expected tags, structure and untouched parts`, async () => {
      const initialHash = hash(sample.source);
      await validatePackage(sample.source, 15 * 1024 * 1024, 'import');
      const { blocks } = indexDocx(sample.source);
      const expectedBlocks = indexDocx(sample.expected).blocks;
      const byId = new Map(blocks.map((block) => [block.id, block]));
      const approved = new Map<string, { start: number; end: number; key: string }[]>();
      for (const selection of sample.selections) {
        const matches = blocks.filter((block) => block.section === selection.section && block.text === selection.text);
        expect(matches).toHaveLength(1);
        const block = matches[0];
        if (!block) throw new Error('Missing fixture block');
        const end = selection.start + selection.quote.length;
        const resolution = resolveOccurrence({ blockId: block.id, quote: selection.quote,
          contextBefore: block.text.slice(0, selection.start), contextAfter: block.text.slice(end) }, byId);
        expect(resolution).toMatchObject({ status: 'resolved', start: selection.start, end });
        const ranges = approved.get(block.id) ?? [];
        ranges.push({ start: selection.start, end, key: selection.key });
        approved.set(block.id, ranges);
        // Every selected code unit is mapped to an original w:t node.
        expect(block.spans.filter((span) => span.end > selection.start && span.start < end)
          .reduce((length, span) => length + Math.min(span.end, end) - Math.max(span.start, selection.start), 0)).toBe(selection.quote.length);
      }
      for (const block of blocks) {
        let text = block.text;
        for (const range of (approved.get(block.id) ?? []).sort((a, b) => b.start - a.start)) {
          text = `${text.slice(0, range.start)}[[${range.key}]]${text.slice(range.end)}`;
        }
        expect(expectedBlocks.find((item) => item.id === block.id)?.text).toBe(text);
      }
      const source = new PizZip(sample.source);
      const expected = new PizZip(sample.expected);
      expect(Object.keys(expected.files).sort()).toEqual(Object.keys(source.files).sort());
      for (const path of Object.keys(source.files).filter((path) => !source.files[path]?.dir)) {
        const before = source.file(path)?.asNodeBuffer();
        const after = expected.file(path)?.asNodeBuffer();
        if (!sample.changedParts.includes(path)) { expect(after).toEqual(before); continue; }
        if (!before || !after) throw new Error('Missing fixture part');
        // Mask only text-node contents; all run properties, attributes, relationships,
        // table structure and whitespace attributes must match exactly in these pairs.
        const skeleton = (buffer: Buffer) => {
          const xml = parseXml(buffer);
          for (const node of Array.from(xml.getElementsByTagNameNS(W, 't'))) node.textContent = '';
          return xml.toString();
        };
        expect(skeleton(after)).toBe(skeleton(before));
      }
      await expect(new DocxRenderer().render(sample.expected, sample.values)).resolves.toBeInstanceOf(Buffer);
      expect(hash(sample.source)).toBe(initialHash);
    });
  }
  it('retains ambiguous and unsafe source evidence for later rejection tests', async () => {
    const source = createDocxFixture({ body: paragraph('Alex Morgan and Alex Morgan')
      + '<w:p><w:r><w:t>Alex </w:t><w:fldChar w:fldCharType="begin"/><w:instrText> MERGEFIELD client </w:instrText><w:fldChar w:fldCharType="end"/><w:t>Morgan</w:t></w:r></w:p>',
      header: paragraph('Static'), footer: paragraph('Static') });
    await validatePackage(source, 15 * 1024 * 1024, 'import');
    const blocks = indexDocx(source).blocks.filter((block) => block.section === 'body');
    const byId = new Map(blocks.map((block) => [block.id, block]));
    expect(resolveOccurrence({ blockId: blocks[0]?.id ?? '', quote: 'Alex Morgan' }, byId)).toMatchObject({ reason: 'ambiguous' });
    expect(resolveOccurrence({ blockId: blocks[1]?.id ?? '', quote: 'Alex Morgan' }, byId)).toMatchObject({ reason: 'unsupported_block' });
  });
});
