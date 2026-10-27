/**
 * 天网 · 本地靶机 (DELIBERATELY VULNERABLE LOOPBACK TARGET)
 *
 * 这个服务是"靶子"，不是"武器"：
 *  - 只监听 127.0.0.1:8793，不接受外部连接，也不被网关以外的人访问
 *  - 口令、注入点都是故意留下的，用来给 sqlmap / hydra 提供真实可打的目标
 *  - 数据库是内存 SQLite（node:sqlite），进程退出即销毁，不落盘、不含真实凭据
 *
 * 故意保留的弱点：
 *  1. GET /item?id=1      → 直接拼接 SQL，可 UNION / 布尔 / 延时注入
 *  2. POST /login         → 弱口令 + 无锁定，可被字典爆破
 *  3. GET /search?q=      → LIKE 拼接，可注入
 */

'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 8793;
const BANNER = 'SKYNET-LAB-TARGET/1.0 (deliberately vulnerable)';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  DatabaseSync = null;
}

/* 故意使用弱口令：这些是靶机凭据，不是真实系统凭据 */
const SEED_USERS = [
  { user: 'admin', pass: 'admin123', role: 'administrator' },
  { user: 'operator', pass: 'skynet2024', role: 'operator' },
  { user: 'guest', pass: 'guest', role: 'viewer' }
];

const SEED_ITEMS = [
  { id: 1, name: '卫星链路租约', price: 1200 },
  { id: 2, name: '地面站带宽', price: 860 },
  { id: 3, name: '频谱监测席位', price: 2400 }
];

let db = null;
let server = null;
let running = false;
let startedAt = 0;
let loginCount = 0;
let attempts = 0;
const sessions = new Map();

