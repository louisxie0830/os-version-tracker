import http from 'node:http';
import { fetchAllVersions } from './fetch-all.js';
import type { OSVersionInfo, SubmissionDeadline } from './types.js';

const PORT = Number(process.env.PORT) || 3000;

function renderVersionCard(v: OSVersionInfo): string {
  const isStable = !v.isBeta;
  const badgeClass = isStable ? 'badge-stable' : 'badge-beta';
  const badgeText = isStable ? 'Stable' : 'Beta';
  const build = v.build ? `<span class="meta">Build <code>${v.build}</code></span>` : '';
  const api = v.apiLevel ? `<span class="meta">API ${v.apiLevel}</span>` : '';
  const codename = v.codename ? `<span class="meta">${v.codename}</span>` : '';
  return `<div class="version-card">
    <div class="version-header">
      <span class="badge ${badgeClass}">${badgeText}</span>
      <span class="version-number">${v.version}</span>
    </div>
    <div class="version-details">
      ${build}${api}${codename}
      <span class="meta">Released ${v.releaseDate}</span>
    </div>
  </div>`;
}

function renderPlatformSection(icon: string, name: string, versions: OSVersionInfo[]): string {
  if (!versions.length) {
    return `<div class="platform-section">
      <div class="platform-header">${icon}<h2>${name}</h2></div>
      <div class="empty">No data available</div>
    </div>`;
  }
  return `<div class="platform-section">
    <div class="platform-header">${icon}<h2>${name}</h2></div>
    <div class="version-grid">${versions.map(renderVersionCard).join('')}</div>
  </div>`;
}

function renderDeadlineCard(deadline: SubmissionDeadline, title: string): string {
  const reqs = deadline.requirements
    .map(r => `<li>${r.platform}: <strong>${r.sdk}</strong></li>`)
    .join('');
  const announced = deadline.announcedAt
    ? `<div class="deadline-announced">Announced ${deadline.announcedAt}</div>`
    : '';
  const extension = deadline.extensionDate
    ? `<div class="deadline-announced">Extension available to ${deadline.extensionDate}</div>`
    : '';
  const note = deadline.source === 'apple'
    ? 'Apps uploaded to App Store Connect must meet:'
    : 'Apps on Google Play must target:';
  return `<div class="deadline-card">
    <div class="deadline-label">${title}</div>
    <div class="deadline-date">${deadline.deadline}</div>
    <div class="deadline-note">${note}</div>
    <ul class="deadline-reqs">${reqs}</ul>
    ${announced}${extension}
  </div>`;
}

function renderDeadlinesSection(apple: SubmissionDeadline | null, google: SubmissionDeadline | null): string {
  if (!apple && !google) return '';
  const cards: string[] = [];
  if (apple) cards.push(renderDeadlineCard(apple, 'App Store'));
  if (google) cards.push(renderDeadlineCard(google, 'Google Play'));
  return `<div class="platform-section">
    <div class="platform-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <h2>Submission Deadlines</h2>
    </div>
    <div class="version-grid">${cards.join('')}</div>
  </div>`;
}

