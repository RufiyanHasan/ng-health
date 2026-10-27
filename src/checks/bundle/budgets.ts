/** Angular CLI budget sizes use 1 kB = 1024 bytes. */
export const KB = 1024;

export interface Budget {
  type: string;
  name?: string;
  maximumWarning?: string;
  maximumError?: string;
}

/** The CLI's defaults for new projects, used when angular.json defines no initial budget. */
export const DEFAULT_BUDGETS: Budget[] = [
  { type: 'initial', maximumWarning: '500kb', maximumError: '1mb' },
];

/** Parses "500kb", "1mb", "2.5MB", "300b". Percentages (relative to a baseline) are unsupported. */
export function parseSize(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^\s*([\d.]+)\s*(b|kb|mb|gb)?\s*$/i.exec(value);
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'b').toLowerCase();
  const mult = unit === 'gb' ? KB ** 3 : unit === 'mb' ? KB ** 2 : unit === 'kb' ? KB : 1;
  return Math.round(n * mult);
}

export const formatKb = (bytes: number) => `${(bytes / KB).toFixed(1)} kB`;
