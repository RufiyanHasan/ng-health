import type { CheckContext } from '../core/types.js';

export const num = (ctx: CheckContext, key: string, fallback: number): number => {
  const v = ctx.options[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

export const bool = (ctx: CheckContext, key: string, fallback: boolean): boolean => {
  const v = ctx.options[key];
  return typeof v === 'boolean' ? v : fallback;
};

export const strings = (ctx: CheckContext, key: string, fallback: string[]): string[] => {
  const v = ctx.options[key];
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : fallback;
};

export const plural = (n: number, word: string, pluralWord = `${word}s`) =>
  `${n} ${n === 1 ? word : pluralWord}`;

/** Share of compliant items as a 0–100 score; 100 when there is nothing to assess. */
export const ratioScore = (bad: number, total: number): number =>
  total === 0 ? 100 : Math.round(((total - bad) / total) * 100);

export const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Lists at most `max` items, then "and N more". */
export function listSome(items: string[], max = 5): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

/** Parses JSON from command output, tolerating leading noise (npm warnings). */
export function parseJsonOutput<T>(stdout: string): T | undefined {
  const start = stdout.search(/[[{]/);
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    return undefined;
  }
}