function renderHTML(ios: OSVersionInfo[], android: OSVersionInfo[], cachedAt: string, appleDeadline?: SubmissionDeadline | null, googleDeadline?: SubmissionDeadline | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OS Version Tracker — Latest iOS &amp; Android Versions</title>
  <meta name="description" content="Track the latest stable and beta versions of iOS and Android in real time. Updated every 10 minutes with version numbers, build info, API levels, and release dates.">
  <meta name="keywords" content="iOS version, Android version, iOS beta, Android beta, OS tracker, mobile OS, Apple iOS, Android API level">
  <meta property="og:title" content="OS Version Tracker">
  <meta property="og:description" content="Latest stable and beta versions of iOS and Android, updated every 10 minutes.">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="OS Version Tracker">
  <meta name="twitter:description" content="Latest stable and beta versions of iOS and Android, updated every 10 minutes.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://os-version-tracker.onrender.com">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "OS Version Tracker",
    "description": "Track the latest stable and beta versions of iOS and Android",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Any"
  }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      min-height: 100vh;
    }
    .container { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.5rem; }

    /* Header */
    .header { text-align: center; margin-bottom: 2.5rem; }
    .header h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.5px; }
    .header p { color: #94a3b8; font-size: 0.9rem; margin-top: 0.4rem; }

    /* Platform */
    .platform-section { margin-bottom: 2rem; }
    .platform-header { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1rem; }
    .platform-header svg { width: 28px; height: 28px; flex-shrink: 0; }
    .platform-header h2 { font-size: 1.25rem; font-weight: 600; }

    /* Cards */
    .version-grid { display: grid; gap: 0.75rem; }
    .version-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      transition: background 0.2s, border-color 0.2s;
    }
    .version-card:hover {
      background: rgba(255,255,255,0.08);
      border-color: rgba(255,255,255,0.15);
    }
    .version-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
    .version-number { font-size: 1.3rem; font-weight: 700; letter-spacing: -0.3px; }
    .version-details { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }

    /* Badge */
    .badge {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 10px;
      border-radius: 20px;
    }
    .badge-stable { background: #059669; color: #fff; }
    .badge-beta { background: #d97706; color: #fff; }

    /* Meta */
    .meta {
      font-size: 0.8rem;
      color: #94a3b8;
      background: rgba(255,255,255,0.06);
      padding: 2px 10px;
      border-radius: 6px;
    }
    code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.78rem;
    }

    /* Footer */
    .footer {
      text-align: center;
      margin-top: 2.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(255,255,255,0.06);
      color: #64748b;
      font-size: 0.78rem;
    }
    .footer a { color: #64748b; text-decoration: none; }
    .footer a:hover { color: #94a3b8; }
    .dot { margin: 0 0.5rem; }
    .empty { color: #64748b; font-size: 0.9rem; padding: 1rem; }

    /* Deadline */
    .deadline-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 1rem 1.25rem;
    }
    .deadline-date {
      font-size: 1.3rem;
      font-weight: 700;
      color: #f59e0b;
      margin-bottom: 0.5rem;
    }
    .deadline-note { font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.5rem; }
    .deadline-reqs {
      list-style: none;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .deadline-reqs li {
      font-size: 0.8rem;
      color: #cbd5e1;
      background: rgba(255,255,255,0.06);
      padding: 3px 10px;
      border-radius: 6px;
    }
    .deadline-reqs strong { color: #e2e8f0; }
    .deadline-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      margin-bottom: 0.3rem;
    }
    .deadline-announced { font-size: 0.75rem; color: #64748b; margin-top: 0.5rem; }

    @media (max-width: 480px) {
      .container { padding: 1.5rem 1rem; }
      .version-number { font-size: 1.1rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>OS Version Tracker</h1>
      <p>Latest iOS &amp; Android release info</p>
    </div>

    ${renderPlatformSection(`<svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/><path d="M16.5 7.5S15 6 12 6 7.5 7.5 7.5 7.5"/><circle cx="8.5" cy="10.5" r="1"/><circle cx="15.5" cy="10.5" r="1"/><path d="M8.5 15s1.5 2 3.5 2 3.5-2 3.5-2"/></svg>`, 'Apple iOS', ios)}

    ${renderPlatformSection(`<svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`, 'Android', android)}

    ${renderDeadlinesSection(appleDeadline ?? null, googleDeadline ?? null)}

    <div class="footer">
      Cached at ${cachedAt}<span class="dot">&middot;</span>Refreshes every 10 min<br>
      <a href="/api">JSON API</a><span class="dot">&middot;</span><a href="/health">Health</a>
    </div>
  </div>
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
      const { ios, android, appleDeadline, googleDeadline, cachedAt } = await fetchAllVersions();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHTML(ios, android, cachedAt, appleDeadline, googleDeadline));
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
