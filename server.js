#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 18790);

function resolveVersion() {
  try {
    return cp.execSync('git rev-parse --short HEAD', { cwd: '/home/node/.openclaw/workspace/tasks/task-dashboard/src', stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
  } catch {
    return 'dev';
  }
}
const VERSION = process.env.TASK_DASHBOARD_VERSION || resolveVersion();

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function listProjects() {
  const root = '/home/node/.openclaw/workspace/tasks';
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .map((name) => {
      const taskDir = path.join(root, name);
      const st = readJsonSafe(path.join(taskDir, 'status.json')) || {};
      const links = ['task.md', 'spec.md', 'todo.md', 'dev-log.md']
        .map((f) => ({ kind: f, path: path.join(taskDir, f) }))
        .filter((x) => fs.existsSync(x.path));
      return { name, status: st.currentStep || 'unknown', nextAgent: st.nextAgent || 'unknown', updatedAt: st.updatedAt || null, links };
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function listAgents() {
  const root = '/home/node/.openclaw/agents';
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((id) => fs.statSync(path.join(root, id)).isDirectory())
    .map((id) => {
      const sessions = path.join(root, id, 'sessions');
      let lastUpdated = null;
      if (fs.existsSync(sessions)) {
        for (const f of fs.readdirSync(sessions)) {
          const t = fs.statSync(path.join(sessions, f)).mtimeMs;
          if (!lastUpdated || t > lastUpdated) lastUpdated = t;
        }
      }
      return { id, state: lastUpdated ? 'running' : 'idle', lastUpdated };
    });
}

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>任務儀表板</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main class="layout" role="main">
    <section class="panel" aria-label="專案清單">
      <h2>專案清單</h2>
      <p id="stats" class="stats" aria-live="polite">載入中…</p>
      <div id="projects" class="list"></div>
    </section>

    <section class="panel" aria-label="Agent 狀態牆">
      <h2>Agent 狀態牆</h2>
      <div id="agents" class="list"></div>
    </section>
  </main>

  <div class="version" aria-label="版本">版本：${VERSION}</div>

<script>
const statusClass = (s) => ({ planning:'is-planning', developing:'is-success', reviewing:'is-warn', completed:'is-neutral', failed:'is-danger' }[s] || 'is-neutral');

function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2,'0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

async function load() {
  const [projects, agents] = await Promise.all([
    fetch('/api/projects').then(r => r.json()),
    fetch('/api/agents').then(r => r.json())
  ]);

  document.getElementById('stats').textContent = '專案 ' + projects.length + ' ・ Agents ' + agents.length;

  const p = document.getElementById('projects');
  p.innerHTML = '';
  for (const row of projects) {
    const detailsId = 'proj-' + row.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML =
      '<button class="toggle" aria-expanded="false" aria-controls="' + detailsId + '">' +
        '<span class="title">' + row.name + '</span>' +
        '<span class="badge ' + statusClass(row.status) + '">' + row.status + '</span>' +
      '</button>' +
      '<div class="meta">下一階段：' + row.nextAgent + '</div>' +
      '<div class="meta">更新時間：' + fmtTime(row.updatedAt) + '</div>' +
      '<div id="' + detailsId + '" class="details" hidden>' +
        '<div class="meta">文件 / 連結</div>' +
        '<ul class="links">' + (row.links || []).map(l => '<li><span>' + l.kind + '</span><code>' + l.path + '</code></li>').join('') + '</ul>' +
      '</div>';

    const btn = el.querySelector('.toggle');
    const details = el.querySelector('.details');
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      details.hidden = expanded;
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });

    p.appendChild(el);
  }

  const a = document.getElementById('agents');
  a.innerHTML = '';
  for (const row of agents) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML =
      '<div class="row">' +
        '<strong class="title">' + row.id + '</strong>' +
        '<span class="badge ' + (row.state === 'running' ? 'is-success' : 'is-neutral') + '">' + row.state + '</span>' +
      '</div>' +
      '<div class="meta">最後更新：' + (row.lastUpdated ? fmtTime(new Date(row.lastUpdated).toISOString()) : '-') + '</div>';
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (u.pathname === '/style.css') {
    const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    return res.end(css);
  }
  if (u.pathname === '/api/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(listProjects()));
  }
  if (u.pathname === '/api/agents') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(listAgents()));
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`task-dashboard-ui-refresh running at http://${HOST}:${PORT}/task-dashboard-ui-refresh`);
});
