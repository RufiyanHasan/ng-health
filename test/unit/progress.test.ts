import { describe, expect, it } from 'vitest';
import { createProgress } from '../../src/core/progress.js';
import { createLogger } from '../../src/core/logger.js';
import { findChrome, chromeFlags } from '../../src/runtime/chrome.js';
import { errorMessage } from '../../src/core/errors.js';

function fakeTty() {
  let text = '';
  return {
    stream: {
      isTTY: true,
      columns: 80,
      write: (s: string) => ((text += s), true),
      on: () => undefined,
      removeListener: () => undefined,
      cursorTo: () => true,
      clearLine: () => true,
      moveCursor: () => true,
    } as unknown as NodeJS.WriteStream,
    read: () => text,
  };
}

describe('progress', () => {
  it('is a no-op when disabled or not a TTY', () => {
    const p = createProgress(false);
    expect(p.active).toBe(false);
    expect(() => (p.start('x'), p.update('y'), p.succeed(), p.fail(), p.stop())).not.toThrow();
    expect(createProgress(true, { isTTY: false } as NodeJS.WriteStream).active).toBe(false);
  });

  it('drives a spinner on a TTY', () => {
    const tty = fakeTty();
    const p = createProgress(true, tty.stream);
    expect(p.active).toBe(true);
    p.start('Working');
    p.update('Still working');
    p.succeed('Done');
    p.start('Again');
    p.fail('Broken');
    p.stop();
    expect(tty.read()).toContain('Done');
    expect(tty.read()).toContain('Broken');
  });
});

describe('logger and errors', () => {
  it('routes output to stdout and diagnostics to stderr', () => {
    const out: string[] = [];
    const err: string[] = [];
    const w = (arr: string[]) =>
      ({ write: (s: string) => (arr.push(s), true) }) as unknown as NodeJS.WritableStream;
    const logger = createLogger({ stdout: w(out), stderr: w(err), verbose: false });
    logger.out('report');
    logger.info('i');
    logger.success('s');
    logger.warn('w');
    logger.error('e');
    logger.debug('hidden');
    expect(out).toEqual(['report\n']);
    expect(err).toHaveLength(4);
    expect(errorMessage('plain')).toBe('plain');
  });
});

describe('chrome discovery', () => {
  it('honours explicit paths and CHROME_PATH', async () => {
    expect(await findChrome('/does/not/exist')).toBeUndefined();
    expect(await findChrome(process.execPath)).toBe(process.execPath);
    const prev = process.env['CHROME_PATH'];
    process.env['CHROME_PATH'] = process.execPath;
    try {
      expect(await findChrome()).toBe(process.execPath);
    } finally {
      if (prev === undefined) delete process.env['CHROME_PATH'];
      else process.env['CHROME_PATH'] = prev;
    }
    const auto = await findChrome();
    expect(auto === undefined || typeof auto === 'string').toBe(true);
    expect(chromeFlags()).toContain('--headless=new');
  });
});
