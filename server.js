/**
 * 天网 · 本地服务 / 身份网关 / 网络探针
 *
 * 启动：node server.js
 * 访问：http://127.0.0.1:8792
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const lab = require('./lab');
let labTarget = null;
try {
  labTarget = require('./靶机限制/lab-target');
} catch (err) {
  labTarget = null;   /* 靶机限制/ 已移除，面板照常启动 */
}
const intel = require('./intel');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8792;
const HOST = '0.0.0.0';

const AUTH_USER = process.env.SKYNET_USER || 'operator';
const AUTH_PASS = process.env.SKYNET_PASS || 'Skynet-Lab-8Q2x';
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

let lastAdapters = new Map();
let latest = {
  timestamp: Date.now(),
  hostname: os.hostname(),
  adapters: [],
  totals: { rxBps: 0, txBps: 0, rxPps: 0, txPps: 0, pps: 0 },
  connections: null,
  loss: 0,
  warming: true
};
let sampling = false;
let lastError = '';
let lastCpuTimes = null;
let latestSys = {
  timestamp: Date.now(),
  hostname: os.hostname(),
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  uptime: os.uptime(),
  cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'CPU',
  cores: os.cpus().length,
  cpuPct: 0,
  memTotal: os.totalmem(),
  memFree: os.freemem(),
  memPct: 0,
  disk: null,
  node: process.version
};

function readCpuTimes() {
  let idle = 0;
  let total = 0;
  os.cpus().forEach(cpu => {
    Object.values(cpu.times).forEach(v => { total += v; });
    idle += cpu.times.idle;
  });
  return { idle, total };
}

function sampleSystem() {
  const now = readCpuTimes();
  let usage = 0;
  if (lastCpuTimes) {
    const idle = now.idle - lastCpuTimes.idle;
    const total = now.total - lastCpuTimes.total;
    if (total > 0) usage = Math.max(0, Math.min(100, (1 - idle / total) * 100));
  }
  lastCpuTimes = now;

  const memTotal = os.totalmem();
  const memFree = os.freemem();
  let disk = null;
  try {
    if (fs.statfsSync) {
      const st = fs.statfsSync(ROOT);
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      disk = { total, free, used: total - free, pct: total ? ((total - free) / total) * 100 : 0 };
    }
  } catch (e) { /* ignore */ }

  latestSys = {
    timestamp: Date.now(),
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptime: os.uptime(),
    cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'CPU',
    cores: os.cpus().length,
    cpuPct: usage,
    memTotal,
    memFree,
    memPct: memTotal ? ((memTotal - memFree) / memTotal) * 100 : 0,
    disk,
    node: process.version
  };
}

function sampleAdapters() {
  return new Promise((resolve, reject) => {
    const ps = [
      "$ErrorActionPreference='SilentlyContinue';",
      "Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {",
      "  $s = $_ | Get-NetAdapterStatistics;",
      "  [pscustomobject]@{ name=$_.Name; desc=$_.InterfaceDescription; rx=[double]$s.ReceivedBytes; tx=[double]$s.SentBytes; rxp=[double]$s.ReceivedPackets; txp=[double]$s.SentPackets }",
      "} | ConvertTo-Json -Compress"
    ].join('\n');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const text = String(stdout || '').trim();
        if (!text) return resolve([]);
        try {
          const parsed = JSON.parse(text);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function sampleOnce() {
  const now = Date.now();
  const adapters = await sampleAdapters();
  const rates = [];
  let totalRx = 0;
  let totalTx = 0;
  let totalRxP = 0;
  let totalTxP = 0;

  adapters.forEach(a => {
    const prev = lastAdapters.get(a.name);
    const dt = prev ? Math.max(0.2, (now - prev.t) / 1000) : 1;
    const rx = prev ? Math.max(0, (a.rx - prev.rx) / dt) : 0;
    const tx = prev ? Math.max(0, (a.tx - prev.tx) / dt) : 0;
    const rxp = prev && Number.isFinite(a.rxp) ? Math.max(0, (a.rxp - prev.rxp) / dt) : 0;
    const txp = prev && Number.isFinite(a.txp) ? Math.max(0, (a.txp - prev.txp) / dt) : 0;
    totalRx += rx;
    totalTx += tx;
    totalRxP += rxp;
    totalTxP += txp;
    rates.push({
      name: a.name,
      desc: a.desc,
      rxBps: Math.round(rx),
      txBps: Math.round(tx),
      rxPps: Math.round(rxp),
      txPps: Math.round(txp)
    });
    lastAdapters.set(a.name, { rx: a.rx, tx: a.tx, rxp: a.rxp, txp: a.txp, t: now });
  });

  latest = {
    timestamp: now,
    hostname: os.hostname(),
    adapters: rates,
    totals: {
      rxBps: Math.round(totalRx),
      txBps: Math.round(totalTx),
      rxPps: Math.round(totalRxP),
      txPps: Math.round(totalTxP),
      pps: Math.round(totalRxP + totalTxP)
    },
    connections: null,
    loss: 0,
    warming: false
  };
}

async function sampleLoop() {
  if (sampling) return;
  sampling = true;
  try {
    await sampleOnce();
    lastError = '';
  } catch (err) {
    const msg = String(err && err.message || err);
    if (msg !== lastError) {
      console.error('[probe]', msg);
      lastError = msg;
    }
  } finally {
    sampleSystem();
    sampling = false;
  }
}

setInterval(sampleLoop, 2200);
setTimeout(sampleLoop, 300);

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const PUBLIC_STATIC = new Set([
  '/index.html', '/login.html', '/login.css', '/login.js',
  '/app.js', '/styles.css', '/theme-light.css', '/theme-unified.css', '/terminal.css'
]);

function isAllowedStatic(rel) {
  const p = `/${String(rel || '').replace(/^[/\\]+/, '').replace(/\\/g, '/')}`.toLowerCase();
  if (PUBLIC_STATIC.has(p)) return true;
  if (p.startsWith('/vendor/')) {
    return /\.(?:js|css|png|jpe?g|webp|gif|svg|woff2?|ttf|eot)$/i.test(p);
  }
  if (/^\/preview-[a-z0-9-]+\.png$/i.test(p)) return true;
  return false;
}

function staticNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    staticNotFound(res);
    return;
  }
  if (rel === '/') rel = '/index.html';
  if (!isAllowedStatic(rel)) {
    staticNotFound(res);
    return;
  }

  const file = path.normalize(path.join(ROOT, rel));
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let real;
  try {
    real = fs.realpathSync(file);
  } catch (e) {
    staticNotFound(res);
    return;
  }
  const realRel = path.relative(ROOT, real);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!isAllowedStatic(`/${realRel.replace(/\\/g, '/')}`)) {
    staticNotFound(res);
    return;
  }

  const base = path.basename(real).toLowerCase();
  const isHtml = /\.(?:html?|htm)$/i.test(base);
  if (isHtml && base !== 'login.html' && !getSession(req)) {
    redirect(res, '/login.html');
    return;
  }
  if (base === 'login.html' && getSession(req)) {
    redirect(res, '/');
    return;
  }

  fs.readFile(real, (err, buf) => {
    if (err) {
      staticNotFound(res);
      return;
    }
    const ext = path.extname(real).toLowerCase();
    /* JS / CSS / HTML 不缓存：改完刷新即可生效，避免拿到旧的 app.js */
    const noStore = isHtml || /\.(?:js|css)$/i.test(base);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noStore ? 'no-store' : 'public, max-age=60',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(buf);
  });
}

const TEXT_EXT = new Set(['.md', '.js', '.css', '.html', '.json', '.txt', '.bat', '.log', '.csv']);

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function getSession(req) {
  const token = parseCookies(req).sky_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  res.end();
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sky_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sky_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 16384) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || 'local';
}

