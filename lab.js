/**
 * 天网 · 真实探针库 (REAL PROBES ONLY)
 *
 * 本文件里的每一个函数都会对真实系统 / 真实网络发起操作：
 * TCP 连接、TLS 握手、HTTP 请求、DNS 查询、RDAP 查询、ICMP / TCP 延迟、进程采样。
 * 没有任何随机数、假数据或“模拟结果”。
 *
 * 设计约束：
 *  - 主动连接目标仅限 127.0.0.1（本机服务）；
 *  - DNS / RDAP / CVE 情报为只读查询；
 *  - 所有失败都如实返回 error，绝不伪造成功。
 */
'use strict';

const net = require('net');
const tls = require('tls');
const dns = require('dns');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
let labTarget = null;
try {
  labTarget = require('./靶机限制/lab-target');
} catch (err) {
  labTarget = null;
}

const LOOPBACK = '127.0.0.1';
const IS_WIN = process.platform === 'win32';
const PS = IS_WIN ? 'powershell.exe' : 'pwsh';

/* IANA 端口注册表（静态知识，不是探测结果） */
const PORT_MAP = {
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns',
  80: 'http', 110: 'pop3', 135: 'msrpc', 139: 'netbios-ssn', 143: 'imap',
  443: 'https', 445: 'microsoft-ds', 587: 'submission', 993: 'imaps', 995: 'pop3s',
  1433: 'ms-sql-s', 1521: 'oracle', 2375: 'docker', 3000: 'node-dev',
  3306: 'mysql', 3389: 'rdp', 5432: 'postgresql', 5601: 'kibana', 5900: 'vnc',
  6379: 'redis', 8000: 'http-alt', 8080: 'http-proxy', 8081: 'http-alt',
  8443: 'https-alt', 8792: 'skynet-gateway', 9000: 'http-alt', 9090: 'http-alt',
  9200: 'elasticsearch', 27017: 'mongodb'
};
const DEFAULT_PORTS = Object.keys(PORT_MAP).map(Number);
const HTTP_PORTS = new Set([80, 3000, 8000, 8080, 8081, 8792, 9000, 9090]);
const TLS_PORTS = new Set([443, 8443]);

const MAX_SCAN_PORTS = 300;

/* ------------------------------------------------------------
   基础工具
------------------------------------------------------------ */

function run(file, args, options = {}) {
  return new Promise(resolve => {
    const settle = err => {
      resolve({
        ok: false,
        code: -1,
        stdout: '',
        stderr: '',
        error: String(err && err.message || err || 'spawn failed')
      });
    };
    try {
      execFile(file, args, {
        timeout: options.timeout || 15000,
        windowsHide: true,
        maxBuffer: options.maxBuffer || 4 * 1024 * 1024
      }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : ''
        });
      });
    } catch (err) {
      settle(err);
    }
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        out[index] = await fn(items[index], index);
      } catch (err) {
        out[index] = { error: String(err && err.message || err) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function printable(buffer, limit = 1200) {
  if (!buffer) return '';
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  let out = '';
  for (let i = 0; i < text.length && out.length < limit; i++) {
    const code = text.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) out += code === 9 ? '\t' : '\n';
    else if (code >= 32 && code <= 126) out += text[i];
    else out += '·';
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch (e) { /* ignore */ }
  }
  return null;
}

function clampPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  return port;
}

/* ------------------------------------------------------------
   TCP 端口扫描 / banner / TLS
------------------------------------------------------------ */

function probePort(port, host = LOOPBACK, timeout = 400) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (state, error) => {
      if (settled) return;
      settled = true;
      const latencyMs = Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100;
      try { socket.destroy(); } catch (e) { /* ignore */ }
      resolve({ port, state, error: error || null, latencyMs });
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('filtered'));
    socket.once('error', err => {
      const code = err && err.code;
      finish(code === 'ECONNREFUSED' ? 'closed' : 'filtered', code || 'error');
    });
  });
}

function parsePorts(input, fallback = DEFAULT_PORTS) {
  const text = String(input == null ? '' : input).trim();
  if (!text) return fallback.slice();
  const ports = [];
  text.split(/[,\s]+/).filter(Boolean).forEach(part => {
    const single = /^(\d{1,5})$/.exec(part);
    const range = /^(\d{1,5})-(\d{1,5})$/.exec(part);
    if (single) {
      const port = Number(single[1]);
      if (port >= 1 && port <= 65535) ports.push(port);
    } else if (range) {
      const lo = Math.max(1, Number(range[1]));
      const hi = Math.min(65535, Number(range[2]));
      for (let p = lo; p <= hi && ports.length < MAX_SCAN_PORTS; p++) ports.push(p);
    }
  });
  if (!ports.length) return [];
  return [...new Set(ports)].slice(0, MAX_SCAN_PORTS);
}

async function scanPorts(input) {
  const ports = parsePorts(input);
  if (!ports.length) throw new Error('no valid ports requested');
  const started = Date.now();
  const results = await mapLimit(ports, 18, port => probePort(port));
  const clean = results.map(r => ({
    port: r.port,
    state: r.error ? (r.state === 'filtered' ? 'filtered' : 'closed') : (r.state === 'open' ? 'open' : r.state),
    service: PORT_MAP[r.port] || 'unknown',
    latencyMs: r.error && r.state !== 'open' ? null : r.latencyMs,
    error: r.error || null
  }));
  clean.sort((a, b) => a.port - b.port);
  const open = clean.filter(r => r.state === 'open');
  return {
    ok: true,
    real: true,
    host: LOOPBACK,
    scope: 'loopback',
    scanned: clean.length,
    requested: ports.length,
    truncated: ports.length >= MAX_SCAN_PORTS,
    open: open.map(r => r.port),
    ports: clean,
    duration: Date.now() - started,
    timestamp: Date.now()
  };
}

async function bannerGrab(portValue) {
  const port = clampPort(portValue);
  const started = Date.now();
  const service = PORT_MAP[port] || 'unknown';
  const httpMode = HTTP_PORTS.has(port) || service === 'unknown';
  const tlsMode = TLS_PORTS.has(port);
  return new Promise(resolve => {
    let settled = false;
    let data = Buffer.alloc(0);
    const socket = net.connect({ host: LOOPBACK, port });
    const finish = (state, note) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (e) { /* ignore */ }
      resolve({
        ok: true,
        real: true,
        port,
        service: PORT_MAP[port] || 'unknown',
        state,
        bytes: data.length,
        banner: printable(data),
        note: note || '',
        ms: Date.now() - started
      });
    };
    socket.setTimeout(1600);
    socket.on('connect', () => {
      if (httpMode) {
        socket.write(`HEAD / HTTP/1.0\r\nHost: ${LOOPBACK}\r\nUser-Agent: skynet-probe/2.0\r\nConnection: close\r\n\r\n`);
      } else if (!tlsMode) {
        socket.write('\r\n');
      }
    });
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 2048) finish('open', 'buffer limit 2 KiB');
    });
    socket.on('end', () => finish(data.length ? 'open' : 'open-no-banner'));
    socket.on('timeout', () => finish(data.length ? 'open' : 'open-no-banner', 'read timeout'));
    socket.on('close', () => finish(data.length ? 'open' : 'open-no-banner'));
    socket.on('error', err => finish('closed', (err && err.code) || 'error'));
  });
}

async function tlsProbe(portValue) {
  const port = clampPort(portValue);
  const started = Date.now();
  return new Promise(resolve => {
    let settled = false;
    const socket = tls.connect({
      host: LOOPBACK,
      port,
      rejectUnauthorized: false,
      timeout: 3500
    });
    const finish = payload => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (e) { /* ignore */ }
      resolve({ ok: true, real: true, port, ms: Date.now() - started, ...payload });
    };
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true) || {};
      const subject = cert.subject || {};
      const issuer = cert.issuer || {};
      const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
      const daysRemaining = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86400000) : null;
      finish({
        state: 'open',
        protocol: socket.getProtocol(),
        cipher: socket.getCipher(),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || null,
        subject: { cn: subject.CN || null, o: subject.O || null, c: subject.C || null },
        issuer: { cn: issuer.CN || null, o: issuer.O || null, c: issuer.C || null },
        selfSigned: Boolean(subject.CN && issuer.CN && subject.CN === issuer.CN),
        validFrom: cert.valid_from || null,
        validTo: cert.valid_to || null,
        daysRemaining,
        expired: daysRemaining != null ? daysRemaining < 0 : null,
        serialNumber: cert.serialNumber || null,
        fingerprint256: cert.fingerprint256 || null,
        subjectAltName: cert.subjectaltname || null
      });
    });
    socket.once('timeout', () => finish({ state: 'filtered', error: 'TLS handshake timeout' }));
    socket.once('error', err => finish({
      state: err && err.code === 'ECONNREFUSED' ? 'closed' : 'error',
      error: (err && (err.code || err.message)) || 'TLS error'
    }));
  });
}

/* ------------------------------------------------------------
   HTTP 指纹（只请求本机网关）
------------------------------------------------------------ */

const CAPTURED_HEADERS = [
  'server', 'x-powered-by', 'content-type', 'content-length', 'cache-control',
  'location', 'set-cookie', 'content-security-policy', 'x-frame-options',
  'strict-transport-security', 'x-content-type-options', 'referrer-policy',
  'permissions-policy', 'access-control-allow-origin',
  'access-control-allow-methods', 'access-control-allow-headers'
];

function headerMap(headers) {
  const out = {};
  CAPTURED_HEADERS.forEach(name => {
    const value = headers.get(name);
    if (value != null) out[name] = value;
  });
  return out;
}

