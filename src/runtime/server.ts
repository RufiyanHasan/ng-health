import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createGzip } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest)|image\/svg)/;
const HASHED = /[-.][A-Z0-9]{8,}\.(js|mjs|css)$/i;

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Serves a built Angular app like a production host would: gzip for text assets, long-lived
 * caching for hashed files, and SPA fallback to the index for extension-less paths so deep
 * routes work. Binds to 127.0.0.1 only.
 */
export async function serveStatic(root: string, indexFile: string): Promise<StaticServer> {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    void (async () => {
      const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      let file = path.resolve(base, `.${urlPath}`);
      if (!file.startsWith(base)) {
        res.writeHead(403).end();
        return;
      }
      let info = await stat(file).catch(() => undefined);
      if (info?.isDirectory()) {
        file = path.join(file, 'index.html');
        info = await stat(file).catch(() => undefined);
      }
      if (!info && !path.extname(urlPath)) {
        file = path.join(base, indexFile);
        info = await stat(file).catch(() => undefined);
      }
      if (!info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const headers: http.OutgoingHttpHeaders = {
        'content-type': type,
        'cache-control': HASHED.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
      };
      const gzip =
        COMPRESSIBLE.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      if (gzip) headers['content-encoding'] = 'gzip';
      else headers['content-length'] = info.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(file);
      (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
