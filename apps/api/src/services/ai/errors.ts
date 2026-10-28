import type { AnalysisError as ErrorData } from '@studio/shared';

const messages: Record<ErrorData['code'], string> = {
  OLLAMA_OFFLINE: 'Cannot reach Ollama. Start the local Ollama service and check OLLAMA_BASE_URL.',
  MODEL_UNAVAILABLE: 'The configured model is unavailable. Install it with ollama pull using OLLAMA_MODEL.',
  INVALID_AI_OUTPUT: 'Ollama returned invalid or excessive suggestions. Try analysis again or choose another local model.',
  ANALYSIS_TIMEOUT: 'Analysis timed out. Retry with a smaller document or increase ANALYSIS_TIMEOUT_MS.',
  ANALYSIS_LIMIT: 'The document exceeds analysis limits. Use a smaller document or shorter source paragraphs.',
  SOURCE_UNAVAILABLE: 'The immutable source could not be verified. Re-import the document.',
  INTERRUPTED: 'Analysis was interrupted by a service restart or shutdown. Start a new analysis.',
  ANALYSIS_FAILED: 'Local analysis failed. Check the local service and retry.',
};
export class AnalysisFailure extends Error {
  constructor(readonly code: ErrorData['code']) { super(messages[code]); }
  toJSON(): ErrorData { return { code: this.code, message: this.message }; }
}