async function webFingerprint(baseUrl, cookieHeader) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('local gateway URL expected');
  const started = Date.now();
  const checks = [];
  const cookie = cookieHeader ? String(cookieHeader) : '';

  async function request(name, path, init = {}) {
    const t0 = process.hrtime.bigint();
    try {
      const res = await fetch(base + path, {
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
        ...init
      });
      const body = await res.text().catch(() => '');
      const record = {
        name,
        method: init.method || 'GET',
        path,
        status: res.status,
        ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100,
        bytes: Buffer.byteLength(body),
        location: res.headers.get('location'),
        headers: headerMap(res.headers)
      };
      checks.push(record);
      return record;
    } catch (err) {
      const record = {
        name,
        method: init.method || 'GET',
        path,
        status: null,
        ms: null,
        error: err && err.name === 'TimeoutError' ? 'timeout' : String(err && err.message || err)
      };
      checks.push(record);
      return record;
    }
  }

  await request('root', '/', { redirect: 'manual' });
  await request('login', '/login.html');
  await request('health', '/api/health');
  await request('session', '/api/session');
  const unauthFiles = await request('files-unauth', '/api/files?path=.');
  const authFiles = cookie ? await request('files-auth', '/api/files?path=.', { headers: { cookie } }) : null;
  await request('source-exposed', '/server.js');
  await request('traversal', '/%2e%2e/server.js');
  await request('options', '/api/files', { method: 'OPTIONS' });

  const login = checks.find(c => c.name === 'login') || {};
  const options = checks.find(c => c.name === 'options') || {};
  const headers = login.headers || {};
  const security = {
    server: headers.server || null,
    poweredBy: headers['x-powered-by'] || null,
    contentType: headers['content-type'] || null,
    contentSecurityPolicy: headers['content-security-policy'] || null,
    xFrameOptions: headers['x-frame-options'] || null,
    hsts: headers['strict-transport-security'] || null,
    xContentTypeOptions: headers['x-content-type-options'] || null,
    referrerPolicy: headers['referrer-policy'] || null,
    permissionsPolicy: headers['permissions-policy'] || null,
    cors: (options.headers || {})['access-control-allow-origin'] || headers['access-control-allow-origin'] || null
  };
  const missing = [
    ['contentSecurityPolicy', 'Content-Security-Policy'],
    ['xFrameOptions', 'X-Frame-Options'],
    ['hsts', 'Strict-Transport-Security'],
    ['xContentTypeOptions', 'X-Content-Type-Options'],
    ['referrerPolicy', 'Referrer-Policy'],
    ['permissionsPolicy', 'Permissions-Policy']
  ].filter(([key]) => !security[key]).map(([, label]) => label);

  return {
    ok: true,
    real: true,
    base,
    checks,
    security,
    missing,
    auth: {
      unauthenticatedApi: unauthFiles.status,
      authenticatedApi: authFiles ? authFiles.status : null
    },
    duration: Date.now() - started,
    timestamp: Date.now()
  };
}

async function httpRequest(baseUrl, path, method = 'GET') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const target = String(path || '/');
  const verb = String(method || 'GET').toUpperCase();
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('local gateway URL expected');
  if (!target.startsWith('/') || /[\r\n]/.test(target)) throw new Error('invalid path');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(verb)) throw new Error('method not allowed (GET / HEAD / OPTIONS)');
  const t0 = process.hrtime.bigint();
  const res = await fetch(base + target, {
    method: verb,
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000)
  });
  const body = verb === 'HEAD' ? '' : await res.text().catch(() => '');
  return {
    ok: true,
    real: true,
    method: verb,
    path: target,
    status: res.status,
    location: res.headers.get('location'),
    headers: headerMap(res.headers),
    bytes: Buffer.byteLength(body),
    bodyPreview: printable(body, 600),
    ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100
  };
}

/* ------------------------------------------------------------
   DNS / RDAP / 延迟
------------------------------------------------------------ */

async function dnsProbe(nameValue) {
  const target = String(nameValue || '').trim().toLowerCase().replace(/\.$/, '');
  if (!target || target.length > 253 || !/^[a-z0-9._:-]+$/.test(target)) throw new Error('invalid hostname');
  const started = Date.now();
  const out = {
    ok: true,
    real: true,
    name: target,
    isIp: net.isIP(target) > 0,
    resolved: [],
    records: {},
    errors: {},
    ms: 0
  };
  const t0 = process.hrtime.bigint();
  try {
    out.resolved = await dns.promises.lookup(target, { all: true, verbatim: true });
  } catch (err) {
    out.errors.lookup = err && err.code || 'lookup failed';
  }
  out.lookupMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100;

  if (out.isIp) {
    try {
      out.records.reverse = await dns.promises.reverse(target);
    } catch (err) {
      out.errors.reverse = err && err.code || 'reverse failed';
    }
  } else {
    const types = [
      ['a', 'resolve4'], ['aaaa', 'resolve6'], ['cname', 'resolveCname'],
      ['mx', 'resolveMx'], ['ns', 'resolveNs'], ['txt', 'resolveTxt']
    ];
    for (const [key, fn] of types) {
      const start = Date.now();
      try {
        out.records[key] = await dns.promises[fn](target);
        out.records[`${key}Ms`] = Date.now() - start;
      } catch (err) {
        out.errors[key] = err && err.code || 'query failed';
      }
    }
  }
  out.ms = Date.now() - started;
  return out;
}

function isPrivateIp(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a >= 224) return true;
  return false;
}

const RDAP_ENDPOINTS = [
  { name: 'ARIN', url: 'https://rdap.arin.net/registry/ip/' },
  { name: 'RIPE', url: 'https://rdap.db.ripe.net/ip/' },
  { name: 'APNIC', url: 'https://rdap.apnic.net/ip/' },
  { name: 'LACNIC', url: 'https://rdap.lacnic.net/rest/ip/' },
  { name: 'AFRINIC', url: 'https://rdap.afrinic.net/rdap/ip/' }
];

function rdapEntityEmail(entities) {
  const found = [];
  const walk = list => {
    (list || []).forEach(entity => {
      const vcard = entity && entity.vcardArray && entity.vcardArray[1];
      if (Array.isArray(vcard)) {
        vcard.forEach(field => {
          if (!Array.isArray(field)) return;
          if (field[0] === 'email') found.push(String(field[3]));
          if (field[0] === 'fn' && !found.length) found.push(String(field[3]));
        });
      }
      if (entity && entity.entities) walk(entity.entities);
    });
  };
  walk(entities);
  return found.slice(0, 3);
}

