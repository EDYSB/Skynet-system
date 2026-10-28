/* ============================================================
   天网 · 身份核验网关
   ============================================================ */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const canvas = $('#gateCanvas');
  const ctx = canvas.getContext('2d');
  const form = $('#loginForm');
  const userInput = $('#user');
  const passInput = $('#pass');
  const errorEl = $('#gateError');
  const submitBtn = $('#gateSubmit');
  const panel = $('#gatePanel');
  const verify = $('#gateVerify');
  const verifyUser = $('#verifyUser');
  const verifyLog = $('#verifyLog');
  const voiceBtn = $('#voiceToggle');

  let voiceOn = true;
  let mapReady = false;
  let tintedMap = null;
  let W = 1, H = 1, DPR = 1;

  const NODES = [
    { name: 'BEIJING', lat: 39.9, lon: 116.4 },
    { name: 'SINGAPORE', lat: 1.35, lon: 103.8 },
    { name: 'FRANKFURT', lat: 50.1, lon: 8.7 },
    { name: 'VIRGINIA', lat: 38.9, lon: -77.4 },
    { name: 'SAO PAULO', lat: -23.5, lon: -46.6 },
    { name: 'SYDNEY', lat: -33.9, lon: 151.2 }
  ];
  const LINKS = [[0, 1], [0, 2], [2, 3], [3, 4], [1, 5], [3, 5], [0, 3]];

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function buildTintedMap() {
    if (!window.EARTH_TEXTURES || !window.EARTH_TEXTURES.night) return;
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.width;
      off.height = img.height;
      const o = off.getContext('2d');
      o.filter = 'grayscale(1) sepia(.2) hue-rotate(175deg) saturate(2.5) brightness(1.4)';
      o.drawImage(img, 0, 0);
      tintedMap = off;
      mapReady = true;
    };
    img.src = window.EARTH_TEXTURES.night;
  }

  function draw(ts) {
    requestAnimationFrame(draw);
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const mapW = Math.min(W * 0.92, Math.max(760, H * 1.9));
    const mapH = mapW / 2;
    const mx = (W - mapW) / 2;
    const my = H * 0.46 - mapH / 2 + 60;

    if (mapReady && tintedMap) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(tintedMap, 0, 0, tintedMap.width, tintedMap.height, mx, my, mapW, mapH);
      ctx.restore();
    }

    const veil = ctx.createLinearGradient(0, my, 0, my + mapH);
    veil.addColorStop(0, 'rgba(2,7,12,.25)');
    veil.addColorStop(0.55, 'rgba(2,7,12,.45)');
    veil.addColorStop(1, 'rgba(2,7,12,.75)');
    ctx.fillStyle = veil;
    ctx.fillRect(mx, my, mapW, mapH);

    ctx.strokeStyle = 'rgba(93,180,255,.07)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mapW, mapH);
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = mx + (lon + 180) / 360 * mapW;
      ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my + mapH); ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = my + (90 - lat) / 180 * mapH;
      ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx + mapW, y); ctx.stroke();
    }

    const project = (lat, lon) => [
      mx + (lon + 180) / 360 * mapW,
      my + (90 - lat) / 180 * mapH
    ];

    LINKS.forEach(([a, b], i) => {
      const p0 = project(NODES[a].lat, NODES[a].lon);
      const p1 = project(NODES[b].lat, NODES[b].lon);
      const midX = (p0[0] + p1[0]) / 2;
      const midY = Math.min(p0[1], p1[1]) - Math.abs(p1[0] - p0[0]) * 0.15 - 26;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.quadraticCurveTo(midX, midY, p1[0], p1[1]);
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(95,240,224,.22)' : 'rgba(93,180,255,.18)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const u = ((ts * 0.00008 + i * 0.21) % 1);
      const qx = (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * midX + u * u * p1[0];
      const qy = (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * midY + u * u * p1[1];
      ctx.beginPath();
      ctx.arc(qx, qy, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 === 0 ? '#5ff0e0' : '#5da9ff';
      ctx.shadowBlur = 8;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    NODES.forEach((n, i) => {
      const [x, y] = project(n.lat, n.lon);
      ctx.beginPath();
      ctx.arc(x, y, i === 0 ? 3.2 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#5ff0e0' : '#6da7dc';
      ctx.shadowBlur = 9;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '7px "Cascadia Mono", monospace';
      ctx.fillStyle = i === 0 ? 'rgba(180,245,240,.8)' : 'rgba(110,150,185,.55)';
      ctx.fillText(n.name, x + 7, y - 5);
    });

    // 扫描线
    const scanX = mx + ((ts * 0.035) % mapW);
    const grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 8, 0);
    grad.addColorStop(0, 'rgba(95,240,224,0)');
    grad.addColorStop(0.8, 'rgba(95,240,224,.10)');
    grad.addColorStop(1, 'rgba(95,240,224,.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(scanX - 40, my, 48, mapH);

    // 大范围轨道环
    ctx.strokeStyle = 'rgba(93,180,255,.04)';
    ctx.lineWidth = 1;
    const cx = W * 0.28, cy = H * 0.5;
    [120, 220, 340, 500].forEach(r => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function clock() {
    const el = $('#gateClock');
    if (!el) return;
    const d = new Date();
    el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  function typeConsole() {
    const el = $('#gateConsole');
    if (!el) return;
    const lines = [
      ['> secure gateway 0x7F3A · handshake', ''],
      ['> quantum tunnel ............ <span class="ok">OK</span>', ''],
      ['> biometric sensor .......... <span class="ok">READY</span>', ''],
      ['> orbital uplink ............ <span class="ok">12 / 12</span>', ''],
      ['> operator database ......... <span class="ok">MOUNTED</span>', ''],
      ['> awaiting operator credentials', 'dim']
    ];
    el.innerHTML = '';
    lines.forEach(([text, cls], i) => {
      setTimeout(() => {
        const line = document.createElement('div');
        line.className = cls;
        line.innerHTML = text;
        el.appendChild(line);
      }, 240 * (i + 1));
    });
  }

  function speakWelcome() {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    try {
      const utter = new SpeechSynthesisUtterance('身份核验通过。欢迎回来，operator。');
      utter.lang = 'zh-CN';
      utter.rate = 0.92;
      utter.pitch = 0.82;
      utter.volume = 0.9;
      const voices = window.speechSynthesis.getVoices();
      const zh = voices.find(v => /zh|Chinese/i.test(`${v.lang} ${v.name}`));
      if (zh) utter.voice = zh;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch (err) { /* silent */ }
  }

  function showVerified(user) {
    panel.classList.add('verified');
    verify.setAttribute('aria-hidden', 'false');
    verifyUser.textContent = user || 'operator';
    const lines = [
      ['[ OK ] credential hash verified', 'ok'],
      ['[ OK ] operator recognized', 'ok'],
      ['[ OK ] encryption tunnel established', 'ok'],
      ['[ OK ] access granted · level OMEGA', 'ok'],
      ['[ .. ] entering skynet…', 'dim']
    ];
    verifyLog.innerHTML = '';
    lines.forEach(([text, cls], i) => {
      setTimeout(() => {
        const div = document.createElement('div');
        div.className = cls;
        div.textContent = text;
        verifyLog.appendChild(div);
      }, 280 * (i + 1));
    });
    speakWelcome();
    setTimeout(() => {
      window.location.replace('/index.html');
    }, 4200);
  }

  async function submit(e) {
    e.preventDefault();
    if (submitBtn.disabled) return;
    const user = userInput.value.trim();
    const pass = passInput.value.trim();
    if (!user) {
      errorEl.textContent = '请输入操作员账号';
      userInput.focus();
      panel.classList.remove('shake');
      void panel.offsetWidth;
      panel.classList.add('shake');
      return;
    }
    if (!pass) {
      errorEl.textContent = '请输入访问口令';
      passInput.focus();
      panel.classList.remove('shake');
      void panel.offsetWidth;
      panel.classList.add('shake');
      return;
    }

    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = '正在核验…';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showVerified(data.user || user);
        return;
      }
      if (res.status === 429) {
        errorEl.textContent = `尝试次数过多 · 请等待 ${data.retryAfter || 60} 秒`;
      } else if (res.status === 401) {
        errorEl.textContent = '账号或口令不正确（口令区分大小写）';
      } else {
        errorEl.textContent = data.error || '网关拒绝了本次核验';
      }
    } catch (err) {
      errorEl.textContent = '安全网关不可达 · 请通过 start.bat 启动';
    }

    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = '核验并接入';
    passInput.value = '';
    passInput.focus();
    panel.classList.remove('shake');
    void panel.offsetWidth;
    panel.classList.add('shake');
  }

  $('#togglePass').addEventListener('click', () => {
    const show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    $('#togglePass').textContent = show ? '隐藏' : '显示';
    passInput.focus();
  });

  voiceBtn.addEventListener('click', () => {
    voiceOn = !voiceOn;
    voiceBtn.textContent = voiceOn ? 'VOICE ON' : 'VOICE OFF';
    voiceBtn.classList.toggle('muted', !voiceOn);
    if (!voiceOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  });

  form.addEventListener('submit', submit);

  // 浏览器自动填充/旧口令容易造成“看起来输对了但进不去”
  userInput.value = 'operator';
  passInput.value = '';
  userInput.addEventListener('focus', () => userInput.select());
  passInput.addEventListener('focus', () => passInput.select());

  // 已登录会话直接进入
  fetch('/api/session', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.ok) window.location.replace('/index.html');
    })
    .catch(() => {});

  resize();
  buildTintedMap();
  typeConsole();
  clock();
  const hostEl = $('#gateHost');
  if (hostEl) hostEl.textContent = `operator / ${location.host}`;
  setInterval(clock, 1000);
  requestAnimationFrame(draw);
  window.addEventListener('resize', resize);
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
})();