function createDb() {
  if (!DatabaseSync) return null;
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, user TEXT, pass TEXT, role TEXT);
    CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price INTEGER);
    CREATE TABLE secrets (id INTEGER PRIMARY KEY, label TEXT, value TEXT);
  `);
  const insertUser = database.prepare('INSERT INTO users (user, pass, role) VALUES (?, ?, ?)');
  SEED_USERS.forEach(u => insertUser.run(u.user, u.pass, u.role));
  const insertItem = database.prepare('INSERT INTO items (id, name, price) VALUES (?, ?, ?)');
  SEED_ITEMS.forEach(i => insertItem.run(i.id, i.name, i.price));
  database.prepare('INSERT INTO secrets (label, value) VALUES (?, ?)')
    .run('lab_flag', 'SKYNET{local_lab_only_not_a_real_secret}');
  return database;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, code, payload, contentType = 'application/json; charset=utf-8') {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Server': BANNER,
    'X-Powered-By': 'node-lab-target'
  });
  res.end(body);
}

function parseId(raw) {
  const text = String(raw == null ? '' : raw).trim();
  return text === '' ? '1' : text;
}

/* 故意不安全：调用方把 id 直接拼进 SQL */
function queryItems(id) {
  const sql = `SELECT id, name, price FROM items WHERE id = ${parseId(id)}`;
  try {
    const rows = db.prepare(sql).all();
    return { sql, ok: true, rows };
  } catch (err) {
    return { sql, ok: false, error: String(err && err.message || err) };
  }
}

/* 故意不安全：登录查询直接拼接 */
function queryLogin(user, pass) {
  const sql = `SELECT id, user, role FROM users WHERE user = '${user}' AND pass = '${pass}'`;
  try {
    const rows = db.prepare(sql).all();
    return { sql, ok: true, rows };
  } catch (err) {
    return { sql, ok: false, error: String(err && err.message || err) };
  }
}

function searchItems(q) {
  const sql = `SELECT id, name, price FROM items WHERE name LIKE '%${q}%'`;
  try {
    return { sql, ok: true, rows: db.prepare(sql).all() };
  } catch (err) {
    return { sql, ok: false, error: String(err && err.message || err) };
  }
}

function indexPage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>LAB TARGET · 8793</title>
<style>body{background:#05080f;color:#cfe6ff;font:13px/1.7 ui-monospace,Consolas,monospace;padding:28px}
h1{font-size:15px;letter-spacing:.18em;color:#39d0ff}code{color:#7ef7c0}
li{margin:4px 0}.dim{color:#5b7488}</style></head><body>
<h1>SKYNET LAB TARGET</h1>
<p class="dim">deliberately vulnerable · loopback only · in-memory sqlite</p>
<ul>
<li><code>GET  /item?id=1</code> — 注入点（UNION / boolean / time）</li>
<li><code>GET  /search?q=a</code> — LIKE 注入</li>
<li><code>POST /login</code> — 弱口令登录（user/pass 表单）</li>
<li><code>GET  /health</code> — 存活检查</li>
</ul>
<p class="dim">这是靶场端点，不要用于任何真实系统。</p>
</body></html>`;
}

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${TARGET_HOST}:${TARGET_PORT}`);
  } catch (err) {
    send(res, 400, { ok: false, error: 'bad request' });
    return;
  }

  if (!db) {
    send(res, 503, {
      ok: false,
      error: 'node:sqlite 不可用 · 需要 Node.js 22.5+（当前进程无法加载 node:sqlite）'
    });
    return;
  }

  if (url.pathname === '/') {
    send(res, 200, indexPage(), 'text/html; charset=utf-8');
    return;
  }

  if (url.pathname === '/health') {
    send(res, 200, {
      ok: true,
      service: 'lab-target',
      banner: BANNER,
      port: TARGET_PORT,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      logins: loginCount,
      loginAttempts: attempts,
      real: true
    });
    return;
  }

  if (url.pathname === '/item') {
    const result = queryItems(url.searchParams.get('id'));
    send(res, result.ok ? 200 : 500, result);
    return;
  }

  if (url.pathname === '/search') {
    const result = searchItems(url.searchParams.get('q') || '');
    send(res, result.ok ? 200 : 500, result);
    return;
  }

  if (url.pathname === '/login' && req.method === 'POST') {
    let body = '';
    try {
      body = await readBody(req);
    } catch (err) {
      send(res, 413, { ok: false, error: 'body too large' });
      return;
    }
    const params = new URLSearchParams(body);
    const user = (params.get('user') || params.get('username') || '').slice(0, 128);
    const pass = (params.get('pass') || params.get('password') || '').slice(0, 128);
    attempts++;
    if (!user || !pass) {
      send(res, 400, { ok: false, error: 'missing credentials' });
      return;
    }
    const result = queryLogin(user, pass);
    if (!result.ok) {
      send(res, 400, { ok: false, error: result.error, sql: result.sql });
      return;
    }
    if (result.rows.length) {
      loginCount++;
      const token = `lab-${Math.random().toString(16).slice(2)}`;
      sessions.set(token, { user: result.rows[0].user, at: Date.now() });
      res.setHeader('Set-Cookie', `lab_session=${token}; Path=/; HttpOnly`);
      send(res, 200, {
        ok: true,
        user: result.rows[0].user,
        role: result.rows[0].role,
        sql: result.sql
      });
      return;
    }
    send(res, 401, { ok: false, error: 'invalid credentials', sql: result.sql });
    return;
  }

  if (url.pathname === '/login') {
    send(res, 405, { ok: false, error: 'use POST' });
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
}

function start() {
  return new Promise(resolve => {
    if (running) {
      resolve({ ok: true, already: true, host: TARGET_HOST, port: TARGET_PORT, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
      return;
    }
    db = createDb();
    if (!db) {
      resolve({ ok: false, error: 'node:sqlite 不可用 · 需要 Node.js 22.5+' });
      return;
    }
    server = http.createServer((req, res) => {
      Promise.resolve(handle(req, res)).catch(err => {
        try {
          send(res, 500, { ok: false, error: String(err && err.message || err) });
        } catch (e) { /* ignore */ }
      });
    });
    server.on('error', err => {
      running = false;
      resolve({ ok: false, error: String(err && err.message || err) });
    });
    server.listen(TARGET_PORT, TARGET_HOST, () => {
      running = true;
      startedAt = Date.now();
      resolve({ ok: true, host: TARGET_HOST, port: TARGET_PORT, banner: BANNER });
    });
  });
}

function stop() {
  return new Promise(resolve => {
    if (!server) { resolve({ ok: true, already: true }); return; }
    const s = server;
    server = null;
    running = false;
    s.close(() => resolve({ ok: true }));
  });
}

function status() {
  return {
    ok: running,
    running,
    host: TARGET_HOST,
    port: TARGET_PORT,
    banner: BANNER,
    uptimeSeconds: running ? Math.round((Date.now() - startedAt) / 1000) : 0,
    logins: loginCount,
    loginAttempts: attempts,
    users: SEED_USERS.map(u => u.user)
  };
}

module.exports = {
  TARGET_HOST,
  TARGET_PORT,
  BANNER,
  SEED_USERS,
  start,
  stop,
  status
};
