import { z } from 'zod';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

export const REPORT_FORMATS = ['console', 'html', 'json', 'md'] as const;
export const ReportFormatSchema = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof ReportFormatSchema>;

export const CONFIG_FILE_NAME = 'fe-health.config.json';

const score = z.number().min(0).max(100);

const CheckSettingsSchema = z.strictObject({
  enabled: z.boolean().optional(),
  /** Relative weight of this check within its category. */
  weight: z.number().min(0).optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** Check-specific options, validated by the check itself. */
  options: z.record(z.string(), z.unknown()).optional(),
});
export type CheckSettings = z.infer<typeof CheckSettingsSchema>;

const ThresholdsSchema = z.strictObject({
  minOverallScore: score.optional(),
  minCategoryScores: z.record(z.string(), score).optional(),
  maxInitialBundleKb: z.number().positive().optional(),
  maxCriticalVulnerabilities: z.number().int().min(0).optional(),
  maxCriticalA11yViolations: z.number().int().min(0).optional(),
  /** Fail if any finding at or above this severity exists. */
  failOnSeverity: SeveritySchema.optional(),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

export const DEFAULT_CATEGORY_WEIGHTS: Record<string, number> = {
  dependencies: 20,
  bundle: 15,
  angular: 20,
  hygiene: 15,
  performance: 15,
  accessibility: 15,
};

export const DEFAULT_SEVERITY_PENALTIES: Record<Severity, number> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
};

export const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.angular/**',
  '**/coverage/**',
];

export const ConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  /** Per-check settings keyed by check id ("angular/onpush") or category ("angular"). `false` disables. */
  checks: z.record(z.string(), z.union([z.boolean(), CheckSettingsSchema])).default({}),
  /** Run only these check ids or categories. */
  only: z.array(z.string()).optional(),
  /** Skip these check ids or categories. */
  skip: z.array(z.string()).default([]),
  /** Category weights for the overall score. Merged over the defaults. */
  weights: z.record(z.string(), z.number().min(0)).default({}),
  /** Score penalty per finding severity. Merged over the defaults. */
  severityPenalties: z.partialRecord(SeveritySchema, z.number().min(0)).default({}),
  thresholds: ThresholdsSchema.default({ minOverallScore: 70, maxCriticalVulnerabilities: 0 }),
  /** Globs (relative to the project root) excluded from source analysis. */
  ignore: z.array(z.string()).default(DEFAULT_IGNORE),
  /** Extra check plugins: module specifiers or paths relative to the config file. */
  plugins: z.array(z.string()).default([]),
  output: z
    .strictObject({
      dir: z.string().default('fe-health-report'),
      formats: z.array(ReportFormatSchema).min(1).default(['console', 'html']),
    })
    .prefault({}),
  /** Never touch the network (skips registry lookups such as npm outdated/audit). */
  offline: z.boolean().default(false),
});

export type ConfigInput = z.input<typeof ConfigSchema>;
export type Config = z.output<typeof ConfigSchema>;

export function configJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ConfigSchema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
}
