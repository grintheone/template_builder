import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Ollama } from 'ollama';
import type { HealthResponse } from '@studio/shared';
import type { AppConfig } from '../config.js';

const execFileAsync = promisify(execFile);
const timeoutMs = 2000;

export async function checkOllama(config: AppConfig): Promise<HealthResponse['ollama']> {
  const base = { endpoint: config.OLLAMA_BASE_URL, model: config.OLLAMA_MODEL };
  const client = new Ollama({ host: config.OLLAMA_BASE_URL, fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }) });
  try {
    const { models } = await client.list();
    const name = config.OLLAMA_MODEL.includes(':') ? config.OLLAMA_MODEL : `${config.OLLAMA_MODEL}:latest`;
    const modelAvailable = models.some((model) => model.name === name || model.model === name);
    return { ...base, available: true, modelAvailable, message: modelAvailable ? 'Ollama and the configured model are ready.' : `Ollama is running. Install the configured model with ollama pull ${config.OLLAMA_MODEL}.` };
  } catch {
    return { ...base, available: false, modelAvailable: false, message: 'Ollama is unavailable. Start the local Ollama service and check OLLAMA_BASE_URL.' };
  }
}

export async function checkLibreOffice(config: AppConfig): Promise<HealthResponse['libreOffice']> {
  const base = { binary: config.SOFFICE_PATH };
  try {
    const { stdout } = await execFileAsync(config.SOFFICE_PATH, ['--version'], { timeout: timeoutMs, maxBuffer: 64 * 1024, shell: false });
    if (!/LibreOffice/i.test(stdout)) throw new Error('Unexpected executable');
    return { ...base, available: true, message: 'LibreOffice is ready.' };
  } catch {
    return { ...base, available: false, message: 'LibreOffice is unavailable. Install it and set SOFFICE_PATH to its executable.' };
  }
}

export async function checkReadiness(config: AppConfig): Promise<HealthResponse> {
  const [ollama, libreOffice] = await Promise.all([checkOllama(config), checkLibreOffice(config)]);
  return { api: { available: true, message: 'The local API is ready.' }, ollama, libreOffice };
}
