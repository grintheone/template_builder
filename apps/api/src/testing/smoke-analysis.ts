import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readConfig } from '../config.js';
import { OllamaFieldDetector } from '../services/ai/field-detector.js';
import { AnalysisFailure } from '../services/ai/errors.js';
import { indexDocx } from '../services/docx/indexer.js';
import { validatePackage } from '../services/docx/validate-package.js';
import { compilationCorpus } from './compilation-corpus.js';

// Explicit opt-in live smoke test; never part of pnpm test. Only synthetic data
// is sent, through the production detector's bounded loopback-only transport.
const config = readConfig();
const directory = resolve(config.STORAGE_DIR, `readiness-${randomUUID()}`);
await mkdir(directory, { recursive: true, mode: 0o700 });
const results = [];
for (const sample of compilationCorpus()) {
  const sourceHash = createHash('sha256').update(sample.source).digest('hex');
  await writeFile(resolve(directory, `${sample.name}.docx`), sample.source, { flag: 'wx', mode: 0o600 });
  await validatePackage(sample.source, config.MAX_UPLOAD_MB * 1024 * 1024, 'import');
  const { blocks } = indexDocx(sample.source);
  const started = Date.now();
  try {
    const result = await new OllamaFieldDetector(config).detect(blocks, AbortSignal.timeout(config.ANALYSIS_TIMEOUT_MS));
    // Synthetic suggestions are saved privately for local inspection, never logged.
    await writeFile(resolve(directory, `${sample.name}.analysis.json`), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    const occurrences = result.fields.flatMap((field) => field.occurrences);
    const invalidResolved = occurrences.filter((occurrence) => occurrence.status === 'resolved' && !blocks.some((block) =>
      block.id === occurrence.blockId && block.supported && block.text.slice(occurrence.start, occurrence.end) === occurrence.quote)).length;
    const sourceUnchanged = createHash('sha256').update(sample.source).digest('hex') === sourceHash;
    const expectedLocationsFound = sample.selections.filter((selection) => occurrences.some((occurrence) => occurrence.status === 'resolved'
      && occurrence.start === selection.start && occurrence.quote === selection.quote
      && blocks.some((block) => block.id === occurrence.blockId && block.section === selection.section && block.text === selection.text))).length;
    const status = invalidResolved === 0 && sourceUnchanged ? 'passed' : 'failed';
    const unresolvedReasons = Object.fromEntries([...new Set(occurrences.filter((item) => item.status === 'unresolved').map((item) => item.reason))]
      .map((reason) => [reason, occurrences.filter((item) => item.reason === reason).length]));
    results.push({ sample: sample.name, safetyStatus: status, detectionQuality: expectedLocationsFound === sample.selections.length ? 'expected_locations_found' : 'manual_review_needed',
      sourceHash, elapsedMs: Date.now() - started, fields: result.fields.length,
      resolved: occurrences.filter((occurrence) => occurrence.status === 'resolved').length,
      unresolved: occurrences.filter((occurrence) => occurrence.status === 'unresolved').length,
      invalidResolved, sourceUnchanged, unresolvedReasons, expectedLocations: sample.selections.length, expectedLocationsFound });
    if (status === 'failed') process.exitCode = 1;
  } catch (error) {
    results.push({ sample: sample.name, status: 'failed', sourceHash, elapsedMs: Date.now() - started,
      code: error instanceof AnalysisFailure ? error.code : 'SMOKE_FAILED' });
    process.exitCode = 1;
  }
  // Counts only: never log the model's free text, quotes, labels or field keys.
  console.log(JSON.stringify(results.at(-1)));
}
const report = { createdAt: new Date().toISOString(), model: config.OLLAMA_MODEL, timeoutMs: config.ANALYSIS_TIMEOUT_MS,
  scope: 'Synthetic DOCX packages through the live detector; no UI, durable-job or visual-layout verification. Passing means valid traceable output, not complete or semantically correct detection.', results };
await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`Saved synthetic samples and count-only report under ${directory}`);
