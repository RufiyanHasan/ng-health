import { afterEach, describe, expect, it } from 'vitest';
import { serveStatic, type StaticServer } from '../../src/runtime/server.js';
import { makeTempProject } from '../helpers/tmp.js';

let server: StaticServer | undefined;
afterEach(async () => server?.close());

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${server!.url}${path}`, { headers });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

describe('serveStatic', () => {
  it('serves files, SPA fallback, gzip and cache headers', async () => {
    const dir = await makeTempProject({
      'index.html': '<h1>app</h1>',
      'main-ABCDEFGH.js': 'console.log(1)',
      'assets/logo.png': 'png',
    });
    server = await serveStatic(dir, 'index.html');

    const main = await get('/main-ABCDEFGH.js', { 'accept-encoding': 'gzip' });
    expect(main.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(main.headers.get('content-encoding')).toBe('gzip');
    expect(main.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const deep = await get('/users/42');
    expect(deep.status).toBe(200);
    expect(deep.body.toString()).toBe('<h1>app</h1>');
    expect(deep.headers.get('cache-control')).toBe('no-cache');

    expect((await get('/missing.js')).status).toBe(404);
    expect((await get('/assets/logo.png')).headers.get('content-type')).toBe('image/png');
    expect((await get('/')).body.toString()).toBe('<h1>app</h1>');
    // fetch decompresses transparently
    expect(main.body.toString()).toBe('console.log(1)');
  });

  it('does not serve files outside the root', async () => {
    const dir = await makeTempProject({ 'index.html': 'x' });
    server = await serveStatic(dir, 'index.html');
    const res = await get('/..%2f..%2fetc%2fpasswd');
    expect([403, 404]).toContain(res.status);
  });
});
