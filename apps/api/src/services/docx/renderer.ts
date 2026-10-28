import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { fieldKeySchema, MAX_RENDER_FIELDS, renderValuesSchema } from '@studio/shared';
import { DocxError } from './errors.js';
import { editablePart, parseXml, validatePackage } from './validate-package.js';

type ParsedPart = { type: string; value: string; module?: string };

export class DocxRenderer {
  constructor(private readonly maxUploadBytes = 15 * 1024 * 1024) {}

  async render(source: Buffer, values: unknown): Promise<Buffer> {
    const parsedValues = renderValuesSchema.safeParse(values);
    if (!parsedValues.success) throw new DocxError('INVALID_VALUES', 'Values must be a JSON object with snake_case keys and text or finite numbers (at most 100 fields, 10,000 characters each).');
    const originalParts = await validatePackage(source, this.maxUploadBytes);
    const keys = new Set<string>();
    const changedParts = new Set<string>();
    const occurrences = new Map<string, string[]>();
    const collector = {
      name: 'ScalarFieldContract',
      set(options: { inspect?: { filePath: string; postparsed?: ParsedPart[] } }) {
        const inspected = options.inspect;
        if (!inspected?.postparsed) return;
        for (const part of inspected.postparsed) {
          if (part.type !== 'placeholder') continue;
          if (part.module || !fieldKeySchema.safeParse(part.value).success || !editablePart.test(inspected.filePath)) {
            throw new DocxError('INVALID_TEMPLATE', 'Only scalar [[snake_case]] placeholders in body, table, header, or footer text are supported. Loops, expressions, and raw XML are not supported.');
          }
          keys.add(part.value);
          changedParts.add(inspected.filePath);
          const fields = occurrences.get(inspected.filePath) ?? [];
          fields.push(part.value);
          occurrences.set(inspected.filePath, fields);
        }
      },
    };
    let doc: Docxtemplater<PizZip>;
    try {
      // PizZip and Docxtemplater receive a fresh archive; source bytes stay immutable.
      doc = new Docxtemplater(new PizZip(source, { checkCRC32: true }), {
        delimiters: { start: '[[', end: ']]' },
        errorLogging: false,
        linebreaks: true,
        paragraphLoop: false,
        syntax: { changeDelimiterPrefix: null },
        modules: [collector],
        parser(tag) {
          if (!fieldKeySchema.safeParse(tag).success) throw new Error('Unsupported placeholder');
          return { get: (scope: Record<string, string | number>) => Object.hasOwn(scope, tag) ? scope[tag] : undefined };
        },
        nullGetter: () => { throw new Error('Missing field'); },
      });
    } catch (error) {
      if (error instanceof DocxError) throw error;
      throw new DocxError('INVALID_TEMPLATE', 'The DOCX template could not be parsed. Check that every placeholder is a complete [[snake_case]] tag.');
    }
    if (keys.size > MAX_RENDER_FIELDS) throw new DocxError('INVALID_TEMPLATE', 'The template has more than 100 distinct fields.');
    const valuesKeys = Object.keys(parsedValues.data);
    if (valuesKeys.some((key) => !keys.has(key)) || [...keys].some((key) => !Object.hasOwn(parsedValues.data, key))) {
      throw new DocxError('FIELD_MISMATCH', 'Provide exactly one value for every template field. Missing and unknown keys are not allowed; use an empty string for an intentionally blank value.');
    }
    // Estimate pessimistically before rendering repeated values, so a small
    // tagged file cannot expand into an unbounded in-memory document.
    let totalEstimatedSize = [...originalParts.values()].reduce((sum, part) => sum + part.length, 0);
    for (const [path, fields] of occurrences) {
      const originalSize = originalParts.get(path)?.length ?? 0;
      let estimatedSize = originalSize;
      for (const field of fields) {
        const value = String(parsedValues.data[field]);
        estimatedSize += Buffer.byteLength(value, 'utf8') * 6;
        // Multiline rendering can repeat run properties. The entire part is a
        // conservative upper bound on the formatting markup per line break.
        estimatedSize += (value.match(/\n/g)?.length ?? 0) * originalSize * 2;
        if (estimatedSize > 10 * 1024 * 1024) throw new DocxError('UPLOAD_TOO_LARGE', 'The filled document would exceed the safe 10 MiB per-part rendering limit. Use shorter values or fewer repeated fields.');
      }
      totalEstimatedSize += estimatedSize - originalSize;
      if (totalEstimatedSize > 50 * 1024 * 1024) throw new DocxError('UPLOAD_TOO_LARGE', 'The filled document would exceed the safe 50 MiB package rendering limit.');
    }
    try {
      doc.render(parsedValues.data);
      // Commit rendered parts into a fresh original archive. Docxtemplater may touch
      // settings/relationships during rendering; preserve all non-target bytes.
      const result = new PizZip(source);
      for (const path of changedParts) {
        if (!originalParts.has(path)) throw new Error('Unexpected rendered part');
        const rendered = doc.getZip().file(path)?.asNodeBuffer();
        if (!rendered) throw new Error('Missing rendered part');
        parseXml(rendered);
        result.file(path, rendered);
      }
      return result.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    } catch {
      throw new DocxError('INVALID_TEMPLATE', 'The DOCX could not be rendered safely. Check the template structure and supplied values.');
    }
  }
}
