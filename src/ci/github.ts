import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditReport } from '../core/report.js';
import type { ReportedFinding } from '../core/types.js';

/** GitHub caps annotations per step; more would be dropped anyway. */
export const MAX_ANNOTATIONS = 50;

const LEVEL: Record<ReportedFinding['severity'], 'error' | 'warning' | undefined> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: undefined,
};

// https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
const escapeData = (s: string) =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * `::error file=…,line=…::message` workflow commands for critical/high (error) and medium
 * (warning) findings that point at a file. Paths are made relative to the repository root so
 * annotations land on the right lines when the project lives in a subdirectory.
 */
export function githubAnnotations(
  report: AuditReport,
  projectRoot: string,
  workspace: string,
): string[] {
  const prefix = path.relative(workspace, projectRoot);
  if (prefix.startsWith('..')) return []; // project outside the checkout: paths would be wrong
  return report.findings
    .flatMap((f) => {
      const level = LEVEL[f.severity];
      if (!level || !f.file) return [];
      const file = path.posix.join(prefix.split(path.sep).join('/'), f.file);
      const props = [
        `file=${escapeProperty(file)}`,
        ...(f.line ? [`line=${f.line}`] : []),
        `title=${escapeProperty(`fe-health: ${f.checkId}`)}`,
      ];
      return [`::${level} ${props.join(',')}::${escapeData(`${f.message} ${f.fixHint}`)}`];
    })
    .slice(0, MAX_ANNOTATIONS);
}

/** Appends the Markdown summary to the job summary page ($GITHUB_STEP_SUMMARY). */
export async function writeStepSummary(file: string, markdown: string): Promise<void> {
  await appendFile(file, `${markdown}\n`, 'utf8');
}
