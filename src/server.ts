import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllVersions, SITE_URL } from './fetch-all.js';
import { buildCalendar } from './calendar.js';
import { buildAtomFeed, buildNotificationsJson } from './changes.js';
import { parseConfig } from './checker.js';
import { renderHTML } from './render.js';

const PORT = Number(process.env.PORT) || 3000;

// Works from both src/ (tsx) and dist/ (compiled): public/ sits next to either directory
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const STATIC_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.js': 'text/javascript; charset=utf-8',
};

async function serveStatic(pathname: string, res: http.ServerResponse): Promise<boolean> {
  const allowed = pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname === '/og-image.png' || pathname === '/notifications.js' || /^\/icons\/[\w.-]+$/.test(pathname);
  if (!allowed) return false;
  try {
    const body = await readFile(path.join(PUBLIC_DIR, pathname));
    res.writeHead(200, {
      'Content-Type': STATIC_TYPES[path.extname(pathname)] ?? 'application/octet-stream',
      // The service worker must be revalidated on every load so updates roll out
      'Cache-Control': pathname === '/sw.js' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'GET' && await serveStatic(pathname, res)) {
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && (pathname === '/api' || pathname === '/api.json')) {
    try {
      const versions = await fetchAllVersions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(versions));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch versions' }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/calendar.ics') {
    try {
      const data = await fetchAllVersions();
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="os-version-tracker.ics"',
        'Cache-Control': 'public, max-age=600',
      });
      res.end(buildCalendar(data.timeline, SITE_URL));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to build calendar' }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/notifications.json') {
    try {
      const data = await fetchAllVersions();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(buildNotificationsJson(data.tracked, data.cachedAt));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to build notifications' }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/feed.xml') {
    try {
      const data = await fetchAllVersions();
      res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      res.end(buildAtomFeed(data.tracked, SITE_URL, data.cachedAt));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to build feed' }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    try {
      const data = await fetchAllVersions();
      const config = parseConfig(new URL(req.url ?? '/', 'http://localhost').searchParams);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHTML(data, config));
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>無法取得版本資料</h1>');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
