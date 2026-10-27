import { Command, CommanderError, Option } from 'commander';
import pc from 'picocolors';
import { audit } from '../core/audit.js';
import { REPORT_FORMATS } from '../core/config/schema.js';
import { ExitCode, FeHealthError } from '../core/errors.js';
import { createLogger, type Logger, type LoggerOptions } from '../core/logger.js';
import type { AuditCliFlags } from '../core/options.js';
import { VERSION } from '../version.js';
import { initCommand } from './commands/init.js';

export { VERSION } from '../version.js';

const collect = (value: string, previous: string[] = []) => [...previous, value];

export function buildProgram(
  logger: Logger,
  setExitCode: (code: number) => void,
  io: Pick<LoggerOptions, 'stdout' | 'stderr'> = {},
): Command {
  const program = new Command()
    .name('fe-health')
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
    .option('-c, --config <file>', `config file (default: <path>/fe-health.config.json)`)
    .option('--ci', 'CI mode: no spinner, Markdown summary, fail on thresholds')
    .option('--verbose', 'verbose diagnostic output')
    .action(async (projectPath: string, flags: AuditCliFlags) => {
      const outcome = await audit(projectPath, flags, logger);
      setExitCode(outcome.exitCode);
    });

  program
    .command('init')
    .description('write a fe-health.config.json with defaults')
    .argument('[path]', 'directory to write the config to', '.')
    .option('--force', 'overwrite an existing config')
    .action(async (dir: string, opts: { force?: boolean }) => {
      await initCommand(dir, opts, logger);
      setExitCode(ExitCode.Pass);
    });

  return program;
}

/** Runs the CLI and returns the process exit code. Never throws. */
export async function runCli(argv: string[], loggerOptions: LoggerOptions = {}): Promise<number> {
  const verbose = argv.includes('--verbose');
  const logger = createLogger({ ...loggerOptions, verbose });
  let exitCode: number = ExitCode.Pass;
  const program = buildProgram(logger, (code) => (exitCode = code), loggerOptions);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version exit 0; usage errors are tool errors.
      return err.exitCode === 0 ? ExitCode.Pass : ExitCode.ToolError;
    }
    if (err instanceof FeHealthError) {
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
