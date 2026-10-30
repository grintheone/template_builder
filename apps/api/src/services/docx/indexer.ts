import PizZip from 'pizzip';
import type { Element, Node } from '@xmldom/xmldom';
import type { SourceBlock } from '@studio/shared';
import { editablePart, parseXml } from './validate-package.js';
import { DocxError } from './errors.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const safe = new Set(['p', 'r', 't', 'hyperlink', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'permStart', 'permEnd']);
const properties = new Set(['pPr', 'rPr']);
const unsupported = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'txbxContent', 'fldSimple', 'instrText', 'fldChar', 'altChunk', 'drawing', 'pict', 'object', 'sdt', 'customXml']);

// No XML serialization: node indices refer to w:t elements in the original part,
// including unsupported nodes. Reparse the immutable part to recover those nodes.
export function indexDocx(source: Buffer) {
  const zip = new PizZip(source);
  const blocks: SourceBlock[] = [];
  const warnings = new Set<string>();
  for (const path of Object.keys(zip.files).filter((path) => editablePart.test(path)).sort()) {
    const part = zip.file(path);
    if (!part) continue;
    const xml = parseXml(part.asNodeBuffer());
    const texts = Array.from(xml.getElementsByTagNameNS(W, 't'));
    const nodeIds = new Map(texts.map((node, index) => [node, index]));
    for (const node of Array.from(xml.getElementsByTagName('*'))) {
      if (node.namespaceURI === W && unsupported.has(node.localName ?? '')) warnings.add(`${path}: ${node.localName} content requires manual review; it cannot be replaced safely.`);
    }
    if (xml.getElementsByTagNameNS(W, 'footnoteReference').length || xml.getElementsByTagNameNS(W, 'endnoteReference').length) warnings.add(`${path}: footnote/endnote text is not indexed.`);
    let fieldDepth = 0;
    for (const [paragraphIndex, paragraph] of Array.from(xml.getElementsByTagNameNS(W, 'p')).entries()) {
      if (blocks.length >= 20000) throw new DocxError('UPLOAD_TOO_LARGE', 'The DOCX exceeds the 20,000 paragraph indexing limit.');
      const issues = new Set<string>();
      const location: string[] = [];
      let ancestor = paragraph.parentNode;
      while (ancestor && ancestor !== xml) {
        const element = ancestor as Element;
        if (element.namespaceURI === W) {
          if (['tbl', 'tr', 'tc'].includes(element.localName ?? '')) {
            const peers = Array.from(ancestor.parentNode?.childNodes ?? []).filter((node) => (node as Element).localName === element.localName);
            location.unshift(`${element.localName}[${peers.indexOf(ancestor) + 1}]`);
          } else if (!['document', 'body', 'hdr', 'ftr'].includes(element.localName ?? '')) issues.add(`Inside unsupported ${element.localName} structure.`);
        } else issues.add('Inside an unsupported XML namespace.');
        ancestor = ancestor.parentNode;
      }
      if (fieldDepth > 0) issues.add('Inside a complex field.');
      let text = '';
      const spans: SourceBlock['spans'] = [];
      const visit = (node: Node) => {
        if (node.nodeType !== 1) return;
        const element = node as Element;
        const tag = element.localName ?? '';
        if (element !== paragraph && element.namespaceURI === W && tag === 'p') { issues.add('Nested paragraph content is indexed separately.'); return; }
        if (element.namespaceURI !== W) issues.add('Unsupported XML namespace.');
        if (element.namespaceURI === W && properties.has(tag)) {
          if (element.getElementsByTagNameNS(W, 'vanish').length || element.getElementsByTagNameNS(W, 'webHidden').length) issues.add('Hidden text formatting requires manual review.');
          return;
        }
        if (element.namespaceURI === W && tag === 'fldChar') {
          const kind = element.getAttributeNS(W, 'fldCharType');
          if (kind === 'begin') fieldDepth++;
          if (kind === 'end') fieldDepth = Math.max(0, fieldDepth - 1);
        }
        if (!safe.has(tag) || element.namespaceURI !== W) issues.add(`Unsupported ${tag} content; replacement is disabled.`);
        if (element.namespaceURI === W && tag === 't') {
          const value = element.textContent ?? '';
          spans.push({ start: text.length, end: text.length + value.length, textNodeIndex: nodeIds.get(element) ?? 0 });
          text += value;
          return;
        }
        if (element.namespaceURI === W && tag === 'tab') text += '\t';
        if (element.namespaceURI === W && ['br', 'cr'].includes(tag)) text += '\n';
        for (const child of Array.from(node.childNodes)) visit(child);
      };
      visit(paragraph);
      blocks.push({ id: `${path}::p-${String(paragraphIndex).padStart(6, '0')}`, partPath: path, paragraphIndex,
        section: path === 'word/document.xml' ? 'body' : path.includes('/header') ? 'header' : 'footer',
        location: [...location, `p[${paragraphIndex + 1}]`].join('/'), text, spans,
        supported: issues.size === 0, warnings: [...issues],
      });
    }
  }
  for (const path of ['word/footnotes.xml', 'word/endnotes.xml']) if (zip.file(path)) warnings.add(`${path}: note text is preserved but not indexed.`);
  const paths = Object.keys(zip.files);
  if (paths.some((path) => /^word\/(?:comments|people)/.test(path))) warnings.add('Comments and review metadata are preserved but are not available as template fields. Paragraphs containing comment markers require manual review.');
  if (paths.some((path) => path.startsWith('word/charts/'))) warnings.add('Charts are preserved; chart labels and data are not indexed or editable as template fields.');
  if (paths.some((path) => path.startsWith('word/diagrams/'))) warnings.add('SmartArt diagrams are preserved; diagram text is not indexed or editable as template fields.');
  if (paths.some((path) => path.startsWith('customXml/'))) warnings.add('Custom XML data is preserved but is not indexed or updated. Bound content controls require manual review.');
  return { blocks, warnings: [...warnings] };
}
