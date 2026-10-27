import path from 'node:path';
import { pathExists } from '../../core/fs.js';
import type { CheckContext } from '../../core/types.js';

export interface BuildOutput {
  app: string;
  /** Configured output path, relative to the project root. */
  outputPath: string;
  /** Absolute output directory (where stats files live). */
  outDir: string;
  /** Absolute directory with the browser assets (`<out>/browser` for the application builder). */
  browserDir: string;
}

/** The application to build/serve and where its output lives. Undefined if there is no app. */
export async function resolveBuildOutput(ctx: CheckContext): Promise<BuildOutput | undefined> {
  const option = (key: string) =>
    typeof ctx.options[key] === 'string' ? (ctx.options[key] as string) : undefined;
  const apps = ctx.project.projects.filter((p) => p.type === 'application');
  const app =
    option('project') ??
    apps.find((p) => p.name === ctx.project.defaultProject)?.name ??
    apps[0]?.name;
  if (!app) return undefined;
  const outputPath =
    option('outputPath') ??
    ctx.project.projects.find((p) => p.name === app)?.outputPath ??
    `dist/${app}`;
  const outDir = path.join(ctx.root, outputPath);
  const browserDir = (await pathExists(path.join(outDir, 'browser')))
    ? path.join(outDir, 'browser')
    : outDir;
  return { app, outputPath, outDir, browserDir };
}