async function rdapProbe(ipValue) {
  const ip = String(ipValue || '').trim();
  if (!net.isIP(ip)) throw new Error('invalid IP address');
  if (isPrivateIp(ip)) {
    return {
      ok: true,
      real: true,
      ip,
      registered: false,
      scope: 'private',
      note: '私有 / 回环地址由本地网络管理，不在公共 RDAP 注册库中'
    };
  }
  const started = Date.now();
  const attempts = [];
  const lookups = RDAP_ENDPOINTS.map(source => (async () => {
    try {
      const res = await fetch(source.url + encodeURIComponent(ip), {
        signal: AbortSignal.timeout(6500),
        headers: { accept: 'application/rdap+json', 'user-agent': 'skynet-terminal/2.0' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        ok: true,
        real: true,
        ip,
        registered: true,
        source: source.name,
        handle: data.handle || null,
        name: data.name || null,
        country: data.country || null,
        type: data.type || null,
        startAddress: data.startAddress || null,
        endAddress: data.endAddress || null,
        parentHandle: data.parentHandle || null,
        abuseContacts: rdapEntityEmail(data.entities),
        ms: Date.now() - started
      };
    } catch (err) {
      attempts.push(`${source.name}: ${err && err.name === 'TimeoutError' ? 'timeout' : String(err && err.message || err)}`);
      throw err;
    }
  })());

  const settled = await Promise.allSettled(lookups);
  const found = settled.find(item => item.status === 'fulfilled' && item.value);
  if (found) return found.value;

  return {
    ok: false,
    real: true,
    ip,
    registered: null,
    error: 'RDAP 查询失败（所有 RIR 端点均未返回可解析数据）',
    attempts,
    ms: Date.now() - started
  };
}

function parsePingOutput(text, platform) {
  const out = { lossPct: null, received: null, sent: null, min: null, avg: null, max: null, ttl: null };
  if (platform === 'win32') {
    const loss = /\((\d+)%\s*loss\)/i.exec(text);
    const stats = /Received\s*=\s*(\d+),\s*Lost\s*=\s*(\d+)/i.exec(text);
    const rtt = /Minimum\s*=\s*(\d+)ms,\s*Maximum\s*=\s*(\d+)ms,\s*Average\s*=\s*(\d+)ms/i.exec(text);
    if (loss) out.lossPct = Number(loss[1]);
    if (stats) { out.received = Number(stats[1]); out.sent = out.received + Number(stats[2]); }
    if (rtt) { out.min = Number(rtt[1]); out.max = Number(rtt[2]); out.avg = Number(rtt[3]); }
  } else {
    const loss = /(\d+(?:\.\d+)?)%\s*packet loss/i.exec(text);
    const rtt = /rtt\s+min\/avg\/max\/mdev\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/i.exec(text);
    if (loss) out.lossPct = Number(loss[1]);
    if (rtt) { out.min = Number(rtt[1]); out.avg = Number(rtt[2]); out.max = Number(rtt[3]); }
  }
  const ttl = /TTL=(\d+)/i.exec(text);
  if (ttl) out.ttl = Number(ttl[1]);
  if (out.sent == null) {
    const sent = /Sent\s*=\s*(\d+)/i.exec(text);
    if (sent) out.sent = Number(sent[1]);
  }
  return out;
}

async function tcpLatencySamples(host, count = 4) {
  const ports = [443, 80, 8792];
  for (const port of ports) {
    const first = await probePort(port, host, 1200);
    if (first.state !== 'open') continue;
    const samples = [first.latencyMs];
    for (let i = 1; i < count; i++) {
      const next = await probePort(port, host, 1200);
      if (next.state !== 'open') break;
      samples.push(next.latencyMs);
    }
    if (samples.length) {
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      return { port, samples, min, max, avg: Math.round(avg * 100) / 100 };
    }
  }
  return null;
}

async function pingProbe(hostValue) {
  const host = String(hostValue || '').trim();
  if (!host || host.length > 253 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(host)) {
    throw new Error('invalid host');
  }
  const started = Date.now();
  const count = 4;
  const ipInfo = { resolved: [] };
  try {
    ipInfo.resolved = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    ipInfo.error = err && err.code || 'unresolved';
  }
  const ip = ipInfo.resolved.length ? ipInfo.resolved[0].address : null;

  const args = IS_WIN ? ['-n', String(count), '-w', '1200', host] : ['-c', String(count), '-W', '2', host];
  const res = await run(IS_WIN ? 'ping.exe' : 'ping', args, { timeout: 12000 });
  const parsed = parsePingOutput(`${res.stdout}\n${res.stderr}`, process.platform);
  const icmpBlocked = parsed.lossPct === 100 || /general failure|transmit failed|100% packet loss/i.test(res.stdout);
  const reachable = parsed.received != null && parsed.received > 0;

  if (reachable) {
    return {
      ok: true,
      real: true,
      method: 'icmp',
      host,
      ip,
      sent: parsed.sent != null ? parsed.sent : count,
      received: parsed.received,
      lossPct: parsed.lossPct,
      min: parsed.min,
      avg: parsed.avg,
      max: parsed.max,
      ttl: parsed.ttl,
      ms: Date.now() - started,
      note: '真实 ICMP 回显'
    };
  }

  const tcp = await tcpLatencySamples(host, count);
  return {
    ok: Boolean(tcp),
    real: true,
    method: tcp ? 'tcp' : 'icmp-failed',
    host,
    ip,
    port: tcp ? tcp.port : null,
    samples: tcp ? tcp.samples : [],
    sent: count,
    received: tcp ? tcp.samples.length : 0,
    lossPct: tcp ? Math.round((1 - tcp.samples.length / count) * 100) : 100,
    min: tcp ? tcp.min : null,
    avg: tcp ? tcp.avg : null,
    max: tcp ? tcp.max : null,
    ttl: parsed.ttl,
    ms: Date.now() - started,
    note: tcp
      ? `ICMP 不可达（${icmpBlocked ? '本机 ICMP 被过滤' : '无回显'}），改用真实 TCP ${tcp.port} 握手延迟`
      : `ICMP 与 TCP 均不可达：${(res.error || 'no route').split('\n')[0]}`,
    icmpOutput: printable(res.stdout, 400)
  };
}

/* ------------------------------------------------------------
   本机进程 / 监听端口 / 主机事实
------------------------------------------------------------ */

let procsCache = { at: 0, data: null, pending: null };

async function topProcesses(limit = 8) {
  if (procsCache.data && Date.now() - procsCache.at < 3000) return procsCache.data;
  if (procsCache.pending) return procsCache.pending;

  const work = (async () => {
    const started = Date.now();
    if (IS_WIN) {
      const ps = [
        "$ErrorActionPreference='SilentlyContinue'",
        "$cores=[Environment]::ProcessorCount",
        "$first=@{}",
        "Get-Process | ForEach-Object { if ($null -ne $_.CPU) { $first[[int]$_.Id]=[double]$_.CPU } } | Out-Null",
        "Start-Sleep -Milliseconds 600",
        "$rows=@()",
        "Get-Process | ForEach-Object {",
        "  $cpu = if ($null -ne $_.CPU) { [double]$_.CPU } else { $null }",
        "  $prev = if ($first.ContainsKey([int]$_.Id)) { $first[[int]$_.Id] } else { $null }",
        "  $delta = if ($null -ne $cpu -and $null -ne $prev) { $cpu - $prev } else { $null }",
        "  $rows += [pscustomobject]@{ pid=[int]$_.Id; name=[string]$_.ProcessName; cpuSec=$cpu; mem=[double]$_.WorkingSet64; delta=$delta }",
        "}",
        "[pscustomobject]@{ cores=$cores; intervalMs=600; rows=$rows } | ConvertTo-Json -Depth 3 -Compress"
      ].join('\n');
      const res = await run(PS, ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 12000 });
      const data = parseJsonLoose(res.stdout);
      if (data && Array.isArray(data.rows)) {
        const seconds = Math.max(0.1, Number(data.intervalMs) / 1000);
        const cores = Math.max(1, Number(data.cores) || os.cpus().length || 1);
        const processes = data.rows.map(row => {
          const delta = row.delta == null ? null : Number(row.delta);
          const cpuPct = delta == null ? null : Math.max(0, Math.min(100, (delta / (seconds * cores)) * 100));
          return {
            pid: row.pid,
            name: row.name,
            cpuPct: cpuPct == null ? null : Math.round(cpuPct * 10) / 10,
            cpuSec: row.cpuSec == null ? null : Math.round(Number(row.cpuSec) * 10) / 10,
            mem: Number(row.mem) || 0
          };
        });
        processes.sort((a, b) => (b.cpuPct || 0) - (a.cpuPct || 0) || b.mem - a.mem);
        return { ok: true, real: true, source: 'Get-Process', cores, intervalMs: data.intervalMs, processes: processes.slice(0, limit), count: processes.length, ms: Date.now() - started };
      }
      const fallback = await run('tasklist.exe', ['/fo', 'csv', '/nh'], { timeout: 8000 });
      const rows = String(fallback.stdout || '').split(/\r?\n/).map(line => {
        const cells = line.match(/"([^"]*)"/g);
        if (!cells || cells.length < 5) return null;
        const name = cells[0].replace(/"/g, '');
        const pid = Number(cells[1].replace(/"/g, ''));
        const memText = cells[4].replace(/"/g, '').replace(/[^\d]/g, '');
        return { pid, name, mem: Number(memText) * 1024, cpuPct: null, cpuSec: null };
      }).filter(Boolean).sort((a, b) => b.mem - a.mem).slice(0, limit);
      return { ok: rows.length > 0, real: true, source: 'tasklist', processes: rows, count: rows.length, error: rows.length ? null : (res.error || 'process sampling failed'), ms: Date.now() - started };
    }
    const res = await run('ps', ['-eo', 'pid,comm,pcpu,rss', '--sort=-pcpu'], { timeout: 8000 });
    const rows = String(res.stdout || '').split(/\r?\n/).slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return null;
      return { pid: Number(parts[0]), name: parts[1], cpuPct: Number(parts[2]), cpuSec: null, mem: Number(parts[3]) * 1024 };
    }).filter(Boolean).slice(0, limit);
    return { ok: rows.length > 0, real: true, source: 'ps', processes: rows, count: rows.length, ms: Date.now() - started };
  })();

  procsCache.pending = work;
  const result = await work;
  procsCache = { at: Date.now(), data: result, pending: null };
  return result;
}

async function listeningPorts() {
  const res = await run(IS_WIN ? 'netstat.exe' : 'netstat', ['-ano'], { timeout: 8000 });
  const names = new Map();
  if (IS_WIN) {
    const tasks = await run('tasklist.exe', ['/fo', 'csv', '/nh'], { timeout: 8000 });
    String(tasks.stdout || '').split(/\r?\n/).forEach(line => {
      const cells = line.match(/"([^"]*)"/g);
      if (!cells || cells.length < 2) return;
      const pid = Number(cells[1].replace(/"/g, ''));
      if (pid) names.set(pid, cells[0].replace(/"/g, ''));
    });
  }
  const rows = [];
  String(res.stdout || '').split(/\r?\n/).forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (!parts.length) return;
    const proto = parts[0].toUpperCase();
    if (proto !== 'TCP' && proto !== 'TCPV6') return;
    let state = '';
    let pid = '';
    if (proto === 'TCP') {
      if (parts.length < 5) return;
      state = String(parts[3] || '').toUpperCase();
      pid = parts[4];
    } else {
      if (parts.length < 4) return;
      state = String(parts[3] || '').toUpperCase();
      pid = parts[4] || '';
    }
    if (state !== 'LISTENING' && state !== 'LISTEN') return;
    const local = parts[1];
    const cut = local.lastIndexOf(':');
    if (cut < 0) return;
    const address = local.slice(0, cut).replace(/^\[|\]$/g, '');
    const port = Number(local.slice(cut + 1));
    if (!port) return;
    rows.push({
      LocalAddress: address,
      LocalPort: port,
      OwningProcess: Number(pid) || null,
      ProcessName: names.get(Number(pid)) || null,
      Protocol: proto
    });
  });
  return rows.slice(0, 200);
}

let factsCache = { at: 0, data: null, pending: null };
let toolsCache = { at: 0, data: null };

async function toolsProbe() {
  if (toolsCache.data && Date.now() - toolsCache.at < 5 * 60 * 1000) return toolsCache.data;
  const names = ['msfconsole', 'nmap', 'curl', 'git', 'python', 'pip', 'node'];
  const results = {};
  for (const name of names) {
    const res = await run(IS_WIN ? 'where.exe' : 'which', [name], { timeout: 4000 });
    results[name] = res.ok ? String(res.stdout || '').split(/\r?\n/)[0].trim() : null;
  }
  toolsCache = { at: Date.now(), data: results };
  return results;
}

async function collectWindowsFacts() {
  if (!IS_WIN) return { windows: null, windowsError: 'non-Windows platform' };
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$ProgressPreference='SilentlyContinue'",
    "$o=[ordered]@{}",
    "$sys=Get-CimInstance Win32_OperatingSystem",
    "if($sys){",
    "  $inst=if($sys.InstallDate){$sys.InstallDate.ToString('yyyy-MM-dd')}else{$null}",
    "  $boot=if($sys.LastBootUpTime){$sys.LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss')}else{$null}",
    "  $o.os=[ordered]@{caption=$sys.Caption;version=$sys.Version;build=$sys.BuildNumber;installDate=$inst;lastBoot=$boot}",
    "}",
    "$o.user=[string]([string]$env:USERDOMAIN+'\\'+[string]$env:USERNAME)",
    "$o.processCount=@(Get-Process).Count",
    "$hf=@(Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 3 | ForEach-Object {",
    "  $d=if($_.InstalledOn){$_.InstalledOn.ToString('yyyy-MM-dd')}else{$null}",
    "  [pscustomobject]@{id=$_.HotFixID;date=$d}",
    "})",
    "$o.hotfixes=$hf",
    "$smb=Get-SmbServerConfiguration",
    "if($smb){$o.smb1=[bool]$smb.EnableSMB1Protocol;$o.smbSigning=[bool]$smb.RequireSecuritySignature}",
    "$rdp=Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server'",
    "if($rdp){$o.rdpEnabled=(-not [bool]$rdp.fDenyTSConnections)}",
    "$uac=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'",
    "if($uac){$o.uac=[ordered]@{enableLUA=[int]$uac.EnableLUA;consentPrompt=[int]$uac.ConsentPromptBehaviorAdmin}}",
    "$fw=@(Get-NetFirewallProfile | Select-Object Name,Enabled)",
    "if($fw.Count -gt 0){$o.firewall=$fw}",
    "$mp=Get-MpComputerStatus",
    "if($mp){$o.defender=[ordered]@{antivirus=[bool]$mp.AntivirusEnabled;realtime=[bool]$mp.RealTimeProtectionEnabled;signatureAge=$mp.AntivirusSignatureAge;version=$mp.AMServiceVersion}}",
    "$adm=@(Get-LocalGroupMember -Group 'Administrators' | Select-Object -ExpandProperty Name)",
    "if($adm.Count -gt 0){$o.admins=$adm}",
    "try{$sb=Confirm-SecureBootUEFI; if($null -ne $sb){$o.secureBoot=[bool]$sb}}catch{}",
    "$route=Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1",
    "if($route){$o.gateway=$route.NextHop;$o.iface=$route.InterfaceAlias}",
    "$dns=@(Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object {$_.ServerAddresses} | Select-Object -First 2)",
    "if($dns.Count -gt 0){$o.dns=@($dns | ForEach-Object {[pscustomobject]@{iface=$_.InterfaceAlias;servers=@($_.ServerAddresses)}})}",
    "$fwState=@(netsh advfirewall show allprofiles state 2>$null)",
    "if($fwState -and $fwState.Count -gt 0){$o.firewallRaw=$fwState}",
    "$o | ConvertTo-Json -Depth 6 -Compress"
  ].join('\n');
  const res = await run(PS, ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 25000 });
  const data = parseJsonLoose(res.stdout);
  if (!data) {
    return { windows: null, windowsError: (res.error || 'PowerShell audit returned no JSON').split('\n')[0] };
  }
  return { windows: data, windowsError: null };
}

async function hostFacts(force = false) {
  if (!force && factsCache.data && Date.now() - factsCache.at < 60000) return factsCache.data;
  if (!force && factsCache.pending) return factsCache.pending;

  const work = (async () => {
    const started = Date.now();
    const cpus = os.cpus();
    const windowsFacts = await collectWindowsFacts().catch(err => ({ windows: null, windowsError: String(err && err.message || err) }));
    const win = windowsFacts.windows || {};
    const nets = os.networkInterfaces();
    const nic = Object.entries(nets).map(([name, list]) => ({
      name,
      addresses: (list || []).filter(Boolean).map(addr => ({
        address: addr.address,
        family: addr.family,
        mac: addr.mac,
        internal: Boolean(addr.internal),
        netmask: addr.netmask,
        cidr: addr.cidr
      }))
    }));
    const tools = await toolsProbe().catch(() => ({}));
    const result = {
      ok: true,
      real: true,
      timestamp: Date.now(),
      os: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        type: os.type(),
        uptime: os.uptime(),
        bootTime: Date.now() - Math.round(os.uptime() * 1000),
        caption: (win.os && win.os.caption) || null,
        version: (win.os && win.os.version) || null,
        build: (win.os && win.os.build) || null,
        installDate: (win.os && win.os.installDate) || null,
        lastBoot: (win.os && win.os.lastBoot) || null,
        node: process.version
      },
      user: {
        name: os.userInfo().username,
        domain: process.env.USERDOMAIN || null,
        full: win.user || null,
        home: os.homedir()
      },
      cpu: {
        model: (cpus[0] && cpus[0].model) || null,
        cores: cpus.length,
        speedMHz: (cpus[0] && cpus[0].speed) || null
      },
      mem: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      nic,
      net: {
        gateway: win.gateway || null,
        interfaceAlias: win.iface || null,
        dnsServers: Array.isArray(win.dns)
          ? [...new Set(win.dns.flatMap(entry => Array.isArray(entry.servers) ? entry.servers : []))]
          : []
      },
      windows: {
        os: win.os || null,
        hotfixes: Array.isArray(win.hotfixes) ? win.hotfixes : [],
        processCount: Number.isFinite(win.processCount) ? win.processCount : null,
        firewall: Array.isArray(win.firewall) ? win.firewall : [],
        firewallRaw: Array.isArray(win.firewallRaw) ? win.firewallRaw : [],
        defender: win.defender || null,
        uac: win.uac || null,
        smb1: typeof win.smb1 === 'boolean' ? win.smb1 : null,
        smbSigning: typeof win.smbSigning === 'boolean' ? win.smbSigning : null,
        rdpEnabled: typeof win.rdpEnabled === 'boolean' ? win.rdpEnabled : null,
        admins: Array.isArray(win.admins) ? win.admins : null,
        secureBoot: typeof win.secureBoot === 'boolean' ? win.secureBoot : null
      },
      windowsError: windowsFacts.windowsError,
      tools,
      ms: Date.now() - started
    };
    return result;
  })();

  factsCache.pending = work;
  const result = await work;
  factsCache = { at: Date.now(), data: result, pending: null };
  return result;
}

