import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReportFormat } from '../core/config/schema.js';
import { FeHealthError, errorMessage } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import type { AuditReport } from '../core/report.js';
import { renderConsole } from './console.js';
import { renderHtml } from './html.js';
import { renderJson } from './json.js';
import { renderMarkdown } from './markdown.js';

export { renderConsole, renderHtml, renderJson, renderMarkdown };

export const REPORT_BASENAME = 'fe-health-report';

const FILE_RENDERERS: Partial<
  Record<ReportFormat, { ext: string; render: (r: AuditReport) => string }>
> = {
  html: { ext: 'html', render: renderHtml },
  json: { ext: 'json', render: renderJson },
  md: { ext: 'md', render: renderMarkdown },
};

/** Prints the console summary and writes file reports. Returns the written file paths. */
export async function writeReports(
  report: AuditReport,
  formats: ReportFormat[],
  outDir: string,
  logger: Logger,
): Promise<string[]> {
  if (formats.includes('console')) logger.out(renderConsole(report));
  const files = formats.flatMap((f) => {
    const r = FILE_RENDERERS[f];
    return r
      ? [{ file: path.join(outDir, `${REPORT_BASENAME}.${r.ext}`), content: r.render(report) }]
      : [];
  });
  if (!files.length) return [];
  try {
    await mkdir(outDir, { recursive: true });
    await Promise.all(files.map((f) => writeFile(f.file, f.content, 'utf8')));
  } catch (err) {
    throw new FeHealthError(`Could not write reports to ${outDir}: ${errorMessage(err)}`, {
      cause: err,
    });
  }
  return files.map((f) => f.file);
}
