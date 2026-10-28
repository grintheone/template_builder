import { createHash } from 'node:crypto';
import PizZip from 'pizzip';
import type { Element } from '@xmldom/xmldom';
import { reviewSelectionSchema, type ReviewedField } from '@studio/shared';
import { indexDocx } from './indexer.js';
import { parseXml, validatePackage } from './validate-package.js';
import { DocxRenderer } from './renderer.js';
import { ReviewFailure } from '../templates/errors.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const hashSource = (source: Buffer) => createHash('sha256').update(source).digest('hex');
const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
type LexicalNode = { element: Element; start: number; contentStart: number; contentEnd: number; end: number; opening: string; closing: string };

// Match original lexical start tags to the independently parsed DOM's element order.
// XML is already validated; no serialization of unaffected markup is performed.
function textLocations(xml: string): LexicalNode[] {
  const document = parseXml(Buffer.from(xml));
  const elements = Array.from(document.getElementsByTagName('*'));
  const tags = [...xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<([A-Za-z_][\w.:-]*)(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g)].filter((m) => m[1]);
  if (elements.length !== tags.length) throw new ReviewFailure('UNSAFE_SPAN', 422, 'The XML text layout cannot be edited safely.');
  return elements.flatMap((element, i) => {
    if (element.namespaceURI !== W || element.localName !== 't') return [];
    const tag = tags[i];
    if (!tag || tag.index === undefined) throw new ReviewFailure('UNSAFE_SPAN', 422, 'The XML text layout cannot be edited safely.');
    const start = tag.index; const contentStart = start + tag[0].length;
    if (tag[1] !== element.nodeName) throw new ReviewFailure('UNSAFE_SPAN', 422, 'The XML text layout cannot be edited safely.');
    const empty = tag[0].endsWith('/>');
    const contentEnd = empty ? contentStart : xml.indexOf(`</${element.nodeName}>`, contentStart);
    if (contentEnd < contentStart || (!empty && /[<]/.test(xml.slice(contentStart, contentEnd)))) throw new ReviewFailure('UNSAFE_SPAN', 422, 'Complex XML text nodes require manual document repair.');
    return [{ element, start, contentStart, contentEnd, end: empty ? contentStart : contentEnd + element.nodeName.length + 3, opening: tag[0], closing: `</${element.nodeName}>` }];
  });
}
function splitSurrogate(text: string, offset: number) { return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text.charAt(offset - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(offset)); }