/* 临时目标来源策略：
   - 默认 allow：局域网登录用户也可以填扫描目标（便于远程演示）
   - 设 SKYNET_REMOTE_TARGETS=local 可恢复"只允许本机发起"的 403 限制
   远程来源一律写一行审计日志，方便事后核对。 */
const REMOTE_TARGET_MODE = String(process.env.SKYNET_REMOTE_TARGETS || 'allow').toLowerCase() === 'local'
  ? 'local'
  : 'allow';

function loopbackOrSelfClient(req) {
  const raw = String(clientIp(req) || '').replace(/^::ffff:/, '');
  if (!raw) return false;
  if (raw === '127.0.0.1' || raw === '::1' || raw === 'localhost') return true;
  const self = new Set();
  Object.values(os.networkInterfaces()).forEach(list => {
    (list || []).forEach(nic => {
      if (nic && nic.address) self.add(nic.address);
    });
  });
  return self.has(raw);
}

function rejectRemoteAdhoc(req, res, tool, adhocUrl) {
  if (!adhocUrl) return false;
  const fromSelf = loopbackOrSelfClient(req);
  if (!fromSelf) {
    console.warn(`[attack] 远程临时目标 · ${tool} · 来源 ${clientIp(req)} · 目标 ${String(adhocUrl).slice(0, 200)}`);
  }
  if (REMOTE_TARGET_MODE !== 'local' || fromSelf) return false;
  sendJSON(res, 403, {
    ok: false,
    real: true,
    tool,
    error: '自定义目标只允许从本机发起 · 已开启 SKYNET_REMOTE_TARGETS=local',
    hint: '去掉该环境变量即可恢复远程可填目标'
  });
  return true;
}

/* ------------------------------------------------------------
   凭据校验 / 登录尝试计数
   登录接口与“真实口令审计”共用同一套逻辑，审计产生的尝试
   会真实计入锁定窗口，不做任何特殊豁免。
------------------------------------------------------------ */
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_WINDOW = 60000;

function normalizeCredential(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function verifyCredential(user, pass) {
  const okUser = normalizeCredential(user, 64).toUpperCase() === AUTH_USER.toUpperCase();
  const okPass = safeEqual(normalizeCredential(pass, 128), AUTH_PASS);
  return okUser && okPass;
}

function attemptState(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);
  if (attempts && now - attempts.first > LOGIN_WINDOW) {
    loginAttempts.delete(ip);
    return null;
  }
  return attempts || null;
}

function recordAttempt(ip, ok) {
  const now = Date.now();
  if (ok) {
    loginAttempts.delete(ip);
    return null;
  }
  const attempts = attemptState(ip);
  if (!attempts) loginAttempts.set(ip, { count: 1, first: now });
  else attempts.count++;
  return attempts;
}

