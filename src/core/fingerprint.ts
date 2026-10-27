import { createHash } from 'node:crypto';
import type { Finding } from './types.js';

/**
 * Identifies "the same problem" across runs. Line numbers and digits are excluded so that
 * unrelated edits (code moving, a component growing from 512 to 530 lines) don't make a
 * finding look new.
 */
export function fingerprint(checkId: string, f: Finding): string {
  const message = f.message.replace(/\d+(\.\d+)?/g, '#').trim();
  return createHash('sha256')
    .update([checkId, f.ruleId ?? '', f.file ?? '', message].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
}
