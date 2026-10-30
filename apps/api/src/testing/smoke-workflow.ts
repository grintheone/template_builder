import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { analysisJobSchema, documentBlocksSchema, publishedVersionSchema, type AnalysisJob } from '@studio/shared';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { checkReadiness } from '../services/readiness.js';
import { indexDocx } from '../services/docx/indexer.js';
import { createStarterFixture, starterFields } from './starter-fixture.js';

// Opt-in synthetic live verification. The fixed review below represents explicit
// demo choices; it must never be used to auto-approve a user's AI suggestions.
const base = readConfig();
const readiness = await checkReadiness(base);
if (!readiness.ollama.modelAvailable || !readiness.libreOffice.available) {
  console.error(JSON.stringify({ code: 'LOCAL_DEPENDENCY_UNAVAILABLE', ollama: readiness.ollama.message, libreOffice: readiness.libreOffice.message }));
  process.exitCode = 1;
} else {
  await mkdir(base.STORAGE_DIR, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(resolve(base.STORAGE_DIR, 'workflow-smoke-'));
  const config = { ...base, DATABASE_PATH: resolve(directory, 'app.sqlite'), STORAGE_DIR: resolve(directory, 'files') };
  let app = buildApp(config);
  try {
    const source = createStarterFixture();
    await writeFile(resolve(directory, 'starter-agreement.docx'), source, { mode: 0o600 });
    const upload = await app.inject({ method: 'POST', url: '/api/documents', headers: { 'content-type': 'multipart/form-data; boundary=live' }, payload: Buffer.concat([
      Buffer.from('--live\r\nContent-Disposition: form-data; name="document"; filename="agreement.docx"\r\n\r\n'), source, Buffer.from('\r\n--live--\r\n'),
    ]) });
    assert.equal(upload.statusCode, 201);
    const { documentId, sourceHash } = upload.json();
    const url = `/api/documents/${documentId}`;
    const indexed = documentBlocksSchema.parse((await app.inject(`${url}/blocks`)).json());
    const started = await app.inject({ method: 'POST', url: `${url}/analyze` });
    assert.equal(started.statusCode, 202);
    const jobId = started.json().jobId;
    const deadline = Date.now() + config.ANALYSIS_TIMEOUT_MS + 5000;
    let job: AnalysisJob | undefined;
    while (Date.now() < deadline) {
      job = analysisJobSchema.parse((await app.inject(`/api/analysis-jobs/${jobId}`)).json());
      if (job.status === 'done' || job.status === 'failed') break;
      await delay(300);
    }
    assert.equal(job?.status, 'done');
    const fields = starterFields.map((f) => ({ id: randomUUID(), key: f.key, label: f.label, type: f.type, required: true, formatting: f.formatting,
      occurrences: indexed.blocks.filter((b) => b.supported && b.text.includes(f.quote) && !b.text.includes('unrelated reference')).map((b) => ({ id: randomUUID(), blockId: b.id, quote: f.quote, start: b.text.indexOf(f.quote), end: b.text.indexOf(f.quote) + f.quote.length })),
    }));
    // Reject the model's candidates and explicitly enter our known scalar ranges,
    // exercising the manual correction path even when the model returns paragraphs.
    const decisions = job?.result?.fields.flatMap((f) => f.occurrences.map((o) => ({ occurrenceId: o.id, status: 'rejected' }))) ?? [];
    assert.equal((await app.inject({ method: 'PUT', url: `${url}/fields`, payload: { sourceHash, expectedRevision: 0, analysisJobId: jobId, fields, decisions } })).statusCode, 200);
    const publication = await app.inject({ method: 'POST', url: `${url}/publish`, payload: { sourceHash, reviewRevision: 1 } });
    assert.equal(publication.statusCode, 200);
    const published = publishedVersionSchema.parse(publication.json());
    await app.close();
    let detectorCalls = 0;
    app = buildApp(config, undefined, { detect: async () => { detectorCalls++; throw new Error('Offline'); } });
    const values = { employer: 'Example & Co', employee_name: 'Иван Петров', agreement_date: '2026-11-01', start_date: '2026-12-01', salary: 6500.5, hours: 32 };
    for (const format of ['docx', 'pdf']) {
      const output = await app.inject({ method: 'POST', url: `/api/templates/${published.templateId}/render`, payload: { versionId: published.versionId, format, values } });
      assert.equal(output.statusCode, 200);
      if (format === 'pdf') assert.equal(output.rawPayload.subarray(0, 5).toString(), '%PDF-');
      else {
        const text = indexDocx(output.rawPayload).blocks.map((b) => b.text).join('\n');
        assert.ok(text.includes('Иван Петров will commence employment on 2026-12-01.'));
        assert.ok(text.includes('John Smith is also the author of an unrelated reference'));
        assert.ok(!text.includes('[['));
      }
      await writeFile(resolve(directory, `filled.${format}`), output.rawPayload, { mode: 0o600 });
    }
    assert.equal(detectorCalls, 0);
    const retained = await readFile(resolve(config.STORAGE_DIR, 'originals', `${documentId}.docx`));
    assert.ok(retained.equals(source));
    assert.equal(createHash('sha256').update(retained).digest('hex'), sourceHash);
    const report = { status: 'passed', model: config.OLLAMA_MODEL, aiFields: job?.result?.fields.length, reviewedFields: fields.length, docx: true, pdf: true, sourceUnchanged: true, offlineDetectorCalls: detectorCalls,
      scope: 'Live local services through API injection with explicit synthetic manual review; visual layout and browser interaction require inspection.' };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report));
    console.log(`Synthetic artifacts saved under ${directory}`);
  } catch {
    console.error('Live workflow verification failed. Check local service readiness and retry; no source text or filled values are logged.');
    process.exitCode = 1;
  } finally { await app.close(); }
}