/* ------------------------------------------------------------
   真实注入 / 参数审计（只打本机网关）
------------------------------------------------------------ */

const SQL_SIGNATURES = [
  /SQLSTATE\[[0-9A-Z]+\]/i,
  /You have an error in your SQL syntax/i,
  /unclosed quotation mark after the character string/i,
  /mysql_(?:query|fetch|connect|real_escape)/i,
  /SQLite3?::(?:exception|prepare)/i,
  /ORA-\d{4,5}/i,
  /PostgreSQL.{0,40}ERROR/i,
  /SequelizeDatabaseError/i,
  /Microsoft OLE DB Provider for ODBC/i
];
const TRAVERSAL_SIGNATURES = [
  /\[fonts\]/i,
  /\[extensions\]/i,
  /for 16-bit app support/i,
  /root:x:0:0:/,
  /;\s*for 16-bit app support/i
];
const COMMAND_SIGNATURES = [
  /\buid=\d+\([a-z0-9_-]+\)/i,
  /^Volume in drive [A-Z]:/im,
  /^Directory of [A-Z]:\\/im,
  /nt authority\\system/i
];

const INJECTION_TARGETS = [
  { name: 'files.path', path: '/api/files', param: 'path', baseline: '.' },
  { name: 'file.path', path: '/api/file', param: 'path', baseline: 'README.md' }
];

const INJECTION_PAYLOADS = [
  { label: 'single-quote', value: "'" },
  { label: 'double-quote', value: '"' },
  { label: 'boolean-sqli', value: "' OR '1'='1" },
  { label: 'union-sqli', value: "1' UNION SELECT NULL--" },
  { label: 'traversal-slash', value: '../../../../Windows/win.ini' },
  { label: 'traversal-backslash', value: '..\\..\\..\\..\\Windows\\win.ini' },
  { label: 'absolute-path', value: 'C:\\Windows\\win.ini' },
  { label: 'double-encoded', value: '..%2f..%2fWindows%2fwin.ini' },
  { label: 'null-byte', value: '.%00.md' },
  { label: 'template-ssti', value: '{{7*7}}' },
  { label: 'shell-subst', value: '$(whoami)' },
  { label: 'pipe-cmd', value: '|whoami' },
  { label: 'time-sqli', value: "1' AND SLEEP(1)--" },
  { label: 'xss-reflection', value: '<script>alert(1)</script>' }
];

