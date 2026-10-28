import type { z } from 'zod';
import type { reviewErrorSchema } from '@studio/shared';
type ReviewError = z.infer<typeof reviewErrorSchema>;
export class ReviewFailure extends Error {
  constructor(readonly code: ReviewError['code'], readonly status: number, message: string, readonly issues: ReviewError['issues'] = []) { super(message); }
  toJSON(): ReviewError { return { code: this.code, message: this.message, issues: this.issues }; }
}
