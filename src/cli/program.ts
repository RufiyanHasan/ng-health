import { Command, CommanderError, Option } from 'commander';
import pc from 'picocolors';
import { REPORT_FORMATS } from '../core/config/schema.js';
import { ExitCode, NgHealthError } from '../core/errors.js';
import { createLogger, type Logger, type LoggerOptions } from '../core/logger.js';
import { VERSION } from '../version.js';
import { auditCommand } from './commands/audit.js';
import { initCommand } from './commands/init.js';
import type { AuditCliFlags } from './flags.js';

export { VERSION } from '../version.js';

const collect = (value: string, previous: string[] = []) => [...previous, value];

export function buildProgram(
  logger: Logger,
  setExitCode: (code: number) => void,
  io: Pick<LoggerOptions, 'stdout' | 'stderr'> = {},
  signal?: AbortSignal,
): Command {
  const program = new Command()
    .name('ng-health')
    .description('Audit Angular codebases and produce a scored, actionable health report.')
    .version(VERSION, '-v, --version', 'print the version')
    .showHelpAfterError('(run with --help for usage)')
    .exitOverride()
    // Must be set before subcommands are added: commander copies it to them on creation.
    .configureOutput({
      writeOut: (str) => void (io.stdout ?? process.stdout).write(str),
      writeErr: (str) => void (io.stderr ?? process.stderr).write(str),
    });

  program
    .command('audit')
    .description('audit an Angular project')
    .argument('[path]', 'project directory', '.')
    .addOption(
      new Option(
        '-f, --format <formats>',
        `report formats (${REPORT_FORMATS.join('|')}); repeatable or comma-separated`,
      ).argParser(collect),
    )
    .option('-o, --out <dir>', 'output directory for reports')
    .option('--only <checks>', 'run only these check ids/categories (comma-separated)', collect)
    .option('--skip <checks>', 'skip these check ids/categories (comma-separated)', collect)
    .option(
      '-c, --config <file>',
      'config file: .ts, .mts, .js, .mjs, .cjs or .json (default: <path>/ng-health.config.*)',
    )
    .option('--ci', 'CI mode: no spinner, Markdown summary, fail on thresholds')
    .option('--url <url>', 'audit a running app (runtime checks) instead of serving the build')
    .option('--routes <routes>', 'routes for runtime checks, comma-separated (default: /)', collect)
    .option('--login-script <file>', 'module that logs in before runtime checks (see docs)')
    .option(
      '--baseline <file>',
      'previous JSON report: show score deltas and new/resolved findings',
    )
    .option('--no-build', 'reuse the existing build output instead of running a production build')
    .option('--offline', 'never touch the network (skips registry lookups)')
    .option('--verbose', 'verbose diagnostic output')
    .action(async (projectPath: string, flags: AuditCliFlags) => {
      const outcome = await auditCommand(projectPath, flags, logger, signal ? { signal } : {});
      setExitCode(outcome.exitCode);
    });

  program
    .command('init')
    .description('write a ng-health.config.json with defaults')
    .argument('[path]', 'directory to write the config to', '.')
    .option('--force', 'overwrite an existing config')
    .action(async (dir: string, opts: { force?: boolean }) => {
      await initCommand(dir, opts, logger);
      setExitCode(ExitCode.Pass);
    });

  return program;
}

/**
 * Runs the CLI and returns the process exit code. Never throws and never exits the process;
 * `signal` cancels a running audit (the entry point wires it to SIGINT/SIGTERM).
 */
export async function runCli(
  argv: string[],
  loggerOptions: LoggerOptions = {},
  signal?: AbortSignal,
): Promise<number> {
  const verbose = argv.includes('--verbose');
  const logger = createLogger({ ...loggerOptions, verbose });
  let exitCode: number = ExitCode.Pass;
  const program = buildProgram(logger, (code) => (exitCode = code), loggerOptions, signal);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (err) {
    if (signal?.aborted) return ExitCode.ToolError; // the entry point maps this to 130/143
    if (err instanceof CommanderError) {
      // --help / --version exit 0; usage errors are tool errors.
      return err.exitCode === 0 ? ExitCode.Pass : ExitCode.ToolError;
    }
    if (err instanceof NgHealthError) {
      logger.error(err.message);
      if (err.hint) logger.info(pc.dim(err.hint));
      if (verbose && err.cause) logger.debug(String((err.cause as Error).stack ?? err.cause));
      return ExitCode.ToolError;
    }
    logger.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    if (verbose && err instanceof Error) logger.debug(err.stack ?? '');
    else logger.info(pc.dim('Re-run with --verbose for details.'));
    return ExitCode.ToolError;
  }
}