function detectVerdict(test, baseline) {
  const body = String(test.body || '');
  if (TRAVERSAL_SIGNATURES.some(re => re.test(body))) return { verdict: 'traversal-success', severity: 'critical', note: '响应包含目标系统文件内容' };
  if (SQL_SIGNATURES.some(re => re.test(body))) return { verdict: 'sql-error', severity: 'high', note: '响应包含数据库错误特征' };
  if (COMMAND_SIGNATURES.some(re => re.test(body))) return { verdict: 'command-output', severity: 'critical', note: '响应包含命令执行输出' };
  if (test.status && test.status >= 500) return { verdict: 'server-error', severity: 'medium', note: `服务端 ${test.status}` };
  if (baseline && baseline.ms != null && test.ms != null && test.ms - baseline.ms > 900) {
    return { verdict: 'timing-anomaly', severity: 'medium', note: `比基线慢 ${Math.round(test.ms - baseline.ms)} ms` };
  }
  if (body.includes(test.payload) && String(test.payload).length > 3) {
    return { verdict: 'reflected', severity: 'low', note: '参数值原样回显' };
  }
  if (baseline && baseline.status === test.status && baseline.hash === test.hash) {
    return { verdict: 'no-change', severity: 'info', note: '响应与基线一致' };
  }
  if (test.status && [400, 401, 403, 404, 405].includes(test.status)) {
    return { verdict: 'rejected', severity: 'info', note: `被拒绝（${test.status}）` };
  }
  if (test.status && test.status < 400) return { verdict: 'accepted', severity: 'medium', note: '参数被接受但无异常特征' };
  return { verdict: 'unknown', severity: 'info', note: '无法判定' };
}

function sha1(text) {
  return require('crypto').createHash('sha1').update(String(text)).digest('hex');
}

async function injectionAudit(baseUrl, cookieHeader) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('local gateway URL expected');
  const cookie = cookieHeader ? { cookie: String(cookieHeader) } : {};
  const started = Date.now();
  const tests = [];
  const findings = [];

  async function send(path, param, value, label) {
    const url = `${base}${path}?${param}=${encodeURIComponent(value)}`;
    const t0 = process.hrtime.bigint();
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        cache: 'no-store',
        headers: cookie,
        signal: AbortSignal.timeout(6000)
      });
      const body = await res.text().catch(() => '');
      return {
        label,
        status: res.status,
        ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100,
        bytes: Buffer.byteLength(body),
        hash: sha1(body),
        body: body.slice(0, 6000),
        payload: value,
        url: url.replace(base, ''),
        error: null
      };
    } catch (err) {
      return {
        label,
        status: null,
        ms: null,
        bytes: 0,
        hash: null,
        body: '',
        payload: value,
        url: url.replace(base, ''),
        error: String(err && err.message || err)
      };
    }
  }

  for (const target of INJECTION_TARGETS) {
    const baseline = await send(target.path, target.param, target.baseline, 'baseline');
    const row = { target: target.name, baseline: { status: baseline.status, ms: baseline.ms, bytes: baseline.bytes, error: baseline.error }, tests: [] };
    for (const payload of INJECTION_PAYLOADS) {
      const result = await send(target.path, target.param, payload.value, payload.label);
      const verdict = detectVerdict(result, baseline);
      row.tests.push({
        payload: payload.label,
        value: payload.value,
        status: result.status,
        ms: result.ms,
        bytes: result.bytes,
        verdict: verdict.verdict,
        severity: verdict.severity,
        note: result.error || verdict.note
      });
      if (verdict.severity === 'critical' || verdict.severity === 'high' || verdict.severity === 'medium') {
        findings.push({
          id: `INJ-${findings.length + 1}`,
          sev: verdict.severity,
          title: `${target.name} · ${verdict.verdict}`,
          evidence: `${target.param}=${payload.value} → ${result.status || 'ERR'} · ${verdict.note}`,
          refs: []
        });
      }
    }
    tests.push(row);
  }

  const total = tests.reduce((sum, row) => sum + row.tests.length, 0);
  const anomalies = findings.length;
  return {
    ok: true,
    real: true,
    base,
    scope: 'loopback',
    targets: INJECTION_TARGETS.map(t => `${t.name} (${t.param})`),
    tests,
    summary: {
      parameters: INJECTION_TARGETS.length,
      payloads: total,
      anomalies,
      clean: anomalies === 0
    },
    findings,
    duration: Date.now() - started,
    timestamp: Date.now()
  };
}

/* ------------------------------------------------------------
   由真实观测推导结论（不引入任何虚构数据）
------------------------------------------------------------ */

function refFor(kevCatalog, id) {
  const entry = kevCatalog && kevCatalog.map ? kevCatalog.map.get(String(id).toUpperCase()) : null;
  return {
    id,
    kev: entry ? {
      dateAdded: entry.dateAdded || null,
      name: entry.name || null,
      ransomware: entry.ransomware || null
    } : null
  };
}