function credentialPolicy() {
  return {
    ok: true,
    real: true,
    user: AUTH_USER,
    usesDefaultCredential: AUTH_PASS === 'Skynet-Lab-8Q2x',
    credentialSource: process.env.SKYNET_PASS ? '环境变量 SKYNET_PASS' : '内置默认值（README 公开）',
    sessionTtlHours: SESSION_TTL / 3600000,
    cookie: { httpOnly: true, secure: false, sameSite: 'Lax', path: '/' },
    lockout: { maxAttempts: LOGIN_MAX_ATTEMPTS, windowSeconds: LOGIN_WINDOW / 1000 },
    bind: `${HOST}:${PORT}`,
    bindAllInterfaces: HOST === '0.0.0.0',
    transport: 'http',
    passwordComparison: 'timingSafeEqual 明文比较',
    storedHashes: false,
    sessionsInMemory: true,
    sessionTokenBytes: 24
  };
}

/**
 * 真实口令策略审计：只读取真实配置，不发起任何口令猜测。
 *  - 是否仍在使用 README 公开的默认口令（服务端直接比较配置值）
 *  - 会话 TTL / Cookie 标记 / 锁定策略 / 监听范围 / 传输方式
 *  - 当前 IP 的真实失败计数（只读，不增加计数）
 */
async function credentialAudit(ip) {
  const started = Date.now();
  const policy = credentialPolicy();
  const state = attemptState(ip);
  return {
    ok: true,
    real: true,
    user: AUTH_USER,
    target: `127.0.0.1:${PORT}`,
    mode: 'policy-only',
    authenticationAttempts: 0,
    defaultCredentialInUse: policy.usesDefaultCredential,
    failuresInWindow: state ? state.count : 0,
    locked: Boolean(state && state.count >= LOGIN_MAX_ATTEMPTS),
    remainingBeforeLockout: state ? Math.max(0, LOGIN_MAX_ATTEMPTS - state.count) : LOGIN_MAX_ATTEMPTS,
    maxAttempts: LOGIN_MAX_ATTEMPTS,
    lockoutWindowSeconds: LOGIN_WINDOW / 1000,
    policy,
    ms: Date.now() - started,
    timestamp: new Date().toISOString()
  };
}

function safePath(rel) {
  const clean = String(rel || '.').replace(/^[/\\]+/, '');
  const file = path.normalize(path.join(ROOT, clean));
  if (!file.startsWith(ROOT)) return null;
  return file;
}

