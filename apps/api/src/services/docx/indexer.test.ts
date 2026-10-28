import { describe, expect, it } from 'vitest';
import { indexDocx } from './indexer.js';
import { validatePackage } from './validate-package.js';
import { createDocxFixture, paragraph } from '../../testing/docx-fixture.js';

describe('source indexing', () => {
  it('indexes stable paragraphs, tables, headers, footers, blank and repeated Unicode text', async () => {
    const source = createDocxFixture({ body: `${paragraph('Мария 😀 & Co')}${paragraph('Мария 😀 & Co')}<w:p/><w:p><w:r><w:t>Split </w:t></w:r><w:r><w:t>phrase 😀</w:t></w:r></w:p><w:tbl><w:tr><w:tc>${paragraph('Cell')}</w:tc></w:tr></w:tbl>` });
    await validatePackage(source, 15 * 1024 * 1024, 'import');
    const result = indexDocx(source);
    expect(result).toEqual(indexDocx(source));
    const body = result.blocks.filter((block) => block.section === 'body');
    expect(body.map((block) => block.text)).toEqual(['Мария 😀 & Co', 'Мария 😀 & Co', '', 'Split phrase 😀', 'Cell']);
    expect(new Set(result.blocks.map((block) => block.id)).size).toBe(result.blocks.length);
    expect(body[3]?.spans).toEqual([{ start: 0, end: 6, textNodeIndex: 2 }, { start: 6, end: 15, textNodeIndex: 3 }]);
    expect(body[4]?.location).toBe('tbl[1]/tr[1]/tc[1]/p[5]');
    expect(result.blocks.some((block) => block.section === 'header')).toBe(true);
    expect(result.blocks.some((block) => block.section === 'footer')).toBe(true);
    expect(body.every((block) => block.supported)).toBe(true);
  });
  it('imports unsupported constructs with explicit warnings and disables unsafe paragraphs', async () => {
    const source = createDocxFixture({ body: `<w:p><w:ins>${'<w:r><w:t>Tracked</w:t></w:r>'}</w:ins></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>${paragraph('Field result')}<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p><w:r><w:pict><w:txbxContent>${paragraph('Box')}</w:txbxContent></w:pict></w:r></w:p>${paragraph('Safe')}<w:altChunk/>` });
    await validatePackage(source, 15 * 1024 * 1024, 'import');
    const result = indexDocx(source);
    expect(result.blocks.filter((block) => block.section === 'body').map((block) => block.supported)).toEqual([false, false, false, false, false, false, true]);
    expect(result.warnings.join(' ')).toMatch(/altChunk/);
    expect(result.warnings.join(' ')).toMatch(/txbxContent/);
    expect(result.blocks.find((block) => block.text === 'Box')?.warnings.join(' ')).toMatch(/unsupported/);
    await expect(validatePackage(source, 15 * 1024 * 1024)).rejects.toThrow();
  });
  it('retains tab and break positions without inventing text-node mappings', () => {
    const result = indexDocx(createDocxFixture({ body: '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>' }));
    const block = result.blocks.find((block) => block.section === 'body');
    expect(block?.text).toBe('A\tB\nC');
    expect(block?.spans.map((span) => [span.start, span.end])).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(block?.supported).toBe(false);
  });
});
