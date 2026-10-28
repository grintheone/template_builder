import type { RenderErrorCode } from '@studio/shared';

// Only fixed, non-sensitive messages cross the HTTP boundary.
export class DocxError extends Error {
  constructor(public readonly code: RenderErrorCode, message: string) {
    super(message);
    this.name = 'DocxError';
  }
}