function listDirectory(rel) {
  const dir = safePath(rel || '.');
  if (!dir) return { error: 'forbidden', code: 403 };
  let stat;
  try { stat = fs.statSync(dir); } catch (e) { return { error: 'not found', code: 404 }; }
  if (!stat.isDirectory()) return { error: 'not a directory', code: 400 };

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules')
    .map(d => {
      const full = path.join(dir, d.name);
      let size = 0;
      let mtime = 0;
      try {
        const st = fs.statSync(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch (e) { /* ignore */ }
      return {
        name: d.name,
        path: path.relative(ROOT, full).replace(/\\/g, '/'),
        type: d.isDirectory() ? 'dir' : 'file',
        size,
        mtime
      };
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

  return { path: path.relative(ROOT, dir).replace(/\\/g, '/') || '.', root: ROOT, entries };
}

/* 目录树：一次请求走完整个子树，浏览器不用逐层往返。
   设节点上限，避免 node_modules / .git 这类目录把响应撑爆。 */
const TREE_SKIP = new Set(['node_modules', '.git', '__pycache__', '.cache', '_dl']);
const TREE_MAX_NODES = 800;

function walkTree(rel, maxDepth) {
  const start = safePath(rel || '.');
  if (!start) return { error: 'forbidden', code: 403 };
  let stat;
  try { stat = fs.statSync(start); } catch (e) { return { error: 'not found', code: 404 }; }
  if (!stat.isDirectory()) return { error: 'not a directory', code: 400 };

  const stats = { dirs: 0, files: 0, bytes: 0, nodes: 0, truncated: false };

  function walk(dirAbs, depth) {
    let entries = [];
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return []; }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const out = [];
    for (const entry of entries) {
      if (stats.nodes >= TREE_MAX_NODES) { stats.truncated = true; break; }
      const full = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        stats.nodes += 1;
        if (TREE_SKIP.has(entry.name) || entry.name.startsWith('.')) {
          out.push({ name: entry.name, type: 'dir', skipped: true, expanded: false, children: [] });
          continue;
        }
        stats.dirs += 1;
        const expanded = depth < maxDepth;
        const children = expanded ? walk(full, depth + 1) : [];
        out.push({ name: entry.name, type: 'dir', skipped: false, expanded, children });
      } else {
        stats.nodes += 1;
        stats.files += 1;
        let size = 0;
        try { size = fs.statSync(full).size; } catch (e) { /* ignore */ }
        stats.bytes += size;
        out.push({ name: entry.name, type: 'file', size });
      }
    }
    return out;
  }

  const tree = walk(start, 1);
  return {
    ok: true,
    real: true,
    path: path.relative(ROOT, start).replace(/\\/g, '/') || '.',
    root: ROOT,
    maxDepth,
    tree,
    stats
  };
}

function readTextFile(rel) {
  const file = safePath(rel);
  if (!file) return { error: 'forbidden', code: 403 };
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return { error: 'not found', code: 404 }; }
  if (!stat.isFile()) return { error: 'not a file', code: 400 };
  if (stat.size > 240 * 1024) return { error: 'file too large', code: 413 };
  const ext = path.extname(file).toLowerCase();
  if (!TEXT_EXT.has(ext)) return { error: 'binary or unsupported file', code: 415 };
  return { path: rel, content: fs.readFileSync(file, 'utf8') };
}

let auditCache = { at: 0, data: null, pending: null };

/**
 * 真实本机安全姿态：所有字段直接来自操作系统 / 注册表 / netstat，
 * 读不到的字段返回 null，绝不以默认值冒充。
 */
async function runSecurityAudit() {
  if (auditCache.data && Date.now() - auditCache.at < 30000) return auditCache.data;
  if (auditCache.pending) return auditCache.pending;

  const work = (async () => {
    let data;
    try {
      const [facts, listening] = await Promise.all([lab.hostFacts(), lab.listeningPorts()]);
      const win = (facts && facts.windows) || {};
      data = {
        ok: true,
        real: true,
        hostname: facts.os.hostname,
        platform: facts.os.platform,
        release: facts.os.release,
        arch: facts.os.arch,
        user: facts.user,
        uptime: facts.os.uptime,
        defender: win.defender || null,
        firewall: Array.isArray(win.firewall) ? win.firewall : [],
        firewallRaw: Array.isArray(win.firewallRaw) ? win.firewallRaw : [],
        uac: win.uac || null,
        smb1: typeof win.smb1 === 'boolean' ? win.smb1 : null,
        smbSigning: typeof win.smbSigning === 'boolean' ? win.smbSigning : null,
        rdp: typeof win.rdpEnabled === 'boolean' ? win.rdpEnabled : null,
        hotfix: Array.isArray(win.hotfixes) && win.hotfixes.length ? win.hotfixes[0] : null,
        hotfixes: Array.isArray(win.hotfixes) ? win.hotfixes : [],
        admins: Array.isArray(win.admins) ? win.admins : null,
        secureBoot: typeof win.secureBoot === 'boolean' ? win.secureBoot : null,
        processCount: win.processCount == null ? null : win.processCount,
        gateway: (facts.net && facts.net.gateway) || null,
        dnsServers: (facts.net && facts.net.dnsServers) || [],
        tools: facts.tools || {},
        listening,
        totals: { listening: listening.length },
        windowsError: facts.windowsError || null,
        timestamp: Date.now()
      };
    } catch (err) {
      data = { ok: false, real: true, error: String(err && err.message || err), timestamp: Date.now() };
    }
    return data;
  })();

  auditCache.pending = work;
  const result = await work;
  auditCache = { at: Date.now(), data: result, pending: null };
  return result;
}

/* ============================================================
   真实数据聚合层
   RIPE RIS Live (BGP) · CISA KEV · Cloudflare/GitHub Status
   · Spamhaus DROP · 本机 TCP 连接
   ============================================================ */
const sseClients = new Set();
const REAL = {
  threats: [],
  bgp: [],
  connections: [],
  seenThreats: new Set()
};
const FEEDS = {
  ris: { name: 'RIPE RIS Live', state: 'connecting', events: 0, last: null, detail: 'wss://ris-live.ripe.net' },
  status: { name: 'Upstream Status', state: 'connecting', events: 0, last: null, detail: 'Cloudflare + GitHub' },
  kev: { name: 'CISA KEV', state: 'connecting', events: 0, last: null, detail: 'known exploited vulnerabilities' },
  drop: { name: 'Spamhaus DROP', state: 'connecting', events: 0, last: null, detail: 'drop list' },
  local: { name: 'Local TCP', state: 'idle', events: 0, last: null, detail: 'Get-NetTCPConnection' }
};

let risSocket = null;
let risReconnect = null;
let risMessageCount = 0;
let bgpQueue = [];
let bgpFlushTimer = null;
let prefixOrigins = new Map();
let threatSeq = 0;
let connectionsBusy = false;

function publicFeeds() {
  const out = {};
  Object.entries(FEEDS).forEach(([key, value]) => { out[key] = { ...value }; });
  return out;
}

function broadcastSSE(event, data) {
  if (!sseClients.size) return;
  let payload;
  try {
    payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  } catch (e) {
    return;
  }
  sseClients.forEach(res => {
    try { res.write(payload); }
    catch (e) { sseClients.delete(res); }
  });
}

function feedState(key, patch = {}) {
  if (!FEEDS[key]) return;
  FEEDS[key] = { ...FEEDS[key], ...patch };
  broadcastSSE('feed', { key, ...FEEDS[key] });
}

function addRealThreat(threat) {
  const key = threat.key || `${threat.tag || 'THR'}-${threat.text || ''}`;
  if (REAL.seenThreats.has(key)) return null;
  REAL.seenThreats.add(key);
  if (REAL.seenThreats.size > 800) REAL.seenThreats.clear();
  const item = {
    id: `THR-${String(++threatSeq).padStart(4, '0')}`,
    tag: threat.tag || 'INTEL',
    level: threat.level || 'low',
    text: threat.text || '',
    target: threat.target || 'global',
    value: threat.value || '',
    source: threat.source || '',
    real: true,
    time: Date.now()
  };
  REAL.threats.unshift(item);
  if (REAL.threats.length > 60) REAL.threats.length = 60;
  broadcastSSE('threat', item);
  return item;
}

function originFromPath(path) {
  if (!Array.isArray(path) || !path.length) return '--';
  const last = path[path.length - 1];
  return Array.isArray(last) ? last.join(',') : String(last);
}

function queueBgp(event) {
  bgpQueue.push(event);
  if (bgpQueue.length > 40) bgpQueue.shift();
  if (!bgpFlushTimer) bgpFlushTimer = setTimeout(flushBgp, 400);
}

function flushBgp() {
  bgpFlushTimer = null;
  const batch = bgpQueue.splice(0, 3);
  batch.forEach(event => {
    REAL.bgp.unshift(event);
    if (REAL.bgp.length > 80) REAL.bgp.length = 80;
    broadcastSSE('bgp', event);
  });
  if (bgpQueue.length) bgpFlushTimer = setTimeout(flushBgp, 400);
}

function handleRisMessage(message) {
  if (!message || message.type === 'ris_error') {
    if (message && message.data) feedState('ris', { state: 'error', detail: message.data.message || 'ris error' });
    return;
  }
  if (message.type !== 'ris_message' || !message.data) return;
  const data = message.data;
  if (data.type !== 'UPDATE') return;

  risMessageCount++;
  FEEDS.ris.events = risMessageCount;
  FEEDS.ris.last = Date.now();
  const path = Array.isArray(data.path) ? data.path : [];
  const origin = originFromPath(path);
  const collector = data.host || 'rrc00';
  const base = {
    collector,
    peer: data.peer || '',
    peerAsn: data.peer_asn || '',
    origin,
    path: path.slice(-8).map(p => Array.isArray(p) ? p.join(',') : String(p)),
    ts: Date.now()
  };

  (data.announcements || []).slice(0, 4).forEach(ann => {
    (ann.prefixes || []).slice(0, 3).forEach(prefix => {
      const prev = prefixOrigins.get(prefix);
      if (prev && origin !== '--' && prev !== origin) {
        addRealThreat({
          key: `BGP-${prefix}-${prev}-${origin}`,
          tag: 'BGP',
          level: 'high',
          text: `${prefix} origin ${prev} → ${origin}`,
          target: collector,
          value: 'origin change · heuristic',
          source: 'RIPE RIS'
        });
      }
      prefixOrigins.set(prefix, origin);
      queueBgp({ ...base, prefix, kind: 'A' });
    });
  });

  (data.withdrawals || []).slice(0, 3).forEach(prefix => {
    queueBgp({ ...base, prefix, kind: 'W' });
  });

  if (prefixOrigins.size > 8000) prefixOrigins.clear();
}

function startRisFeed() {
  if (risSocket) return;
  feedState('ris', { state: 'connecting' });
  try {
    const ws = new WebSocket('wss://ris-live.ripe.net/v1/ws/?client=skynet-dashboard');
    risSocket = ws;
    ws.onopen = () => {
      feedState('ris', { state: 'live', last: Date.now(), detail: 'subscribed · UPDATE' });
      ws.send(JSON.stringify({ type: 'ris_subscribe', data: { type: 'UPDATE', require: 'announcements' } }));
    };
    ws.onmessage = event => {
      try { handleRisMessage(JSON.parse(event.data)); } catch (e) { /* ignore malformed frame */ }
    };
    ws.onerror = () => {
      feedState('ris', { state: 'error', detail: 'websocket error' });
    };
    ws.onclose = () => {
      risSocket = null;
      feedState('ris', { state: 'reconnecting', detail: 'reconnect in 8s' });
      clearTimeout(risReconnect);
      risReconnect = setTimeout(startRisFeed, 8000);
    };
  } catch (err) {
    feedState('ris', { state: 'error', detail: String(err.message || err) });
    clearTimeout(risReconnect);
    risReconnect = setTimeout(startRisFeed, 12000);
  }
}

async function fetchJSON(url, timeout = 8000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': 'skynet-dashboard/1.0' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function pollStatusFeeds() {
  const services = [
    { name: 'Cloudflare', url: 'https://www.cloudflarestatus.com/api/v2/status.json' },
    { name: 'GitHub', url: 'https://www.githubstatus.com/api/v2/status.json' }
  ];
  const results = await Promise.allSettled(services.map(s => fetchJSON(s.url, 7000)));
  let live = 0;
  results.forEach((result, i) => {
    const service = services[i];
    if (result.status !== 'fulfilled') {
      feedState('status', { state: 'error', detail: `${service.name} unavailable` });
      return;
    }
    live++;
    const status = result.value.status || {};
    const indicator = status.indicator || 'unknown';
    if (indicator !== 'none') {
      addRealThreat({
        key: `STATUS-${service.name}-${indicator}-${status.description || ''}`,
        tag: 'STATUS',
        level: indicator === 'major' || indicator === 'critical' ? 'high' : 'mid',
        text: `${service.name}: ${status.description || indicator}`,
        target: service.name,
        value: indicator,
        source: 'Status API'
      });
    }
  });
  feedState('status', {
    state: live ? 'live' : 'error',
    events: live,
    last: Date.now(),
    detail: `${live}/${services.length} upstream live`
  });
  setTimeout(pollStatusFeeds, 120000);
}

async function pollKevFeed() {
  try {
    const data = await fetchJSON('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', 12000);
    const list = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];
    feedState('kev', { state: 'live', events: data.count || list.length, last: Date.now(), detail: `catalog ${data.catalogVersion || ''}` });
    list.slice(-3).reverse().forEach(v => {
      addRealThreat({
        key: `KEV-${v.cveID}`,
        tag: 'KEV',
        level: 'high',
        text: `${v.cveID} · ${v.vendorProject || ''} ${v.product || ''}`.trim(),
        target: 'CISA KEV',
        value: v.dateAdded || '',
        source: 'CISA'
      });
    });
  } catch (err) {
    feedState('kev', { state: 'error', detail: String(err.message || err) });
    setTimeout(pollKevFeed, 5 * 60 * 1000);
    return;
  }
  setTimeout(pollKevFeed, 6 * 60 * 60 * 1000);
}