function daysSince(dateText) {
  if (!dateText) return null;
  const parsed = new Date(String(dateText).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((Date.now() - parsed.getTime()) / 86400000);
}

function buildFindings(data) {
  const { audit, scan, web, policy, kev } = data || {};
  const findings = [];
  const add = (sev, title, evidence, refs = []) => {
    findings.push({
      id: `VULN-${String(findings.length + 1).padStart(3, '0')}`,
      sev,
      title,
      evidence,
      refs,
      real: true
    });
  };

  /* 系统姿态 */
  if (audit && audit.ok) {
    const def = audit.defender || {};
    if (def.antivirus === false || def.realtime === false) {
      add('high', 'Defender 实时保护未完整启用', `antivirus=${def.antivirus ? 'ON' : 'OFF'} · realtime=${def.realtime ? 'ON' : 'OFF'} · 特征库 ${def.signatureAge ?? '--'} 天`);
    } else if (Number.isFinite(def.signatureAge) && def.signatureAge > 3) {
      add('medium', 'Defender 特征库过期', `AntivirusSignatureAge=${def.signatureAge} 天`);
    }
    const fw = Array.isArray(audit.firewall) ? audit.firewall : [];
    const off = fw.filter(profile => !Number(profile.Enabled));
    if (fw.length && off.length) {
      add('high', '防火墙配置档被关闭', `关闭：${off.map(p => p.Name).join(', ')} · 共 ${fw.length} 个配置档`);
    } else if (!fw.length) {
      add('info', '防火墙状态不可读', 'Get-NetFirewallProfile 无返回（通常需要管理员权限），无法确认防火墙状态');
    }
    if (audit.uac && Number(audit.uac.enableLUA) === 0) {
      add('high', 'UAC 已禁用', `EnableLUA=${audit.uac.enableLUA} · ConsentPromptBehaviorAdmin=${audit.uac.consentPrompt}`);
    }
    if (audit.smb1 === true) {
      add('critical', 'SMBv1 已启用', 'Get-SmbServerConfiguration.EnableSMB1Protocol=true（MS17-010 利用面）', [refFor(kev, 'CVE-2017-0144')]);
    }
    if (audit.smbSigning === false) {
      add('medium', 'SMB 签名非强制', 'RequireSecuritySignature=false，可被中间人重放/篡改');
    }
    if (audit.rdp === true) {
      const rdpExposed = (audit.listening || []).some(p => Number(p.LocalPort) === 3389 && !['127.0.0.1', '::1'].includes(String(p.LocalAddress)));
      add(rdpExposed ? 'high' : 'medium', '远程桌面已启用', `fDenyTSConnections=0 · 3389 ${rdpExposed ? '在所有接口监听' : '仅在回环/本地监听'}`, [refFor(kev, 'CVE-2019-0708')]);
    }
    const lastFix = Array.isArray(audit.hotfixes) && audit.hotfixes.length ? audit.hotfixes[0] : audit.hotfix;
    const patchAge = lastFix ? daysSince(lastFix.date) : null;
    if (patchAge != null && patchAge > 120) {
      add(patchAge > 365 ? 'high' : 'medium', '系统补丁长期未更新', `最近补丁 ${lastFix.id || '--'} · ${lastFix.date || '--'} · 已 ${patchAge} 天`);
    }
    if (lastFix && lastFix.id) {
      findings.push({ id: '__info_patch', sev: 'info', title: '最近补丁', evidence: `${lastFix.id} · ${lastFix.date || '--'}`, refs: [], real: true, informational: true });
    }
  } else if (audit && !audit.ok) {
    add('info', '本机安全姿态不可读', audit.error || 'audit unavailable');
  }

  /* 端口暴露 */
  const listeners = (audit && Array.isArray(audit.listening)) ? audit.listening : [];
  const sensitive = new Set([445, 3389, 135, 139, 5985, 5986, 22, 3306, 5432, 6379, 9200, 2375, 27017]);
  const exposed = listeners.filter(p => sensitive.has(Number(p.LocalPort)) && !['127.0.0.1', '::1'].includes(String(p.LocalAddress)));
  exposed.forEach(p => {
    add('high', `敏感端口 ${p.LocalPort} 在所有接口监听`, `${p.ProcessName || 'pid ' + (p.OwningProcess || '--')} · ${p.LocalAddress}:${p.LocalPort}`);
  });
  if (scan && Array.isArray(scan.ports)) {
    const open = scan.ports.filter(p => p.state === 'open');
    if (open.length) {
      findings.push({
        id: '__info_ports',
        sev: 'info',
        title: '回环开放端口',
        evidence: open.map(p => `${p.port}/${p.service}`).join(' · '),
        refs: [],
        real: true,
        informational: true
      });
    }
  }

  /* Web 层 */
  if (web && web.ok) {
    if (web.missing && web.missing.length) {
      add('low', 'HTTP 响应缺少安全头', `缺失：${web.missing.join(' / ')}`);
    }
    if (web.security && web.security.cors === '*') {
      add('low', 'CORS 允许任意来源', 'Access-Control-Allow-Origin: *（真实响应头）');
    }
    if (web.security && !web.security.server && !web.security.poweredBy) {
      findings.push({ id: '__info_http', sev: 'info', title: '服务端指纹', evidence: '未发送 Server / X-Powered-By（真实响应头缺省）', refs: [], real: true, informational: true });
    }
    if (web.auth && web.auth.unauthenticatedApi === 401) {
      findings.push({ id: '__info_authapi', sev: 'info', title: 'API 鉴权', evidence: '未认证访问 /api/files 返回 401', refs: [], real: true, informational: true });
    }
    if (web.auth && web.auth.unauthenticatedApi === 200) {
      add('critical', '数据 API 未鉴权', '未携带会话访问 /api/files 返回 200（真实请求验证）');
    }
  }

  /* 传输与会话 */
  if (policy) {
    if (policy.usesDefaultCredential) {
      add('high', '使用文档公开的默认口令', `账号 ${policy.user} · 口令等于 README 公开默认值 · 来源：${policy.credentialSource}`);
    }
    if (policy.transport === 'http' && policy.bindAllInterfaces) {
      add('medium', '网关以明文 HTTP 暴露到所有网卡', `监听 ${policy.bind} · Cookie Secure=false · 局域网可嗅探`);
    }
    if (policy.cookie && policy.cookie.secure === false) {
      add('low', '会话 Cookie 缺少 Secure 标记', 'HttpOnly=true · SameSite=Lax · Secure=false（HTTP 传输下可被同网段嗅探）');
    }
    if (policy.sessionsInMemory) {
      findings.push({ id: '__info_session', sev: 'info', title: '会话存储', evidence: `内存会话 · TTL ${policy.sessionTtlHours} 小时 · 重启即失效`, refs: [], real: true, informational: true });
    }
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => severityRank[a.sev] - severityRank[b.sev]);
  let vulnIndex = 0;
  let infoIndex = 0;
  findings.forEach(finding => {
    if (finding.informational) finding.id = `INFO-${String(++infoIndex).padStart(2, '0')}`;
    else finding.id = `VULN-${String(++vulnIndex).padStart(3, '0')}`;
  });
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach(f => { counts[f.sev] = (counts[f.sev] || 0) + 1; });
  return { findings, counts };
}

/* ------------------------------------------------------------
   LAB ATTACK · 真实工具执行器
   ------------------------------------------------------------
   约束写在代码里，不写在文档里：
    - 白名单靶机已移除（靶机限制/ 目录）；现在只接受终端里直接给的 URL
    - 只调用真实二进制（PATH 或 vendor/），缺失时返回真实错误与安装方式
    - 不生成反弹 shell、不做持久化
------------------------------------------------------------ */

const TARGETS_FILE = path.join(__dirname, '靶机限制', 'lab-targets.json');
const LAB_WORDLIST = path.join(__dirname, '靶机限制', 'lab-wordlist.txt');
const SQLMAP_OUTPUT = path.join(__dirname, 'tools', 'sqlmap-output');
const SQLMAP_TIMEOUT = 240000;
const HYDRA_TIMEOUT = 180000;
const MSF_TIMEOUT = 180000;

const DEFAULT_HYDRA_FORM = '/login:user=^USER^&pass=^PASS^:F=invalid';
const LAB_REMOVED = 'lab target removed · pass a full URL';

/* 白名单靶机已被删除；这里保留兜底结构，供配置恢复后使用 */
const BUILTIN_TARGET = labTarget
  ? Object.freeze({
    id: 'lab',
    label: '内置靶机',
    base: `http://${labTarget.TARGET_HOST}:${labTarget.TARGET_PORT}`,
    host: labTarget.TARGET_HOST,
    port: labTarget.TARGET_PORT,
    sqlmapPath: '/item?id=1',
    loginPath: '/login',
    hydraPort: labTarget.TARGET_PORT,
    hydraForm: DEFAULT_HYDRA_FORM
  })
  : null;

function validateTarget(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('target 必须是对象');
  const id = String(raw.id || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) throw new Error(`target id 非法：${id || '(空)'}`);
  let url;
  try {
    url = new URL(String(raw.base || ''));
  } catch (err) {
    throw new Error(`${id}：base 不是合法 URL`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${id}：base 只支持 http / https`);
  const sqlmapPath = String(raw.sqlmapPath || '/');
  if (!sqlmapPath.startsWith('/')) throw new Error(`${id}：sqlmapPath 必须以 / 开头`);
  const defaultPort = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  const hydraPort = Number(raw.hydraPort == null ? defaultPort : raw.hydraPort);
  if (!Number.isInteger(hydraPort) || hydraPort < 1 || hydraPort > 65535) throw new Error(`${id}：hydraPort 非法`);
  const hydraForm = String(raw.hydraForm || '');
  if (hydraForm && (!hydraForm.startsWith('/') || !hydraForm.includes('^USER^') || !hydraForm.includes('^PASS^'))) {
    throw new Error(`${id}：hydraForm 必须形如 /login:user=^USER^&pass=^PASS^:F=invalid`);
  }
  return {
    id,
    label: String(raw.label || id),
    base: `${url.protocol}//${url.host}`,
    host: url.hostname,
    port: defaultPort,
    sqlmapPath,
    loginPath: String(raw.loginPath || '/login'),
    hydraPort,
    hydraForm: hydraForm || DEFAULT_HYDRA_FORM
  };
}

let targetsCache = { at: -1, data: null };

function loadTargets() {
  let stamp = 0;
  try {
    stamp = fs.statSync(TARGETS_FILE).mtimeMs;
  } catch (err) {
    stamp = 0;
  }
  if (targetsCache.data && targetsCache.at === stamp) return targetsCache.data;
  let error = null;
  let targets = [];
  if (!stamp) {
    error = BUILTIN_TARGET
      ? '靶机限制/lab-targets.json 不存在 · 已回退到内置靶机'
      : LAB_REMOVED;
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : (parsed && parsed.targets);
      if (!Array.isArray(list) || !list.length) throw new Error('targets 必须是非空数组');
      targets = list.map(validateTarget);
      const seen = new Set();
      targets.forEach(item => {
        if (seen.has(item.id)) throw new Error(`target id 重复：${item.id}`);
        seen.add(item.id);
      });
    } catch (err) {
      error = `靶机限制/lab-targets.json 无效：${String(err && err.message || err)}${BUILTIN_TARGET ? ' · 已回退到内置靶机' : ' · 无可用目标'}`;
      targets = [];
    }
  }
  if (!targets.length && BUILTIN_TARGET) targets = [BUILTIN_TARGET];
  const data = { targets, error };
  targetsCache = { at: stamp, data };
  return data;
}

function getTarget(targetId) {
  const { targets } = loadTargets();
  if (!targets.length) return { target: null, error: LAB_REMOVED };
  const id = String(targetId || '').trim();
  if (!id) return { target: targets[0], error: null };
  const found = targets.find(item => item.id === id);
  if (found) return { target: found, error: null };
  return { target: null, error: `未知 target：${id} · 可用 ${targets.map(item => item.id).join(', ')}` };
}

function targetSummary(target) {
  return {
    id: target.id,
    label: target.label,
    base: target.base,
    host: target.host,
    port: target.port,
    sqlmapUrl: `${target.base}${target.sqlmapPath}`,
    loginUrl: `${target.base}${target.loginPath}`,
    hydraPort: target.hydraPort
  };
}


/* 临时目标：只有本机发起的请求才允许（server.js 侧已校验来源），这里只做格式校验。
   sqlmap 需要带参数的 URL，所以必须写明查询串，例如 /item?id=1 */
function parseAdhocTarget(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return { target: null, error: null };
  if (text.length > 2048) return { target: null, error: 'URL too long (max 2048)' };
  let url;
  try {
    url = new URL(text);
  } catch (err) {
    return { target: null, error: `not a valid URL: ${text}` };
  }
  if (!/^https?:$/.test(url.protocol)) return { target: null, error: 'only http / https is supported' };
  if (url.username || url.password) return { target: null, error: 'credentials in the URL are not allowed' };
  const pathAndQuery = `${url.pathname || '/'}${url.search || ''}`;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return {
    target: {
      id: 'adhoc',
      label: '临时目标',
      base: `${url.protocol}//${url.host}`,
      host: url.hostname,
      port,
      sqlmapPath: pathAndQuery,
      loginPath: '/login',
      hydraPort: port,
      hydraForm: DEFAULT_HYDRA_FORM,
      adhoc: true,
      hasQuery: !!url.search
    },
    error: null
  };
}

let toolCache = { at: 0, tools: null, wordlist: null };

const TOOLS_DIR = path.join(__dirname, 'tools');

/* tools/ 里直接放二进制就能被识别，优先于 PATH */
function findLocalBinary(name) {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const ext of exts) {
    const candidate = path.join(TOOLS_DIR, `${name}${ext}`);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (err) { /* ignore */ }
  }
  return null;
}

async function commandExists(name) {
  const local = findLocalBinary(name);
  if (local) return local;
  /* Windows 下 execFile 不走 PATHEXT，必须显式调用 where.exe */
  const finder = IS_WIN ? 'where.exe' : 'which';
  const result = await run(finder, [name], { timeout: 5000 });
  if (!result.ok) return null;
  const first = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || '';
  return first || name;
}

async function resolvePython() {
  /* 优先用 tools/python 里的便携版，其次系统 Python */
  const localPy = path.join(TOOLS_DIR, 'python', IS_WIN ? 'python.exe' : 'bin/python3');
  const candidates = [localPy].concat(IS_WIN ? ['python', 'python3', 'py'] : ['python3', 'python']);
  for (const candidate of candidates) {
    const found = candidate === localPy
      ? (fs.existsSync(candidate) ? candidate : null)
      : await commandExists(candidate);
    if (!found) continue;
    const probe = await run(found, ['--version'], { timeout: 8000 });
    if (probe.ok && /python\s*3/i.test(`${probe.stdout}${probe.stderr}`)) {
      return { name: candidate === localPy ? 'tools/python' : candidate, file: found, version: `${probe.stdout}${probe.stderr}`.trim() };
    }
  }
  return null;
}

