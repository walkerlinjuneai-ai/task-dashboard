#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 18790);

function resolveVersion() {
  try {
    return cp.execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
  } catch {
    return 'dev';
  }
}
const UI_VERSION = process.env.TASK_DASHBOARD_VERSION || resolveVersion();

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function listProjects() {
  const root = '/home/node/.openclaw/workspace/tasks';
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .map((name) => {
      const st = readJsonSafe(path.join(root, name, 'status.json')) || {};
      return {
        name,
        status: st.currentStep || 'unknown',
        nextAgent: st.nextAgent || 'unknown',
        updatedAt: st.updatedAt || null,
      };
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function listAgents() {
  const agentsRoot = '/home/node/.openclaw/agents';
  if (!fs.existsSync(agentsRoot)) return [];
  return fs.readdirSync(agentsRoot)
    .filter((id) => fs.statSync(path.join(agentsRoot, id)).isDirectory())
    .map((id) => {
      const sessions = path.join(agentsRoot, id, 'sessions');
      let lastUpdated = null;
      if (fs.existsSync(sessions)) {
        for (const f of fs.readdirSync(sessions)) {
          const t = fs.statSync(path.join(sessions, f)).mtimeMs;
          if (!lastUpdated || t > lastUpdated) lastUpdated = t;
        }
      }
      return {
        id,
        state: lastUpdated ? 'running' : 'idle',
        lastUpdated,
      };
    });
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

const INDEX_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Task Dashboard</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="topbar" role="banner">
    <div>
      <h1>Task Dashboard</h1>
      <p class="version">版本：${UI_VERSION}</p>
    </div>
    <p id="stats" aria-live="polite">載入中…</p>
  </header>

  <main class="layout" role="main">
    <section class="panel" aria-label="專案列表">
      <h2>專案</h2>
      <div id="projects" class="list"></div>
    </section>

    <section class="panel" aria-label="Agent 狀態">
      <h2>Agents</h2>
      <div id="agents" class="list"></div>
    </section>
  </main>

<script>
const statusClass = (s) => ({ planning:'is-planning', developing:'is-success', completed:'is-neutral', failed:'is-danger' }[s] || 'is-neutral');

async function load() {
  const [projects, agents] = await Promise.all([
    fetch('/api/projects').then(r=>r.json()),
    fetch('/api/agents').then(r=>r.json())
  ]);

  document.getElementById('stats').textContent = '專案 ' + projects.length + ' ・ Agents ' + agents.length;

  const p = document.getElementById('projects');
  p.innerHTML = '';
  for (const row of projects) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML =
      '<div class="row">' +
        '<strong>' + row.name + '</strong>' +
        '<span class="badge ' + statusClass(row.status) + '">' + row.status + '</span>' +
      '</div>' +
      '<div class="meta">next: ' + row.nextAgent + '</div>' +
      '<div class="meta">updated: ' + (row.updatedAt || '-') + '</div>';
    p.appendChild(el);
  }

  const a = document.getElementById('agents');
  a.innerHTML = '';
  for (const row of agents) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML =
      '<div class="row">' +
        '<strong>' + row.id + '</strong>' +
        '<span class="badge ' + (row.state === 'running' ? 'is-success' : 'is-neutral') + '">' + row.state + '</span>' +
      '</div>' +
      '<div class="meta">last: ' + (row.lastUpdated ? new Date(row.lastUpdated).toISOString() : '-') + '</div>';
    a.appendChild(el);
  }
}

load();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/' || u.pathname === '/task-dashboard') {
    return send(res, 200, 'text/html; charset=utf-8', INDEX_HTML);
  }
  if (u.pathname === '/style.css') {
    const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
    return send(res, 200, 'text/css; charset=utf-8', css);
  }
  if (u.pathname === '/api/projects') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(listProjects()));
  if (u.pathname === '/api/agents') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(listAgents()));
  return send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`Task Dashboard running at http://${HOST}:${PORT}/task-dashboard`);
});
