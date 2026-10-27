import { z } from 'zod';
import { SeveritySchema } from './config/schema.js';
import type { AuditReport } from './report.js';

/**
 * JSON report schema (v1). Published as schema/report.v1.json. Within 1.x, fields are only
 * added, never removed or retyped; consumers should ignore unknown fields.
 */
const FindingSchema = z.object({
  severity: SeveritySchema,
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  fixHint: z.string(),
  docsUrl: z.string().optional(),
  ruleId: z.string().optional(),
  checkId: z.string(),
  category: z.string(),
  fingerprint: z.string(),
});

const CategorySchema = z.object({
  id: z.string(),
  score: z.number().min(0).max(100).optional(),
  weight: z.number(),
  checks: z.array(z.string()),
});

const ThresholdSchema = z.object({
  id: z.string(),
  description: z.string(),
  passed: z.boolean(),
  actual: z.union([z.number(), z.string()]).optional(),
  expected: z.union([z.number(), z.string()]),
});

const TopFixSchema = z.object({
  rank: z.number().int().positive(),
  checkId: z.string(),
  checkName: z.string(),
  category: z.string(),
  ruleId: z.string().optional(),
  severity: SeveritySchema,
  count: z.number().int().positive(),
  impact: z.number(),
  message: z.string(),
  fixHint: z.string(),
  docsUrl: z.string().optional(),
  files: z.array(z.string()),
});

const ScoreDelta = z.object({
  before: z.number().optional(),
  after: z.number().optional(),
  delta: z.number().optional(),
});

const severityCounts = {
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
};

export const ReportSchema = z.object({
  schemaVersion: z.string().regex(/^1\.\d+$/),
  tool: z.object({ name: z.string(), version: z.string() }),
  generatedAt: z.iso.datetime(),
  durationMs: z.number(),
  project: z.object({
    name: z.string(),
    angularVersion: z.string().optional(),
    angularMajor: z.number().optional(),
    packageManager: z.string(),
    kind: z.enum(['single-app', 'workspace']),
    ssr: z.boolean(),
    nx: z.boolean(),
    projects: z.array(z.object({ name: z.string(), type: z.string() })),
  }),
  score: z.object({
    overall: z.number().min(0).max(100).optional(),
    grade: z.enum(['A', 'B', 'C', 'D', 'F']).optional(),
  }),
  categories: z.array(CategorySchema),
  checks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      status: z.enum(['completed', 'errored', 'skipped']),
      score: z.number().min(0).max(100).optional(),
      weight: z.number(),
      durationMs: z.number(),
      reason: z.string().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
      findingCount: z.number().int(),
    }),
  ),
  findings: z.array(FindingSchema),
  summary: z.object({
    findings: z.object({ ...severityCounts, total: z.number() }),
    checks: z.object({ completed: z.number(), errored: z.number(), skipped: z.number() }),
  }),
  topFixes: z.array(TopFixSchema),
  thresholds: z.array(ThresholdSchema),
  passed: z.boolean(),
  trend: z
    .object({
      baselineGeneratedAt: z.string(),
      baselineVersion: z.string(),
      overall: ScoreDelta,
      categories: z.array(ScoreDelta.extend({ id: z.string() })),
      newFindings: z.array(FindingSchema),
      resolvedFindings: z.array(FindingSchema),
    })
    .optional(),
});

// Compile-time guard: every AuditReport ng-health produces must satisfy the published schema.
const _inSync = (report: AuditReport): z.input<typeof ReportSchema> => report;
void _inSync;

export function reportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ReportSchema, { io: 'input' }) as Record<string, unknown>;
}