/* 在终端里跑一段 Python：一次性执行，带超时与输出上限 */
async function runPython(code, timeoutMs = 15000) {
  const src = String(code == null ? '' : code);
  if (!src.trim()) return { ok: false, real: true, error: 'empty code' };
  if (src.length > 20000) return { ok: false, real: true, error: 'code too long (max 20000 chars)' };
  const py = await resolvePython();
  if (!py) return { ok: false, real: true, error: 'python 3 not found', hint: 'put the embeddable build under tools/python/' };
  const started = Date.now();
  const result = await run(py.file, ['-c', src], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  const timedOut = /timed? ?out|ETIMEDOUT|killed/i.test(result.error || '');
  return {
    ok: result.ok,
    real: true,
    python: py.version,
    via: py.name,
    code: src.length > 200 ? `${src.slice(0, 200)}…` : src,
    durationMs: Date.now() - started,
    exitCode: result.code,
    timedOut,
    stdout: limitText(result.stdout, 20000),
    stderr: limitText(result.stderr, 20000),
    error: result.ok ? null : (timedOut ? `timeout after ${timeoutMs} ms` : (result.error || 'python failed'))
  };
}

function findFileUnder(root, fileName, maxDepth = 3) {
  if (!fs.existsSync(root)) return null;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) return full;
      if (entry.isDirectory() && depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

function findSqlmapEntry() {
  return findFileUnder(path.join(TOOLS_DIR, 'sqlmap'), 'sqlmap.py', 3)
    || findFileUnder(path.join(__dirname, 'vendor', 'sqlmap'), 'sqlmap.py', 3);
}

/* ------------------------------------------------------------
   TOOLKIT · 工具清单（只做识别与状态，不做任意命令执行）
   ------------------------------------------------------------ */
const TOOLKIT = [
  { id: 'sqlmap', name: 'sqlmap', bin: 'sqlmap', hint: 'tools/sqlmap（已内置）' },
  { id: 'volatility', name: 'Volatility 3', bin: 'vol', hint: 'tools/py + tools/run-vol.cmd（已内置）' },
  { id: 'nmap', name: 'Nmap', bin: 'nmap', hint: '解压到 tools/nmap/ 或放进 PATH' },
  { id: 'ffuf', name: 'ffuf', bin: 'ffuf', hint: 'winget install ffuf.ffuf，或放进 tools/' },
  { id: 'nikto', name: 'Nikto', bin: 'nikto', hint: '需 Strawberry Perl + nikto.pl' },
  { id: 'gobuster', name: 'Gobuster', bin: 'gobuster', hint: 'GitHub release 解压到 tools/' },
  { id: 'dirb', name: 'Dirb', bin: 'dirb', hint: '需 Perl' },
  { id: 'hydra', name: 'Hydra', bin: 'hydra', hint: '无官方 Windows 构建，需 WSL' },
  { id: 'hashcat', name: 'Hashcat', bin: 'hashcat', hint: 'hashcat.net 下载后放进 tools/' },
  { id: 'john', name: 'John the Ripper', bin: 'john', hint: 'openwall.com/john 下载后放进 tools/' },
  { id: 'exiftool', name: 'ExifTool', bin: 'exiftool', hint: '解压到 tools/exiftool/' },
  { id: 'testdisk', name: 'TestDisk', bin: 'testdisk_win', hint: '解压到 tools/testdisk/' },
  { id: 'tshark', name: 'Wireshark / tshark', bin: 'tshark', hint: 'winget install WiresharkFoundation.Wireshark' },
  { id: 'msfconsole', name: 'Metasploit', bin: 'msfconsole', hint: '官方 MSI，需管理员' },
  { id: 'bettercap', name: 'Bettercap', bin: 'bettercap', hint: 'bettercap.org 下载 Windows 构建' },
  { id: 'cherrytree', name: 'CherryTree', bin: 'cherrytree', hint: 'winget install Giuspen.Cherrytree' }
];

function findToolBinary(entry) {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = [path.join(TOOLS_DIR, entry.id), TOOLS_DIR];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${entry.bin}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch (err) { /* ignore */ }
    }
  }
  return null;
}

let toolkitCache = { at: 0, data: null };

async function toolkitStatus(force = false) {
  if (!force && toolkitCache.data && Date.now() - toolkitCache.at < 15000) return toolkitCache.data;
  const rows = [];
  for (const entry of TOOLKIT) {
    let file = null;
    let via = null;
    if (entry.id === 'sqlmap') {
      file = findSqlmapEntry();
      via = file ? 'tools/sqlmap' : null;
    } else if (entry.id === 'volatility') {
      const volPath = path.join(TOOLS_DIR, 'py', 'bin', IS_WIN ? 'vol.exe' : 'vol');
      if (fs.existsSync(volPath)) { file = volPath; via = 'tools/py'; }
    } else {
      file = findToolBinary(entry);
      if (file) via = 'tools/';
      else { file = await commandExists(entry.bin); via = file ? 'PATH' : null; }
    }
    rows.push({
      id: entry.id,
      name: entry.name,
      available: !!file,
      path: file || null,
      via,
      hint: entry.hint
    });
  }
  const data = {
    ok: true,
    real: true,
    installed: rows.filter(r => r.available).length,
    total: rows.length,
    tools: rows
  };
  toolkitCache = { at: Date.now(), data };
  return data;
}

/* 真实 Nmap 调用：只接受合法的 host / ports，不做任意参数透传 */async function nmapRun(host, ports) {
  const target = String(host || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,253}$/.test(target)) {
    return { ok: false, real: true, tool: 'nmap', error: 'invalid host' };
  }
  const portSpec = String(ports || '').trim();
  if (portSpec && !/^[0-9,\-]{1,120}$/.test(portSpec)) {
    return { ok: false, real: true, tool: 'nmap', error: 'invalid port list' };
  }
  const entry = TOOLKIT.find(t => t.id === 'nmap');
  const file = findToolBinary(entry) || await commandExists('nmap');
  if (!file) {
    return {
      ok: false,
      real: true,
      tool: 'nmap',
      error: 'nmap binary not found',
      hint: 'unzip nmap-*-win32.zip into tools/nmap/'
    };
  }
  const args = ['-Pn', '-sT', '--host-timeout', '60s'];
  if (portSpec) args.push('-p', portSpec);
  args.push(target);
  const started = Date.now();
  const result = await run(file, args, { timeout: 150000, maxBuffer: 8 * 1024 * 1024 });
  return {
    ok: result.ok,
    real: true,
    tool: 'nmap',
    command: [file, ...args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    target,
    exitCode: result.code,
    durationMs: Date.now() - started,
    stdout: limitText(result.stdout),
    stderr: limitText(result.stderr),
    error: result.ok ? null : (result.error || 'nmap failed')
  };
}

async function resolveSqlmap(python) {
  const local = findSqlmapEntry();
  const via = local && local.includes(`${path.sep}tools${path.sep}`) ? 'tools/sqlmap' : 'vendor/sqlmap';
  if (local && python) {
    return { available: true, via, file: python.file, prefix: [local] };
  }
  const native = await commandExists('sqlmap');
  if (native) return { available: true, via: 'PATH', file: native, prefix: [] };
  if (local && !python) {
    return { available: false, via, error: 'sqlmap source found in tools/ but no python 3 interpreter' };
  }
  return { available: false, via: null, error: 'sqlmap not installed' };
}

async function detectTools() {
  if (toolCache.tools && Date.now() - toolCache.at < 20000) return toolCache;
  const [python, hydraBin, msfBin] = await Promise.all([
    resolvePython(),
    commandExists('hydra'),
    commandExists('msfconsole')
  ]);
  const sqlmap = await resolveSqlmap(python);
  toolCache = {
    at: Date.now(),
    tools: {
      sqlmap: {
        available: !!sqlmap.available,
        via: sqlmap.via || null,
        version: null,
        error: sqlmap.error || null,
        hint: sqlmap.available ? null : 'pip install sqlmap --target tools/sqlmap'
      },
      hydra: {
        available: !!hydraBin,
        via: hydraBin ? 'PATH' : null,
        error: hydraBin ? null : 'hydra has no official Windows build',
        hint: hydraBin ? null : 'drop hydra.exe into tools/ , or install it on WSL / Linux'
      },
      msfconsole: {
        available: !!msfBin,
        via: msfBin ? 'PATH' : null,
        error: msfBin ? null : 'Metasploit does not run natively on Windows',
        hint: msfBin ? null : 'drop msfconsole into tools/ , or use WSL / Kali'
      },
      python: python ? { available: true, name: python.name, version: python.version } : { available: false }
    },
    wordlist: fs.existsSync(LAB_WORDLIST)
      ? { path: '靶机限制/lab-wordlist.txt', entries: fs.readFileSync(LAB_WORDLIST, 'utf8').split(/\r?\n/).filter(Boolean).length }
      : { path: null, entries: 0 }
  };
  return toolCache;
}

async function attackTools() {
  const detected = await detectTools();
  /* 目标列表每次现读，配置文件改动立即反映到 lab 命令 */
  const targetSet = loadTargets();
  return {
    ok: true,
    real: true,
    scope: targetSet.targets.map(item => `${item.host}:${item.port}`).join(' · '),
    targets: targetSet.targets.map(targetSummary),
    targetError: targetSet.error,
    active: targetSet.targets.length ? targetSet.targets[0].id : null,
    labTarget: labTarget ? labTarget.status() : { ok: false, running: false, removed: true, host: null, port: null },
    tools: detected.tools,
    wordlist: detected.wordlist
  };
}

