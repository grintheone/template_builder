import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExportFailure } from '../templates/export-error.js';
import { cleanupExpiredExports } from '../../storage/temporary.js';

const execute = promisify(execFile);
export class PdfConverter {
  private busy = false;
  constructor(private binary: string, private tempRoot: string, private timeout = 60000) {}
  async convert(docx: Buffer): Promise<Buffer> {
    if (this.busy) throw new ExportFailure('PDF_BUSY', 503, 'Another PDF is being converted. Try again shortly.');
    this.busy = true;
    let directory: string | undefined;
    try {
      await mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
      await cleanupExpiredExports(this.tempRoot);
      directory = await mkdtemp(resolve(this.tempRoot, 'export-'));
      const input = resolve(directory, 'document.docx');
      await writeFile(input, docx, { mode: 0o600 });
      try {
        await execute(this.binary, [`-env:UserInstallation=${pathToFileURL(resolve(directory, 'profile')).href}`, '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', directory, input], { shell: false, timeout: this.timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ExportFailure('PDF_UNAVAILABLE', 503, 'PDF export is unavailable. Install LibreOffice and check SOFFICE_PATH; DOCX export is still available.');
        throw error;
      }
      const output = resolve(directory, 'document.pdf');
      if ((await stat(output)).size > 50 * 1024 * 1024) throw new Error('Output too large');
      const pdf = await readFile(output);
      if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF');
      return pdf;
    } catch (error) {
      if (error instanceof ExportFailure) throw error;
      throw new ExportFailure('PDF_FAILED', 422, 'LibreOffice could not convert the document within the export limits. Check the document or download DOCX.');
    } finally {
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally { this.busy = false; }
    }
  }
}
