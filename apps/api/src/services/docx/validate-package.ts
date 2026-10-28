import { DOMParser } from '@xmldom/xmldom';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { DocxError } from './errors.js';

const MAX_ENTRIES = 1000;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_PART_BYTES = 10 * 1024 * 1024;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const editablePart = /^word\/(?:document|header\d+|footer\d+)\.xml$/;

// Deliberately conservative POC allowlist. Embedded objects, macros, signatures,
// charts and custom XML need explicit support in subsequent milestones.
function allowedPart(path: string): boolean {
  return path === '[Content_Types].xml' || path === '_rels/.rels'
    || /^docProps\/(?:core|app|custom)\.xml$/.test(path)
    || /^docProps\/thumbnail\.(?:jpeg|jpg|png|emf|wmf)$/.test(path)
    || /^word\/(?:document|styles|stylesWithEffects|settings|webSettings|fontTable|numbering|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(path)
    || /^word\/_rels\/(?:document|header\d+|footer\d+|footnotes|endnotes|fontTable)\.xml\.rels$/.test(path)
    || /^word\/theme\/theme\d+\.xml$/.test(path)
    || /^word\/media\/[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|gif|bmp|tif|tiff|emf|wmf|svg)$/.test(path)
    || /^word\/fonts\/[A-Za-z0-9_.-]+\.(?:odttf|ttf)$/.test(path);
}

function invalid(): never {
  throw new DocxError('INVALID_DOCX', 'The file is not a valid, unencrypted DOCX package.');
}
function unsupported(): never {
  throw new DocxError('UNSUPPORTED_DOCX', 'This DOCX contains parts or structures outside the supported package allowlist. Use a standard DOCX with body, table, header, and footer text.');
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) reject(error); else resolve(zip);
    });
  });
}

// Validate advertised sizes before inflation and actual sizes while streaming.
// This does not extract files or use any archive path on the filesystem.
async function readEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
  const zip = await openZip(buffer);
  return new Promise((resolve, reject) => {
    const parts = new Map<string, Buffer>();
    let total = 0;
    let count = 0;
    let stopped = false;
    const fail = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('end', () => { if (!stopped) { stopped = true; zip.close(); resolve(parts); } });
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        const name = entry.fileName;
        if (++count > MAX_ENTRIES || entry.uncompressedSize > MAX_PART_BYTES || total + entry.uncompressedSize > MAX_EXPANDED_BYTES) {
          throw new DocxError('UPLOAD_TOO_LARGE', 'The DOCX expands beyond the safe package limits (1,000 entries, 10 MiB per part, 50 MiB total).');
        }
        if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) invalid();
        if (name.includes('\\') || name.startsWith('/') || name.split('/').some((segment) => segment === '..' || segment === '.') || name.includes('\0') || parts.has(name)) invalid();
        // ZIP directory entries contain no document content.
        if (name.endsWith('/')) { if (entry.uncompressedSize !== 0) invalid(); zip.readEntry(); return; }
        if (!allowedPart(name)) unsupported();
        const stream = await new Promise<import('node:stream').Readable>((resolveStream, rejectStream) => {
          zip.openReadStream(entry, (error, result) => { if (error) rejectStream(error); else resolveStream(result); });
        });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          total += chunk.length;
          if (size > MAX_PART_BYTES || total > MAX_EXPANDED_BYTES) {
            stream.destroy();
            throw new DocxError('UPLOAD_TOO_LARGE', 'The DOCX expands beyond the safe package limits.');
          }
          chunks.push(chunk);
        }
        if (size !== entry.uncompressedSize) invalid();
        parts.set(name, Buffer.concat(chunks));
        if (!stopped) zip.readEntry();
      })().catch(fail);
    });
    if (zip.entryCount > MAX_ENTRIES) fail(new DocxError('UPLOAD_TOO_LARGE', 'The DOCX has too many ZIP entries.'));
    else zip.readEntry();
  });
}

export function parseXml(buffer: Buffer) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) unsupported();
  return new DOMParser({ onError: () => { throw new Error('Invalid XML'); } }).parseFromString(text, 'application/xml');
}

export async function validatePackage(source: Buffer, maxUploadBytes: number, mode: 'render' | 'import' = 'render'): Promise<Map<string, Buffer>> {
  if (source.length > maxUploadBytes) throw new DocxError('UPLOAD_TOO_LARGE', 'The DOCX exceeds the configured upload size limit.');
  if (source.length < 4 || source.readUInt32LE(0) !== 0x04034b50) invalid();
  try {
    const parts = await readEntries(source);
    if (!parts.has('[Content_Types].xml') || !parts.has('_rels/.rels') || !parts.has('word/document.xml')) invalid();
    for (const [path, content] of parts) {
      if (!/\.(?:xml|rels)$/.test(path)) continue;
      const document = parseXml(content);
      if (path === '[Content_Types].xml') {
        if (document.documentElement?.namespaceURI !== CONTENT_NS) invalid();
        const overrides = Array.from(document.getElementsByTagNameNS(CONTENT_NS, 'Override'));
        if (!overrides.some((node) => node.getAttribute('PartName') === '/word/document.xml' && node.getAttribute('ContentType') === MAIN_TYPE)) invalid();
        if (overrides.some((node) => /macroEnabled|vbaProject|activeX/i.test(node.getAttribute('ContentType') ?? ''))) unsupported();
      }
      if (editablePart.test(path)) {
        if (document.documentElement?.namespaceURI !== WORD_NS) unsupported();
        const expectedRoot = path === 'word/document.xml' ? 'document' : path.includes('/header') ? 'hdr' : 'ftr';
        if (document.documentElement?.localName !== expectedRoot) invalid();
        if (expectedRoot === 'document' && document.getElementsByTagNameNS(WORD_NS, 'body').length !== 1) invalid();
        // Rendering fields inside tracked edits, text boxes or field codes is out of scope.
        for (const tag of ['ins', 'del', 'moveFrom', 'moveTo', 'txbxContent', 'fldSimple', 'instrText', 'altChunk']) {
          if (mode === 'render' && document.getElementsByTagNameNS(WORD_NS, tag).length) unsupported();
        }
      } else if (path.endsWith('.xml') && path !== '[Content_Types].xml') {
        // Never silently leave tags in notes, metadata or other unrendered parts.
        const visible = Array.from(document.getElementsByTagNameNS(WORD_NS, 't')).map((node) => node.textContent).join('');
        if (mode === 'render' && (visible.includes('[[') || visible.includes(']]'))) unsupported();
      }
      if (path.endsWith('.rels')) {
        const relationships = Array.from(document.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship'));
        for (const relation of relationships) {
          const type = relation.getAttribute('Type') ?? '';
          if (/attachedTemplate|oleObject|aFChunk|vbaProject/i.test(type)) unsupported();
          if (relation.getAttribute('TargetMode') === 'External' && !type.endsWith('/hyperlink')) unsupported();
        }
      }
    }
    return parts;
  } catch (error) {
    if (error instanceof DocxError) throw error;
    invalid();
  }
}