function limitText(text, limit = 14000) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  return `${value.slice(0, head)}\n… [中间截断 ${value.length - limit} 字符] …\n${value.slice(-tail)}`;
}

function parseSqlmap(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  const out = {
    vulnerable: /\bis vulnerable\b/i.test(text),
    parameter: (text.match(/Parameter:\s*([^\s(]+)\s*\(([^)]+)\)/i) || []).slice(1).join(' '),
    dbms: (text.match(/back-end DBMS:\s*(.+)/i) || [])[1] || null,
    banner: (text.match(/banner:\s*'?([^'\n]+)'?/i) || [])[1] || null,
    currentDb: (text.match(/current database:\s*'?([^'\n]+)'?/i) || [])[1] || null,
    currentUser: (text.match(/current user:\s*'?([^'\n]+)'?/i) || [])[1] || null,
    hostname: (text.match(/hostname:\s*'?([^'\n]+)'?/i) || [])[1] || null,
    databases: [],
    technologies: []
  };
  const dbs = text.match(/available databases \[(\d+)\]:\n([\s\S]*?)(?:\n\s*\n|$)/i);
  if (dbs) {
    out.databases = dbs[2].split(/\r?\n/)
      .map(line => line.trim().replace(/^\[\*\]\s*/, ''))
      .filter(Boolean);
  }
  const tablesBlock = text.match(/\[(\d+) tables?\]\n([\s\S]*?)(?:\n\s*\n|$)/i);
  if (tablesBlock) {
    out.tables = tablesBlock[2].split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^\|/.test(line))
      .map(line => line.replace(/\|/g, '').trim())
      .filter(Boolean);
  } else {
    out.tables = [];
  }
  const tablesDb = text.match(/fetching tables for database:\s*'([^']+)'/i);
  if (tablesDb) out.database = tablesDb[1];
  const tech = text.match(/back-end DBMS:[\s\S]*?\[\d+\]\s*([^\n]+)/i);
  if (tech && !out.dbms) out.dbms = tech[1].trim();
  return out;
}

async function sqlmapAttack(targetId, adhocUrl) {
  const adhoc = parseAdhocTarget(adhocUrl);
  if (adhoc.error) return { ok: false, real: true, tool: 'sqlmap', error: adhoc.error };
  const resolved = adhoc.target
    ? { target: adhoc.target, error: null }
    : getTarget(targetId);
  const { target, error: targetError } = resolved;
  if (!target) return { ok: false, real: true, tool: 'sqlmap', error: targetError };
  const tools = await attackTools();
  const entry = tools.tools.sqlmap;
  if (!entry.available) {
    return {
      ok: false,
      real: true,
      tool: 'sqlmap',
      target: `${target.base}${target.sqlmapPath}`,
      targetId: target.id,
      error: entry.error || 'sqlmap 未安装',
      hint: entry.hint
    };
  }
  const python = await resolvePython();
  const vendored = findSqlmapEntry();
  const targetUrl = `${target.base}${target.sqlmapPath}`;
  let file;
  let args;
  const common = [
    '-u', targetUrl,
    '--batch',
    '--disable-coloring',
    '--flush-session',
    '--level=1',
    '--risk=1',
    '--output-dir', SQLMAP_OUTPUT,
    '--banner',
    '--current-user',
    '--current-db',
    '--hostname',
    '--dbs',
    '--tables'
  ];
  if (vendored && python) {
    file = python.file;
    args = [vendored, ...common];
  } else {
    file = 'sqlmap';
    args = common;
  }
  const started = Date.now();
  const result = await run(file, args, { timeout: SQLMAP_TIMEOUT, maxBuffer: 16 * 1024 * 1024 });
  const stdout = limitText(`${result.stdout || ''}`);
  const stderr = limitText(`${result.stderr || ''}`);
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsed = parseSqlmap(combined);
  const timedOut = /timed? ?out|ETIMEDOUT/i.test(result.error || '');
  return {
    ok: result.ok || parsed.vulnerable,
    real: true,
    tool: 'sqlmap',
    via: entry.via,
    command: [file, ...args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    target: targetUrl,
    targetId: target.id,
    adhoc: !!target.adhoc,
    note: target.hasQuery === false ? 'URL 没有查询参数，sqlmap 可能找不到可注入点' : null,
    exitCode: result.code,
    durationMs: Date.now() - started,
    timedOut,
    stdout,
    stderr,
    parsed,
    error: result.ok || parsed.vulnerable ? null : (result.error || 'sqlmap 未报告注入点')
  };
}

function parseHydra(text, user) {
  const found = text.match(/\[(\d+)\]\[http-post-form\] host:\s*(\S+)\s+login:\s*(\S+)\s+password:\s*(\S+)/i);
  if (found) {
    return { success: true, port: Number(found[1]), host: found[2], user: found[3], password: found[4] };
  }
  const alt = text.match(/password:\s*(\S+)\s*$/im);
  if (alt && /valid password found/i.test(text)) {
    return { success: true, host: null, user, password: alt[1] };
  }
  return { success: false };
}

async function hydraAttack(opts = {}) {
  const adhoc = parseAdhocTarget(opts.adhocUrl);
  if (adhoc.error) return { ok: false, real: true, tool: 'hydra', error: adhoc.error };
  const resolved = adhoc.target ? { target: adhoc.target, error: null } : getTarget(opts.targetId || '');
  const target = resolved.target;
  if (!target) return { ok: false, real: true, tool: 'hydra', error: resolved.error };

  const user = /^[A-Za-z0-9_.-]{1,32}$/.test(String(opts.user || '')) ? String(opts.user) : 'admin';
  const wordlist = String(opts.wordlist || '').trim();
  if (!wordlist) {
    return {
      ok: false,
      real: true,
      tool: 'hydra',
      error: 'hydra needs a wordlist · usage: hydra <url> [user] [wordlist]',
      hint: 'one password per line'
    };
  }
  if (!fs.existsSync(wordlist)) {
    return { ok: false, real: true, tool: 'hydra', error: `wordlist not found: ${wordlist}` };
  }
  const form = String(opts.form || '').trim() || DEFAULT_HYDRA_FORM;
  if (!form.startsWith('/') || !form.includes('^USER^') || !form.includes('^PASS^')) {
    return { ok: false, real: true, tool: 'hydra', error: 'bad form template · expected /login:user=^USER^&pass=^PASS^:F=invalid' };
  }

  const tools = await attackTools();
  if (!tools.tools.hydra.available) {
    return {
      ok: false,
      real: true,
      tool: 'hydra',
      target: `${target.base}${target.loginPath}`,
      targetId: target.id,
      error: tools.tools.hydra.error,
      hint: tools.tools.hydra.hint
    };
  }

  const file = 'hydra';
  const args = [
    '-l', user,
    '-P', wordlist,
    '-s', String(target.hydraPort),
    '-f',
    '-t', '4',
    '-V',
    target.host,
    'http-post-form',
    form
  ];
  const started = Date.now();
  const result = await run(file, args, { timeout: HYDRA_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsed = parseHydra(combined, user);
  return {
    ok: !!parsed.success,
    real: true,
    tool: 'hydra',
    command: [file, ...args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    target: `${target.host}:${target.hydraPort}${target.loginPath}`,
    targetId: target.id,
    exitCode: result.code,
    durationMs: Date.now() - started,
    stdout: limitText(result.stdout),
    stderr: limitText(result.stderr),
    parsed,
    error: parsed.success ? null : (result.error || '字典跑完未命中')
  };
}

async function msfAttack(targetId, adhocUrl) {
  const adhoc = parseAdhocTarget(adhocUrl);
  if (adhoc.error) return { ok: false, real: true, tool: 'msfconsole', error: adhoc.error };
  const resolved = adhoc.target ? { target: adhoc.target, error: null } : getTarget(targetId);
  const target = resolved.target;
  if (!target) return { ok: false, real: true, tool: 'msfconsole', error: resolved.error };
  const tools = await attackTools();
  if (!tools.tools.msfconsole.available) {
    return {
      ok: false,
      real: true,
      tool: 'msfconsole',
      target: `${target.host}:${target.port}`,
      targetId: target.id,
      error: tools.tools.msfconsole.error,
      hint: tools.tools.msfconsole.hint
    };
  }
  const file = 'msfconsole';
  const script = [
    'use auxiliary/scanner/http/http_version',
    `set RHOSTS ${target.host}`,
    `set RPORT ${target.port}`,
    'set THREADS 1',
    'run',
    'exit'
  ].join('; ');
  const args = ['-q', '-n', '-x', script];
  const started = Date.now();
  const result = await run(file, args, { timeout: MSF_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
  return {
    ok: result.ok,
    real: true,
    tool: 'msfconsole',
    module: 'auxiliary/scanner/http/http_version',
    command: [file, ...args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    target: `${target.host}:${target.port}`,
    targetId: target.id,
    exitCode: result.code,
    durationMs: Date.now() - started,
    stdout: limitText(result.stdout),
    stderr: limitText(result.stderr),
    error: result.ok ? null : (result.error || 'msfconsole 执行失败')
  };
}

module.exports = {
  LOOPBACK,
  PORT_MAP,
  DEFAULT_PORTS,
  scanPorts,
  bannerGrab,
  tlsProbe,
  webFingerprint,
  httpRequest,
  dnsProbe,
  rdapProbe,
  pingProbe,
  topProcesses,
  listeningPorts,
  hostFacts,
  toolsProbe,
  injectionAudit,
  buildFindings,
  attackTools,
  sqlmapAttack,
  hydraAttack,
  msfAttack,
  toolkitStatus,
  nmapRun,
  runPython
};