async function pollDropFeed() {
  try {
    const res = await fetch('https://www.spamhaus.org/drop/drop.txt', {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'skynet-dashboard/1.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const ranges = text.split(/\r?\n/).filter(line => line && !line.startsWith(';') && line.includes('/'));
    feedState('drop', { state: 'live', events: ranges.length, last: Date.now(), detail: 'Spamhaus DROP' });
  } catch (err) {
    feedState('drop', { state: 'error', detail: String(err.message || err) });
  }
  setTimeout(pollDropFeed, 60 * 60 * 1000);
}

function sampleConnections() {
  if (connectionsBusy) return;
  connectionsBusy = true;
  const args = process.platform === 'win32' ? ['-ano', '-p', 'tcp'] : ['-ano'];
  execFile(
    process.platform === 'win32' ? 'netstat.exe' : 'netstat',
    args,
    { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 },
    (err, stdout) => {
      connectionsBusy = false;
      if (err) {
        feedState('local', { state: 'error', detail: 'netstat unavailable' });
        return;
      }
      const rows = [];
      String(stdout || '').split(/\r?\n/).forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (!parts.length || parts[0].toUpperCase() !== 'TCP') return;
        if (parts.length < 5) return;
        const state = String(parts[3] || '').toUpperCase();
        if (state !== 'ESTABLISHED') return;
        const splitAddr = value => {
          const idx = value.lastIndexOf(':');
          if (idx < 0) return [value, ''];
          return [value.slice(0, idx), value.slice(idx + 1)];
        };
        const [local, localPort] = splitAddr(parts[1]);
        const [remote, remotePort] = splitAddr(parts[2]);
        const loopback = value => ['127.0.0.1', '::1', '0.0.0.0', '::'].includes(value);
        if (loopback(local) && loopback(remote)) return;
        rows.push({ local, localPort, remote, remotePort, state, pid: parts[4] });
      });
      REAL.connections = rows.slice(0, 24);
      feedState('local', {
        state: 'live',
        events: REAL.connections.length,
        last: Date.now(),
        detail: 'netstat ESTABLISHED'
      });
      broadcastSSE('connections', { connections: REAL.connections, timestamp: Date.now() });
    }
  );
}

