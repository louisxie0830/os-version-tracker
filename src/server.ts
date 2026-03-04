import http from 'node:http';
import { fetchAllVersions } from './fetch-all.js';
import type { OSVersionInfo } from './types.js';

const PORT = Number(process.env.PORT) || 3000;

function renderVersionRow(v: OSVersionInfo): string {
  const badge = v.isBeta
    ? '<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">Beta</span>'
    : '<span style="background:#22c55e;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">Stable</span>';
  const build = v.build ? `<code>${v.build}</code>` : '';
  const api = v.apiLevel ? `API ${v.apiLevel}` : '';
  const codename = v.codename ?? '';
  return `<tr>
    <td>${badge}</td>
    <td><strong>${v.version}</strong></td>
    <td>${build}</td>
    <td>${api}</td>
    <td>${codename}</td>
    <td>${v.releaseDate}</td>
  </tr>`;
}

function renderHTML(ios: OSVersionInfo[], android: OSVersionInfo[], cachedAt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OS Version Tracker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 2rem; }
    h1 { font-size: 1.8rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.3rem; margin: 1.5rem 0 0.75rem; color: #475569; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1rem; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; font-size: 13px; text-transform: uppercase; color: #64748b; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .timestamp { margin-top: 1.5rem; font-size: 13px; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>OS Version Tracker</h1>

  <h2>iOS</h2>
  <table>
    <thead><tr><th>Channel</th><th>Version</th><th>Build</th><th>API</th><th>Codename</th><th>Release Date</th></tr></thead>
    <tbody>${ios.length ? ios.map(renderVersionRow).join('') : '<tr><td colspan="6">No data available</td></tr>'}</tbody>
  </table>

  <h2>Android</h2>
  <table>
    <thead><tr><th>Channel</th><th>Version</th><th>Build</th><th>API</th><th>Codename</th><th>Release Date</th></tr></thead>
    <tbody>${android.length ? android.map(renderVersionRow).join('') : '<tr><td colspan="6">No data available</td></tr>'}</tbody>
  </table>

  <p class="timestamp">Cached at: \${cachedAt} (refreshes every 10 min)</p>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api') {
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

  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    try {
      const { ios, android, cachedAt } = await fetchAllVersions();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHTML(ios, android, cachedAt));
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Error fetching versions</h1>');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
