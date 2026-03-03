#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = 18789;

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function listProjects() {
  const tasksRoot = '/home/node/.openclaw/workspace/tasks';
  const entries = [];
  if (!fs.existsSync(tasksRoot)) return entries;
  for (const name of fs.readdirSync(tasksRoot)) {
    const taskDir = path.join(tasksRoot, name);
    try {
      const stat = fs.statSync(taskDir);
      if (!stat.isDirectory()) continue;
      const statusPath = path.join(taskDir, 'status.json');
      const st = readJsonSafe(statusPath) || {};
      const links = [];
      for (const f of ['spec.md','todo.md','dev-log.md']) {
        const p = path.join(taskDir, f);
        if (fs.existsSync(p)) links.push({ kind: f, path: p });
      }
      entries.push({
        name,
        taskDir,
        status: st.currentStep || 'unknown',
        nextAgent: st.nextAgent || 'unknown',
        updatedAt: st.updatedAt || null,
        links
      });
    } catch {}
  }
  return entries;
}

function listAgents() {
  // Lightweight approximation via session logs
  const agentsRoot = '/home/node/.openclaw/agents';
  const res = [];
  if (!fs.existsSync(agentsRoot)) return res;
  for (const agentName of fs.readdirSync(agentsRoot)) {
    const agentDir = path.join(agentsRoot, agentName);
    try {
      const sessionsDir = path.join(agentDir, 'sessions');
      let lastUpdated = null;
      if (fs.existsSync(sessionsDir)) {
        for (const f of fs.readdirSync(sessionsDir)) {
          const p = path.join(sessionsDir, f);
          const st = fs.statSync(p);
          if (!lastUpdated || st.mtimeMs > lastUpdated) lastUpdated = st.mtimeMs;
        }
      }
      res.push({ id: agentName, kind: agentName.includes('chat') ? 'chat' : agentName.includes('main') ? 'main' : 'other', lastUpdated, state: lastUpdated ? 'running' : 'idle' });
    } catch {}
  }
  return res;
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const INDEX_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Task Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; }
  header { padding: 12px 16px; background:#111; color:#fff; }
  .wrap { display:flex; }
  .left { width: 45%; border-right: 1px solid #ddd; padding: 12px; }
  .right { flex: 1; padding: 12px; }
  .card { border:1px solid #ddd; border-radius:8px; padding:10px; margin-bottom:10px; }
  .tag { display:inline-block; padding:2px 6px; border-radius:6px; font-size:12px; color:#fff; margin-right:6px; }
  .status-developing { background:#16a34a; }
  .status-planning { background:#2563eb; }
  .status-completed { background:#374151; }
  .status-failed { background:#dc2626; }
  .status-unknown { background:#6b7280; }
  .agent-running { background:#16a34a; }
  .agent-idle { background:#6b7280; }
</style>
</head>
<body>
<header>
  <h1>Task Dashboard</h1>
  <div id="stats"></div>
</header>
<div class="wrap">
  <div class="left">
    <h2>專案</h2>
    <div id="projects"></div>
  </div>
  <div class="right">
    <h2>Agents</h2>
    <div id="agents"></div>
  </div>
</div>
<script>
async function load() {
  const [projects, agents] = await Promise.all([
    fetch('/api/projects').then(r=>r.json()),
    fetch('/api/agents').then(r=>r.json())
  ]);
  const stats = document.getElementById('stats');
  stats.textContent = `專案 ${projects.length}｜Agents ${agents.length}`;

  const pBox = document.getElementById('projects');
  pBox.innerHTML = '';
  for (const p of projects) {
    const s = p.status || 'unknown';
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div><strong>${p.name}</strong></div>
      <div>
        <span class="tag status-${s}">${s}</span>
        <span>next: ${p.nextAgent}</span>
      </div>
      <div>updated: ${p.updatedAt || '-'}</div>
      <div>links: ${(p.links||[]).map(l=>l.kind).join(', ')}</div>
    `;
    pBox.appendChild(el);
  }

  const aBox = document.getElementById('agents');
  aBox.innerHTML = '';
  for (const a of agents) {
    const st = a.state || 'idle';
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div><strong>${a.id}</strong> <span class="tag agent-${st}">${st}</span></div>
      <div>kind: ${a.kind}</div>
      <div>lastUpdated: ${a.lastUpdated ? new Date(a.lastUpdated).toISOString() : '-'}</div>
    `;
    aBox.appendChild(el);
  }
}
load();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/projects') {
    return sendJson(res, listProjects());
  }
  if (req.method === 'GET' && req.url === '/api/agents') {
    return sendJson(res, listAgents());
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/task-dashboard')) {
    return sendHtml(res, INDEX_HTML);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Task Dashboard running at http://${HOST}:${PORT}/task-dashboard`);
});