function realSnapshot() {
  return {
    feeds: publicFeeds(),
    threats: REAL.threats.slice(0, 10),
    bgp: REAL.bgp.slice(0, 12),
    connections: REAL.connections.slice(0, 12),
    now: Date.now()
  };
}

function startRealCollectors() {
  startRisFeed();
  setTimeout(pollStatusFeeds, 1200);
  setTimeout(pollKevFeed, 2400);
  setTimeout(pollDropFeed, 3600);
  setInterval(() => { if (sseClients.size) sampleConnections(); }, 6000);
  setInterval(() => {
    sseClients.forEach(res => {
      try { res.write(': heartbeat\n\n'); }
      catch (e) { sseClients.delete(res); }
    });
  }, 20000);
}
/* ============================================================
   终端真实探针 API
   全部端点只接受已登录会话；主动探测仅指向 127.0.0.1。
   ============================================================ */
const labCache = new Map();

async function cachedLab(key, ttl, producer) {
  const hit = labCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await producer();
  labCache.set(key, { at: Date.now(), data });
  if (labCache.size > 120) labCache.clear();
  return data;
}

async function handleLabApi(req, res, url) {
  const route = url.pathname.slice('/api/lab/'.length);
  const base = `http://127.0.0.1:${PORT}`;

  switch (route) {
    case 'scan': {
      const ports = url.searchParams.get('ports') || '';
      const data = await cachedLab(`scan:${ports}`, 4000, () => lab.scanPorts(ports));
      sendJSON(res, 200, data);
      return;
    }
    case 'banner': {
      sendJSON(res, 200, await lab.bannerGrab(url.searchParams.get('port') || PORT));
      return;
    }
    case 'tls': {
      sendJSON(res, 200, await lab.tlsProbe(url.searchParams.get('port') || 443));
      return;
    }
    case 'web': {
      const data = await cachedLab('web', 4000, () => lab.webFingerprint(base, req.headers.cookie));
      sendJSON(res, 200, data);
      return;
    }
    case 'http': {
      const target = url.searchParams.get('path') || '/';
      const method = url.searchParams.get('method') || 'GET';
      sendJSON(res, 200, await lab.httpRequest(base, target, method));
      return;
    }
    case 'dns': {
      const name = url.searchParams.get('name') || os.hostname();
      const data = await cachedLab(`dns:${name}`, 15000, () => lab.dnsProbe(name));
      sendJSON(res, 200, data);
      return;
    }
    case 'rdap': {
      const ip = url.searchParams.get('ip') || '';
      const data = await cachedLab(`rdap:${ip}`, 600000, () => lab.rdapProbe(ip));
      sendJSON(res, 200, data);
      return;
    }
    case 'ping': {
      sendJSON(res, 200, await lab.pingProbe(url.searchParams.get('host') || '127.0.0.1'));
      return;
    }
    case 'procs': {
      sendJSON(res, 200, await lab.topProcesses(8));
      return;
    }
    case 'recon': {
      const data = await cachedLab('recon', 15000, () => lab.hostFacts());
      sendJSON(res, 200, data);
      return;
    }
    case 'search': {
      const query = url.searchParams.get('q') || '';
      sendJSON(res, 200, await intel.search(query, 5));
      return;
    }
    case 'inject': {
      const data = await cachedLab('inject', 60000, () => lab.injectionAudit(base, req.headers.cookie));
      sendJSON(res, 200, data);
      return;
    }
    case 'auth': {
      sendJSON(res, 200, await credentialAudit(clientIp(req)));
      return;
    }
    /* ---- LAB 攻击面：真实工具（白名单靶机已移除，只接受 URL） ---- */
    case 'target': {
      if (!labTarget) {
        sendJSON(res, 200, { ok: false, running: false, removed: true, error: '靶机限制/ 已移除' });
        return;
      }
      sendJSON(res, 200, labTarget.status());
      return;
    }
    case 'attack/tools': {
      const data = await lab.attackTools();
      data.remoteTargetMode = REMOTE_TARGET_MODE;
      sendJSON(res, 200, data);
      return;
    }
    case 'toolkit': {
      sendJSON(res, 200, await lab.toolkitStatus());
      return;
    }
    case 'nmap': {
      const host = url.searchParams.get('host') || '';
      if (rejectRemoteAdhoc(req, res, 'nmap', host)) return;
      sendJSON(res, 200, await lab.nmapRun(host, url.searchParams.get('ports') || ''));
      return;
    }
    case 'attack/sqlmap': {
      const adhocUrl = url.searchParams.get('url') || '';
      if (rejectRemoteAdhoc(req, res, 'sqlmap', adhocUrl)) return;
      sendJSON(res, 200, await lab.sqlmapAttack(
        url.searchParams.get('target') || '',
        adhocUrl
      ));
      return;
    }
    case 'attack/hydra': {
      const adhocUrl = url.searchParams.get('url') || '';
      if (rejectRemoteAdhoc(req, res, 'hydra', adhocUrl)) return;
      sendJSON(res, 200, await lab.hydraAttack({
        targetId: url.searchParams.get('target') || '',
        adhocUrl,
        user: url.searchParams.get('user') || 'admin',
        wordlist: url.searchParams.get('wordlist') || '',
        form: url.searchParams.get('form') || ''
      }));
      return;
    }
    case 'attack/msf': {
      const adhocUrl = url.searchParams.get('url') || '';
      if (rejectRemoteAdhoc(req, res, 'msfconsole', adhocUrl)) return;
      sendJSON(res, 200, await lab.msfAttack(
        url.searchParams.get('target') || '',
        adhocUrl
      ));
      return;
    }
    case 'vuln': {
      const data = await cachedLab('vuln', 30000, async () => {
        const [audit, scan, web, kev] = await Promise.all([
          runSecurityAudit(),
          lab.scanPorts('').catch(err => ({ ok: false, error: String(err && err.message || err), ports: [] })),
          lab.webFingerprint(base, req.headers.cookie).catch(err => ({
            ok: false,
            error: String(err && err.message || err),
            missing: [],
            security: {},
            auth: {}
          })),
          intel.kevCatalog().catch(() => null)
        ]);
        const policy = credentialPolicy();
        const built = lab.buildFindings({ audit, scan, web, policy, kev });
        return {
          ok: true,
          real: true,
          scope: '127.0.0.1',
          generatedAt: new Date().toISOString(),
          findings: built.findings,
          counts: built.counts,
          evidence: {
            host: (audit && audit.hostname) || null,
            listening: audit && audit.totals ? audit.totals.listening : null,
            openPorts: scan && Array.isArray(scan.ports)
              ? scan.ports.filter(p => p.state === 'open').map(p => p.port)
              : [],
            portScanError: (scan && scan.error) || null,
            missingHeaders: (web && web.missing) || [],
            httpError: (web && web.error) || null,
            kevCatalog: kev && kev.ok ? { count: kev.count, version: kev.version } : null,
            auditError: (audit && audit.error) || null
          }
        };
      });
      sendJSON(res, 200, data);
      return;
    }
    default:
      sendJSON(res, 404, { ok: false, real: true, error: `unknown lab endpoint: ${route}` });
  }
}