export class TemplateCompiler {
  constructor(private maxBytes = 15 * 1024 * 1024) {}
  async validate(source: Buffer, sourceHash: string, fields: ReviewedField[]) {
    if (hashSource(source) !== sourceHash) throw new ReviewFailure('CONFLICT', 409, 'The source hash has changed. Reimport the document.');
    if (!reviewSelectionSchema.safeParse({ sourceHash, fields, decisions: [] }).success) throw new ReviewFailure('INVALID_SELECTION', 422, 'Invalid field definitions or occurrence identities.');
    await validatePackage(source, this.maxBytes, 'import');
    const zip = new PizZip(source);
    const blocks = new Map(indexDocx(source).blocks.map((b) => [b.id, b]));
    const parts = new Map<string, { xml: string; nodes: LexicalNode[]; changes: Map<number, { start: number; end: number; replacement: string }[]> }>();
    const occupied = new Map<string, { start: number; end: number }[]>();
    for (const field of fields) for (const occurrence of field.occurrences) {
      const fail: (code: 'INVALID_SELECTION' | 'UNSAFE_SPAN', message: string) => never = (code: 'INVALID_SELECTION' | 'UNSAFE_SPAN', message: string): never => { throw new ReviewFailure(code, 422, message, [{ code, fieldId: field.id, occurrenceId: occurrence.id }]); };
      const block = blocks.get(occurrence.blockId);
      if (!block || occurrence.end > block.text.length || block.text.slice(occurrence.start, occurrence.end) !== occurrence.quote || splitSurrogate(block.text, occurrence.start) || splitSurrogate(block.text, occurrence.end)) fail('INVALID_SELECTION', 'Select an exact source range without splitting a Unicode character.');
      if (!block.supported) fail('UNSAFE_SPAN', 'This paragraph contains unsupported structures. Edit the source document before replacing it.');
      const ranges = occupied.get(block.id) ?? [];
      if (ranges.some((r) => occurrence.start < r.end && occurrence.end > r.start)) fail('INVALID_SELECTION', 'Approved source ranges overlap.');
      ranges.push(occurrence); occupied.set(block.id, ranges);
      let part = parts.get(block.partPath);
      if (!part) {
        const entry = zip.file(block.partPath);
        if (!entry) fail('INVALID_SELECTION', 'The source part is missing.');
        const xml = entry.asText(); part = { xml, nodes: textLocations(xml), changes: new Map() }; parts.set(block.partPath, part);
      }
      const spans = block.spans.filter((s) => s.end > s.start && s.end > occurrence.start && s.start < occurrence.end);
      if (spans.reduce((n, s) => n + Math.min(s.end, occurrence.end) - Math.max(s.start, occurrence.start), 0) !== occurrence.quote.length) fail('UNSAFE_SPAN', 'The selection does not have complete text-node coverage.');
      const currentPart = part;
      const nodes = spans.map((s) => {
        const node = currentPart.nodes[s.textNodeIndex];
        if (!node) fail('UNSAFE_SPAN', 'Source text-node mapping is incomplete.');
        return node;
      });
      const container = nodes[0]?.element.parentNode?.parentNode;
      if (!container || nodes.some((n) => n.element.parentNode?.localName !== 'r' || n.element.parentNode?.namespaceURI !== W || n.element.parentNode.parentNode !== container)) fail('UNSAFE_SPAN', 'A selection cannot cross hyperlink or paragraph containers.');
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!first || !last || !first.element.ownerDocument) fail('UNSAFE_SPAN', 'The source text-node range is empty.');
      const domElements = Array.from(first.element.ownerDocument.getElementsByTagName('*'));
      const between = domElements.slice(domElements.indexOf(first.element) + 1, domElements.indexOf(last.element));
      if (between.some((e) => e.namespaceURI === W && ['bookmarkStart', 'bookmarkEnd', 'permStart', 'permEnd', 'fldChar', 'instrText'].includes(e.localName ?? ''))) fail('UNSAFE_SPAN', 'A selection cannot cross bookmark, permission or field-code boundaries.');
      spans.forEach((span, i) => {
        const changes = currentPart.changes.get(span.textNodeIndex) ?? [];
        changes.push({ start: Math.max(0, occurrence.start - span.start), end: Math.min(span.end, occurrence.end) - span.start, replacement: i === 0 ? `[[${field.key}]]` : '' });
        currentPart.changes.set(span.textNodeIndex, changes);
      });
    }
    return { zip, parts };
  }
  async compile(source: Buffer, sourceHash: string, fields: ReviewedField[]): Promise<Buffer> {
    if (!fields.length) throw new ReviewFailure('INVALID_SELECTION', 422, 'Approve at least one field before publishing.');
    const { zip, parts } = await this.validate(source, sourceHash, fields);
    // Includes non-indexed XML text parts: never activate source-authored template syntax.
    for (const [path, entry] of Object.entries(zip.files)) if (!entry.dir && /\.xml$/.test(path)) {
      const xml = parseXml(entry.asNodeBuffer());
      const text = xml.documentElement?.textContent ?? '';
      if (text.includes('[[') || text.includes(']]')) throw new ReviewFailure('INVALID_TEMPLATE', 422, 'Remove existing [[ or ]] delimiter text from the source before publishing.');
    }
    for (const [path, part] of parts) {
      let xml = part.xml;
      const edits = [...part.changes].map(([index, changes]) => {
        const node = part.nodes[index];
        if (!node) throw new ReviewFailure('UNSAFE_SPAN', 422, 'The source text-node mapping is incomplete.');
        let text = node.element.textContent ?? '';
        for (const edit of changes.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
        let opening = node.opening.replace(/\/>$/, '>');
        if (/^\s|\s$/.test(text) && !node.element.hasAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')) opening = opening.replace(/>$/, ' xml:space="preserve">');
        return { start: node.start, end: node.end, xml: opening + escapeText(text) + node.closing };
      }).sort((a, b) => b.start - a.start);
      for (const edit of edits) xml = xml.slice(0, edit.start) + edit.xml + xml.slice(edit.end);
      parseXml(Buffer.from(xml)); zip.file(path, xml);
    }
    const result = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    const actual = indexDocx(result).blocks.flatMap((b) => [...b.text.matchAll(/\[\[([a-z0-9_]+)\]\]/g)].map((m) => m[1] ?? '')).sort();
    const expected = fields.flatMap((f) => f.occurrences.map(() => f.key)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new ReviewFailure('INVALID_TEMPLATE', 422, 'Compiled placeholders do not match the approved selection.');
    try { await new DocxRenderer(this.maxBytes).render(result, Object.fromEntries(fields.map((f) => [f.key, 'Test']))); }
    catch { throw new ReviewFailure('INVALID_TEMPLATE', 422, 'This document cannot be safely rendered as a scalar template. Remove unsupported document structures.'); }
    return result;
  }
}