const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || HOST}`);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const session = getSession(req);

  /* ---- 登录 / 会话 ---- */
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const now = Date.now();
    let attempts = attemptState(ip);
    if (attempts && attempts.count >= LOGIN_MAX_ATTEMPTS) {
      const retryAfter = Math.max(1, Math.ceil((LOGIN_WINDOW - (now - attempts.first)) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      sendJSON(res, 429, { ok: false, error: 'too many attempts', retryAfter });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJSON(res, 400, { ok: false, error: 'invalid request' });
      return;
    }

    const user = normalizeCredential(body.user, 64);
    const pass = normalizeCredential(body.pass, 128);
    const ok = verifyCredential(user, pass);

    if (ok) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { user: AUTH_USER, exp: now + SESSION_TTL });
      recordAttempt(ip, true);
      setSessionCookie(res, token);
      sendJSON(res, 200, { ok: true, user: AUTH_USER });
    } else {
      recordAttempt(ip, false);
      sendJSON(res, 401, { ok: false, error: 'invalid credentials' });
    }
    return;
  }

  if (url.pathname === '/api/logout') {
    const token = parseCookies(req).sky_session;
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    sendJSON(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/session') {
    if (session) sendJSON(res, 200, { ok: true, user: session.user });
    else sendJSON(res, 200, { ok: false, user: null });
    return;
  }

  if (url.pathname === '/api/health') {
    sendJSON(res, 200, { ok: true });
    return;
  }

  /* ---- API 权限 ---- */
  if (url.pathname.startsWith('/api/') && !session) {
    sendJSON(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 4000\n\n');
    sseClients.add(res);
    try {
      res.write(`event: snapshot\ndata: ${JSON.stringify(realSnapshot())}\n\n`);
    } catch (e) { /* ignore */ }
    req.on('close', () => sseClients.delete(res));
    res.on('error', () => sseClients.delete(res));
    sampleConnections();
    return;
  }

  if (url.pathname === '/api/netstats') {
    sendJSON(res, 200, latest);
    return;
  }

  if (url.pathname === '/api/sysstats') {
    sendJSON(res, 200, latestSys);
    return;
  }

  if (url.pathname.startsWith('/api/lab/')) {
    if (req.method !== 'GET') {
      sendJSON(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    try {
      await handleLabApi(req, res, url);
    } catch (err) {
      sendJSON(res, 400, { ok: false, real: true, error: String(err && err.message || err) });
    }
    return;
  }

  if (url.pathname === '/api/audit') {
    if (req.method !== 'GET') {
      sendJSON(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    const audit = await runSecurityAudit();
    sendJSON(res, audit.ok ? 200 : 500, audit);
    return;
  }

  if (url.pathname === '/api/files') {
    const result = listDirectory(url.searchParams.get('path') || '.');
    if (result.error) sendJSON(res, result.code || 400, { error: result.error });
    else sendJSON(res, 200, result);
    return;
  }

  /* Python 执行：默认只允许本机来源；设 SKYNET_PYTHON_REMOTE=1 才放开局域网 */
  if (url.pathname === '/api/python' && req.method === 'POST') {
    const allowRemote = String(process.env.SKYNET_PYTHON_REMOTE || '') === '1';
    if (!allowRemote && !loopbackOrSelfClient(req)) {
      console.warn(`[python] 拒绝远程执行 · 来源 ${clientIp(req)}`);
      sendJSON(res, 403, { ok: false, real: true, error: 'python 执行只允许本机来源（设 SKYNET_PYTHON_REMOTE=1 可放开）' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJSON(res, 400, { ok: false, error: 'invalid json' });
      return;
    }
    const out = await lab.runPython(body && body.code);
    if (!out.ok && out.stderr) console.warn(`[python] exit ${out.exitCode} · ${String(body.code).slice(0, 120)}`);
    sendJSON(res, 200, out);
    return;
  }

  if (url.pathname === '/api/file') {
    const result = readTextFile(url.searchParams.get('path') || '');
    if (result.error) sendJSON(res, result.code || 400, { error: result.error });
    else sendJSON(res, 200, result);
    return;
  }

  if (url.pathname === '/api/tree') {
    const depth = Math.max(1, Math.min(8, Number(url.searchParams.get('depth')) || 3));
    const result = walkTree(url.searchParams.get('path') || '.', depth);
    if (result.error) sendJSON(res, result.code || 400, { error: result.error });
    else sendJSON(res, 200, result);
    return;
  }

  /* ---- 页面权限 ---- */
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!session) {
      redirect(res, '/login.html');
      return;
    }
    serveStatic(req, res, '/index.html');
    return;
  }

  if (url.pathname === '/login.html') {
    if (session) {
      redirect(res, '/');
      return;
    }
    serveStatic(req, res, '/login.html');
    return;
  }

  if (url.pathname === '/login' || url.pathname === '/gate') {
    redirect(res, '/login.html');
    return;
  }

  serveStatic(req, res, url.pathname);
});

startRealCollectors();

if (labTarget) {
  labTarget.start().then(result => {
    if (result.ok) {
      console.log(`  靶机     http://${labTarget.TARGET_HOST}:${labTarget.TARGET_PORT}/  ${result.already ? '已在运行' : '已启动'}`);
    } else {
      console.log(`  靶机     启动失败：${result.error}`);
    }
  });
} else {
  console.log('  靶机     已移除（靶机限制/ 不存在）· 用 sqlmap <URL> 直接指定目标');
}

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  [!] 端口 ${PORT} 已被占用：本机已经有一个天网实例在运行。`);
    console.error(`      直接打开 http://127.0.0.1:${PORT}/ 即可使用。`);
    console.error('      如需重启：先关闭旧的服务窗口（或结束 node.exe），再运行 start.bat。');
    console.error('');
    process.exit(1);
  }
  if (err && err.code === 'EACCES') {
    console.error('');
    console.error(`  [!] 没有权限监听 ${HOST}:${PORT}，请换一个端口：set PORT=8794 && node server.js`);
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  天网 SKYNET · 安全网关已启动');
  console.log(`  本机     http://127.0.0.1:${PORT}/`);
  console.log(`  认证     http://127.0.0.1:${PORT}/login.html`);
  console.log(`  探针     http://127.0.0.1:${PORT}/api/netstats`);
  const nets = os.networkInterfaces();
  Object.entries(nets).forEach(([name, list]) => {
    (list || []).forEach(net => {
      if (!net || net.internal || net.family !== 'IPv4') return;
      console.log(`  局域网   http://${net.address}:${PORT}/  ${name}`);
    });
  });
  console.log('  按 Ctrl+C 停止');
  console.log('');
});