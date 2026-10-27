/* ============================================================
   天网 SKYNET · 地球系统观测网络
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad = n => String(n).padStart(2, '0');
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  let appMode = 'earth';
  let stageMode = 'globe';
  let map = null;
  let mapMarkerLayer = null;
  let globeAssets = null;
  let globeEventGroup = null;

  const stage = $('#stage');
  const stageLoading = $('#stageLoading');
  const eventLayer = $('#eventLayer');
  const canvas = $('#globeCanvas');

  /* ----------------------------------------------------------
     时间 / 任务计时
  ---------------------------------------------------------- */
  const MISSION_BASE = 4 * 3600 + 12 * 60 + 33;
  const t0 = Date.now();

  function fmtDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function nowParts() {
    const d = new Date();
    return {
      h: pad(d.getHours()),
      m: pad(d.getMinutes()),
      s: pad(d.getSeconds()),
      text: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    };
  }

  function tickClocks() {
    const n = nowParts();
    const d = new Date();
    $('#clock').textContent = n.text;
    $('#dateLabel').textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    $('#feedTimeA').textContent = n.text;
    $('#feedTimeB').textContent = n.text;
    $('#missionTime').textContent = `T+ ${fmtDuration(MISSION_BASE + Math.floor((Date.now() - t0) / 1000))}`;
    $('#vitalSync').textContent = `同步于 ${n.h}:${n.m}`;
  }
  tickClocks();
  setInterval(tickClocks, 1000);

  /* ----------------------------------------------------------
     事件数据 · 实时接入 + 离线样例
  ---------------------------------------------------------- */
  const SAMPLE_EVENTS = [
    {
      key: 'typhoon', id: 'EV-01', name: '台风 白鹿', en: 'TYPHOON BAILU', type: '热带气旋',
      status: '样例', color: '#c77a1a', lat: 18.4, lon: 132.6, confidence: 96,
      stats: [['强度', '强台风 · 14 级'], ['中心气压', '945 hPa'], ['最大风速', '45 m/s'], ['移动速度', '18 km/h']],
      note: '路径指向西北，预计 72 小时内擦过菲律宾北部，外围云系已影响台湾以东海域。',
      source: 'DEMO', url: '', timeOffset: 20 * 60
    },
    {
      key: 'ice', id: 'EV-02', name: '北极海冰', en: 'ARCTIC SEA ICE', type: '冰冻圈',
      status: '样例', color: '#2a8fb8', lat: 78.2, lon: 15.6, confidence: 99,
      stats: [['海冰面积', '4.28 M km²'], ['同期偏差', '-6.1%'], ['表面气温', '-18.4 °C'], ['边缘状态', '历史低位']],
      note: '北极海冰范围持续低于 1991–2020 年均值，夏季最小冰面预计在 9 月中旬出现。',
      source: 'DEMO', url: '', timeOffset: 42 * 60
    },
    {
      key: 'fire', id: 'EV-03', name: '亚马逊火情', en: 'AMAZON FIRES', type: '生物圈',
      status: '样例', color: '#d94a3d', lat: -6.5, lon: -63.2, confidence: 93,
      stats: [['活跃火点', '1,284 个'], ['过火面积', '42,000 ha'], ['烟羽长度', '1,200 km'], ['影响区域', '亚马逊中部']],
      note: '火点数量较上周上升 18%，烟羽向东南方向扩散，区域水汽输送通道受阻。',
      source: 'DEMO', url: '', timeOffset: 65 * 60
    },
    {
      key: 'volcano', id: 'EV-04', name: '汤加火山', en: 'TONGA VOLCANO', type: '岩石圈',
      status: '样例', color: '#d1692f', lat: -20.5, lon: -175.3, confidence: 97,
      stats: [['警报等级', '2 级'], ['SO₂ 排放', '12 kt'], ['羽流高度', '3.2 km'], ['最近喷发', '2022-01']],
      note: '海底火山活动增强，二氧化硫羽流向东飘移，周边航空航线已收到预警。',
      source: 'DEMO', url: '', timeOffset: 95 * 60
    },
    {
      key: 'coral', id: 'EV-05', name: '大堡礁白化', en: 'GREAT BARRIER REEF', type: '生物圈',
      status: '样例', color: '#c94f86', lat: -18.2, lon: 147.7, confidence: 95,
      stats: [['白化比例', '62%'], ['海表温度', '+2.1 °C'], ['监测区域', '大堡礁'], ['风险等级', '极高']],
      note: '连续第 4 周海表温度高于白化阈值，中北部礁群出现大面积白化，生态压力持续上升。',
      source: 'DEMO', url: '', timeOffset: 130 * 60
    },
    {
      key: 'quake', id: 'EV-06', name: '本州东岸地震', en: 'HONSHU QUAKE', type: '岩石圈',
      status: '样例', color: '#6b5bd6', lat: 38.1, lon: 142.2, confidence: 99,
      stats: [['震级', 'M 5.4'], ['震源深度', '10 km'], ['海啸预警', '无'], ['余震', '4 次']],
      note: '地震发生于日本本州东岸近海，沿海观测站未记录到显著海啸信号，持续监测余震序列。',
      source: 'DEMO', url: '', timeOffset: 180 * 60
    }
  ].map(ev => ({
    ...ev,
    time: new Date(Date.now() - ev.timeOffset * 1000).toISOString()
  }));

  let events = SAMPLE_EVENTS.slice();
  let selectedKey = events[0].key;
  let dataMode = 'sample'; // sample | live
  let tracking = false;

  const eventByKey = key => events.find(e => e.key === key) || events[0] || null;

  const hexA = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  function fmtLat(v) { return `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`; }
  function fmtLon(v) { return `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`; }

  function fmtEventTime(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--';
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function timeAgo(iso) {
    if (!iso) return '--';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '--';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s} 秒前`;
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    return `${Math.floor(s / 86400)} 天前`;
  }

  /* ----------------------------------------------------------
     事件档案
  ---------------------------------------------------------- */
  const evId = $('#evId');
  const evName = $('#evName');
  const evEn = $('#evEn');
  const evStatus = $('#evStatus');
  const evCoord = $('#evCoord');
  const evStats = $('#evStats');
  const evNote = $('#evNote');
  const evSource = $('#evSource');
  const evLink = $('#evLink');
  const evConfBar = $('#evConfBar');
  const evConfVal = $('#evConfVal');
  const trackBtn = $('#trackBtn');

  function updateEventCount() {
    const label = dataMode === 'live' ? '实时事件' : '样例事件';
    $('#evCount').textContent = `${pad(events.length)} 个${label}`;
  }

  function resetTrack() {
    tracking = false;
    trackBtn.setAttribute('aria-pressed', 'false');
    trackBtn.innerHTML = '<i></i>持续追踪';
  }

  function selectEvent(key, opts = {}) {
    const ev = eventByKey(key);
    if (!ev) return;
    selectedKey = ev.key;

    evId.textContent = ev.id;
    evId.style.color = ev.color;
    evId.style.borderColor = hexA(ev.color, 0.3);
    evId.style.background = hexA(ev.color, 0.08);

    evName.textContent = ev.source === 'NASA EONET' ? (ev.label || ev.name) : ev.name;
    evEn.textContent = `${ev.en} · ${ev.type}`;
    evStatus.textContent = ev.status;
    evStatus.style.color = ev.color;
    evStatus.style.borderColor = hexA(ev.color, 0.34);
    evStatus.style.background = hexA(ev.color, 0.08);

    evCoord.textContent = `${fmtLat(ev.lat)} / ${fmtLon(ev.lon)}`;

    evStats.innerHTML = ev.stats.map(([k, v]) =>
      `<div><span>${k}</span><b>${v}</b></div>`
    ).join('');

    evNote.textContent = ev.note;
    evSource.textContent = `${ev.source || 'DEMO'} · ${timeAgo(ev.time)}`;

    if (ev.url) {
      evLink.hidden = false;
      evLink.href = ev.url;
    } else {
      evLink.hidden = true;
      evLink.removeAttribute('href');
    }

    const confidence = Number.isFinite(ev.confidence) ? ev.confidence : 95;
    evConfBar.style.width = `${confidence}%`;
    evConfBar.style.background = `linear-gradient(90deg, ${hexA(ev.color, 0.3)}, ${ev.color})`;
    evConfBar.style.boxShadow = `0 0 8px ${hexA(ev.color, 0.4)}`;
    evConfVal.textContent = `${confidence}%`;
    evConfVal.style.color = ev.color;

    $('#dossier').style.setProperty('--pin', ev.color);
    resetTrack();

    $$('.event-pin').forEach(el => el.classList.toggle('active', el.dataset.key === ev.key));
    syncMapSelection();

    if (!opts.silent) {
      addLog(`聚焦事件 <b>${ev.id} · ${ev.name}</b>，坐标 ${fmtLat(ev.lat)} ${fmtLon(ev.lon)}`, '观测');
    }
  }

  trackBtn.addEventListener('click', () => {
    const ev = eventByKey(selectedKey);
    if (!ev) return;
    tracking = !tracking;
    trackBtn.setAttribute('aria-pressed', String(tracking));
    trackBtn.innerHTML = tracking ? '<i></i>追踪中' : '<i></i>持续追踪';
    addLog(
      tracking
        ? `已对 <b>${ev.name}</b> 建立持续追踪，数据流优先级提升至 P1`
        : `已取消 <b>${ev.name}</b> 的持续追踪`,
      '天网'
    );
  });

  $('#locateBtn').addEventListener('click', () => {
    const ev = eventByKey(selectedKey);
    if (!ev) return;
    if (stageMode === 'map' && map) {
      map.flyTo([ev.lat, ev.lon], 6, { duration: 1.15 });
    } else {
      locateLon(ev.lon);
    }
    addLog(`视角定位至 <b>${ev.name}</b> · ${fmtLat(ev.lat)} ${fmtLon(ev.lon)}`, '天网');
  });

  /* ----------------------------------------------------------
     启动序列
  ---------------------------------------------------------- */
  const boot = $('#boot');
  const bootLog = $('#bootLog');
  const bootBar = $('#bootBar');
  const bootLines = [
    ['建立深空观测链路', 'DSN-LINK', 'OK'],
    ['唤醒天网星座 12 颗卫星', 'CONSTELLATION', '12/12'],
    ['载入地球大气与海洋模型', 'GAIA CORE', 'OK'],
    ['校准自转参数与轨道倾角', 'ORBITAL CAL', 'OK'],
    ['接入全球地面观测站网', 'GROUND GRID', '08/08'],
    ['同步公开气候数据源', 'OPEN DATA', 'OK'],
    ['地球全息投影就绪', 'SKYNET ONLINE', 'READY']
  ];

  let bootTimer = null;
  let bootIndex = 0;
  let bootDone = false;

  function writeBootLine(i) {
    const [label, tag, status] = bootLines[i];
    const dots = '·'.repeat(Math.max(5, 26 - label.length));
    const cls = status === 'READY' ? 'ok' : i === bootLines.length - 2 ? 'warn' : '';
    const line = document.createElement('div');
    line.className = cls;
    line.textContent = `› ${label} ${dots} ${status}`;
    bootLog.appendChild(line);
    bootBar.style.width = `${Math.round(((i + 1) / bootLines.length) * 100)}%`;
  }

  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    clearInterval(bootTimer);
    bootBar.style.width = '100%';
    boot.style.pointerEvents = 'none';
    setTimeout(() => boot.classList.add('done'), 260);
    setTimeout(() => { boot.style.display = 'none'; }, 1100);
  }

  bootTimer = setInterval(() => {
    if (bootIndex >= bootLines.length) { finishBoot(); return; }
    writeBootLine(bootIndex++);
  }, 250);
  setTimeout(finishBoot, 2600);

  $('#bootSkip').addEventListener('click', finishBoot);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') finishBoot();
  });

  /* ----------------------------------------------------------
     实时事件流
  ---------------------------------------------------------- */
  const logList = $('#logList');
  const LOG_MAX = 5;

  function addLog(html, tag = '观测', level = '', ago = 0) {
    const li = document.createElement('li');
    li.className = 'log-item';
    const d = new Date(Date.now() - ago * 1000);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    li.innerHTML = `
      <div class="log-top">
        <span class="log-tag ${level}">${tag}</span>
        <span class="log-time">${time}</span>
      </div>
      <p>${html}</p>`;
    logList.prepend(li);
    while (logList.children.length > LOG_MAX) logList.lastElementChild.remove();
  }

  [
    ['实时数据链路初始化，等待 <b>USGS</b> / <b>NASA EONET</b> 响应…', '实时'],
    ['地图图层就绪：高德卫星 · NASA GIBS · RainViewer 雷达', '地图'],
    ['在轨卫星 <b>12/12</b> · 地面站 <b>08/08</b> · 加密链路正常', '天网'],
    ['全球事件流已连接，等待首轮实时事件入库', '观测']
  ].forEach(([text, tag, level], i) => addLog(text, tag, level || '', (4 - i) * 34));

  const LOG_POOL = [
    ['Sentinel-2 过境，<b>大堡礁</b>白化监测数据已更新', '观测'],
    ['汤加海底火山 <b>SO₂ 羽流</b>高度 3.2 km，向东飘移', '地质'],
    ['太平洋浮标阵列回传，海表温度较均值 <b>+0.4°C</b>', '海洋'],
    ['GRACE-FO 重力场解算完成，水储量异常已入库', '观测'],
    ['太阳风速度 <b>412 km/s</b>，地磁 Kp 指数 3.7', '空间天气'],
    ['全球地震台网 24h 记录 <b>M4.5+</b> 事件 37 次', '地质'],
    ['北极航道冰情模型刷新，通航窗口收窄 <b>6 天</b>', '气候'],
    ['天网星座轨道校准完成，定位精度 <b>±0.8 m</b>', '天网']
  ];
  let logCursor = 0;
  setInterval(() => {
    const [text, tag] = LOG_POOL[logCursor % LOG_POOL.length];
    logCursor++;
    addLog(text, tag, tag === '警报' ? 'warn' : '');
  }, 13000);

  /* ----------------------------------------------------------
     盖亚推演 · 打字机
  ---------------------------------------------------------- */
  const GAIA_MESSAGES = [
    '实时事件已接入：USGS 强震与 NASA EONET 自然事件正在持续更新。',
    '可在「地图」模式中放大查看任意事件的卫星影像与雷达回波。',
    '环太平洋地震带活动处于正常区间，未检测到显著海啸信号。',
    '网络空间模式支持本机网卡探针，可切换查看实时吞吐与威胁告警。'
  ];
  const gaiaEl = $('#gaiaMsg').querySelector('span');
  let gaiaIdx = 0;
  let gaiaChars = 0;

  function gaiaTick() {
    const msg = GAIA_MESSAGES[gaiaIdx];
    if (gaiaChars < msg.length) {
      gaiaChars++;
      gaiaEl.textContent = msg.slice(0, gaiaChars);
      setTimeout(gaiaTick, 34);
    } else {
      setTimeout(() => {
        gaiaIdx = (gaiaIdx + 1) % GAIA_MESSAGES.length;
        gaiaChars = 0;
        gaiaEl.textContent = '';
        gaiaTick();
      }, 6200);
    }
  }
  setTimeout(gaiaTick, 900);

  /* ==========================================================
     三维地球
  ========================================================== */
  let scene, camera, renderer, pivot, spin, satGroup;
  let stageW = 1, stageH = 1;
  let locateTarget = null;
  let locateFrom = 0;
  let locateStart = 0;
  let resumeAt = 0;
  let dragging = false;
  let lastPointerX = 0;
  let globeReady = false;
  const sats = [];
  const arcCurves = [];
  const arcPulses = [];

  const SUN_DIR = new THREE.Vector3(0.88, 0.32, 0.55).normalize();
  const INITIAL_SPIN = 2.879; // 东经 105° 朝向观察者

  function latLonToVec3(lat, lon, radius = 1) {
    const phi = THREE.MathUtils.degToRad(lon + 180);
    const theta = THREE.MathUtils.degToRad(90 - lat);
    return new THREE.Vector3(
      -radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.cos(theta),
      radius * Math.sin(theta) * Math.sin(phi)
    );
  }

  function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.25, 'rgba(255,255,255,.6)');
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function makeRingTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.translate(64, 64);
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineWidth = 3;
    g.shadowBlur = 12;
    g.shadowColor = 'rgba(255,255,255,.9)';
    g.beginPath();
    g.arc(0, 0, 43, 0, Math.PI * 2);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function initGlobe() {
    if (!window.THREE) {
      stageLoading.textContent = '三维引擎未加载 · 地球投影不可用';
      return;
    }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
      });
    } catch (err) {
      stageLoading.textContent = '当前设备不支持 WebGL · 地球投影不可用';
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(33, 1, 0.1, 200);
    camera.position.set(0, 0.12, 4.75);
    camera.lookAt(0, 0, 0);

    pivot = new THREE.Group();
    pivot.rotation.z = 0.33;
    scene.add(pivot);

    spin = new THREE.Group();
    spin.rotation.y = INITIAL_SPIN;
    pivot.add(spin);

    /* ---- 地球材质 ---- */
    const placeholder = new THREE.DataTexture(new Uint8Array([4, 12, 18, 255]), 1, 1, THREE.RGBAFormat);
    placeholder.needsUpdate = true;

    const uniforms = {
      uDay: { value: placeholder },
      uNight: { value: placeholder },
      uSun: { value: SUN_DIR }
    };

    const earthMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalW;
        void main() {
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform vec3 uSun;
        varying vec2 vUv;
        varying vec3 vNormalW;
        void main() {
          vec3 n = normalize(vNormalW);
          float lit = dot(n, normalize(uSun));
          float dayMix = smoothstep(-0.14, 0.34, lit);

          vec3 day = texture2D(uDay, vUv).rgb;
          vec3 night = texture2D(uNight, vUv).rgb;

          day *= 0.55 + 0.62 * clamp(lit, 0.0, 1.0);
          night = night * vec3(1.28, 1.12, 0.86) * 1.12 + vec3(0.004, 0.012, 0.022);

          vec3 col = mix(night, day, dayMix);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), earthMat);
    spin.add(earth);

    /* 经纬网格 */
    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(1.0025, 48, 24),
      new THREE.MeshBasicMaterial({
        color: 0x2b6bff, wireframe: true, transparent: true,
        opacity: 0.026, depthWrite: false
      })
    );
    spin.add(wire);

    const loader = new THREE.TextureLoader();
    loader.load(EARTH_TEXTURES.day, tex => {
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = THREE.RepeatWrapping;
      uniforms.uDay.value = tex;
      globeReady = true;
      stageLoading.classList.add('hidden');
    });
    loader.load(EARTH_TEXTURES.night, tex => {
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = THREE.RepeatWrapping;
      uniforms.uNight.value = tex;
    });

    /* ---- 大气辉光 ---- */
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.055, 64, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            float rim = pow(1.0 - abs(dot(vN, vV)), 3.2);
            gl_FragColor = vec4(0.24, 0.58, 1.0, rim * 0.44);
          }
        `
      })
    );
    scene.add(atmosphere);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(80,190,255,.55)', 'rgba(40,120,255,0)'),
      color: 0x8fc4ff,
      transparent: true,
      opacity: 0.30,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    halo.scale.set(3.05, 3.05, 1);
    halo.position.z = -0.15;
    scene.add(halo);

    /* ---- 星空 ---- */
    function makeStars(count, rMin, rMax, size, opacity) {
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = rMin + Math.random() * (rMax - rMin);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: 0x7fa8d9, size, transparent: true, opacity,
        sizeAttenuation: true, depthWrite: false
      });
      scene.add(new THREE.Points(geo, mat));
    }
    makeStars(1300, 14, 38, 0.026, 0.75);
    makeStars(240, 20, 50, 0.055, 0.5);

    /* ---- 卫星星座 ---- */
    const glowTex = makeGlowTexture('rgba(200,255,245,1)', 'rgba(80,240,210,0)');
    satGroup = new THREE.Group();
    scene.add(satGroup);

    for (let i = 0; i < 10; i++) {
      const radius = 1.20 + (i % 4) * 0.065 + Math.random() * 0.03;
      const orbit = new THREE.Group();
      orbit.rotation.x = (Math.random() - 0.5) * 1.35;
      orbit.rotation.y = Math.random() * Math.PI;
      orbit.rotation.z = (Math.random() - 0.5) * 0.9;
      satGroup.add(orbit);

      const pts = [];
      for (let j = 0; j <= 180; j++) {
        const a = (j / 180) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0x2b6bff, transparent: true, opacity: 0.13,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      orbit.add(line);

      const sat = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x1f5eff })
      );
      sat.add(new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0x7fb0ff, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      })));
      sat.children[0].scale.set(0.05, 0.05, 1);
      orbit.add(sat);

      sats.push({
        orbit, sat, radius,
        angle: Math.random() * Math.PI * 2,
        speed: (0.055 + Math.random() * 0.05) * (Math.random() > 0.5 ? 1 : -1)
      });
    }

    /* ---- 地面站 ---- */
    const stations = [
      { name: '北京', lat: 39.9, lon: 116.4 },
      { name: '内罗毕', lat: -1.29, lon: 36.82 },
      { name: '圣保罗', lat: -23.55, lon: -46.63 },
      { name: '悉尼', lat: -33.87, lon: 151.21 },
      { name: '雷克雅未克', lat: 64.15, lon: -21.94 },
      { name: '旧金山', lat: 37.77, lon: -122.42 },
      { name: '新加坡', lat: 1.35, lon: 103.82 },
      { name: '开普敦', lat: -33.92, lon: 18.42 }
    ];
    const stationTex = makeGlowTexture('rgba(210,255,248,1)', 'rgba(70,240,210,0)');

    stations.forEach(st => {
      const p = latLonToVec3(st.lat, st.lon, 1.012);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x1f5eff })
      );
      dot.position.copy(p);
      spin.add(dot);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: stationTex, color: 0x5c9bff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      glow.position.copy(p);
      glow.scale.set(0.055, 0.055, 1);
      spin.add(glow);
    });

    /* ---- 观测链路 ---- */
    const pulseTex = makeGlowTexture('rgba(220,255,250,1)', 'rgba(90,240,220,0)');
    const pairs = [
      [116.4, 39.9, 151.21, -33.87],
      [116.4, 39.9, 103.82, 1.35],
      [36.82, -1.29, -46.63, -23.55]
    ];

    pairs.forEach(([lon1, lat1, lon2, lat2], idx) => {
      const a = latLonToVec3(lat1, lon1, 1.008);
      const b = latLonToVec3(lat2, lon2, 1.008);
      const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(1.28);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x2b6bff, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      spin.add(line);
      arcCurves.push(curve);

      const pulse = new THREE.Sprite(new THREE.SpriteMaterial({
        map: pulseTex, color: 0x7fb0ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      pulse.scale.set(0.045, 0.045, 1);
      spin.add(pulse);
      arcPulses.push({ sprite: pulse, curve, offset: idx * 0.33 });
    });

    /* ---- 事件热点与标签 ---- */
    const ringTex = makeRingTexture();
    globeAssets = { glowTex, ringTex };
    globeEventGroup = new THREE.Group();
    spin.add(globeEventGroup);
    rebuildGlobeEvents();

    /* ---- 交互 ---- */
    canvas.addEventListener('pointerdown', e => {
      dragging = true;
      lastPointerX = e.clientX;
      locateTarget = null;
      resumeAt = Infinity;
      canvas.classList.add('dragging');
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastPointerX;
      lastPointerX = e.clientX;
      spin.rotation.y += dx * 0.0062;
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('dragging');
      resumeAt = performance.now() + 4500;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', e => {
      if (dragging && e.buttons === 0) endDrag();
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      camera.position.z = clamp(camera.position.z + e.deltaY * 0.0016, 3.45, 6.6);
      camera.lookAt(0, 0, 0);
      resumeAt = performance.now() + 3500;
    }, { passive: false });

    canvas.addEventListener('dblclick', () => {
      camera.position.z = 4.75;
      camera.lookAt(0, 0, 0);
      spin.rotation.y = INITIAL_SPIN;
      locateTarget = null;
    });

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      stageW = rect.width;
      stageH = rect.height;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    };
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);

    /* ---- 渲染循环 ---- */
    const clock = new THREE.Clock();
    let frame = 0;

    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const now = performance.now();

      if (appMode !== 'earth' || stageMode !== 'globe') return;

      if (locateTarget !== null) {
        const k = Math.min(1, (now - locateStart) / 1100);
        const ease = 1 - Math.pow(1 - k, 3);
        spin.rotation.y = locateFrom + (locateTarget - locateFrom) * ease;
        if (k >= 1) {
          spin.rotation.y = locateTarget;
          locateTarget = null;
        }
      } else if (!dragging && now > resumeAt) {
        spin.rotation.y += dt * 0.018;
      }

      sats.forEach(s => {
        s.angle += s.speed * dt;
        s.sat.position.set(Math.cos(s.angle) * s.radius, 0, Math.sin(s.angle) * s.radius);
      });

      arcPulses.forEach(p => {
        const t = ((now * 0.00012 + p.offset) % 1 + 1) % 1;
        p.sprite.position.copy(p.curve.getPoint(t));
        p.sprite.material.opacity = 0.2 + Math.sin(t * Math.PI) * 0.8;
      });

      events.forEach(ev => {
        if (!ev.ring || !ev.core) return;
        const active = ev.key === selectedKey;
        const speed = active ? 0.00075 : 0.00042;
        const phase = ((now * speed + ev.phase) % 1 + 1) % 1;
        const base = active ? 0.075 : 0.05;
        const spread = active ? 0.18 : 0.11;
        ev.ring.scale.setScalar(base + phase * spread);
        ev.ring.material.opacity = (1 - phase) * (active ? 0.95 : 0.55);
        const coreScale = active ? 0.085 + Math.sin(now * 0.003) * 0.008 : 0.065;
        ev.core.scale.set(coreScale, coreScale, 1);
      });

      // 事件标签投影（简单碰撞避让）
      const camDir = camera.position.clone().normalize();
      const v = new THREE.Vector3();
      const placed = [];
      events.forEach(ev => {
        if (!ev.core || !ev.el) return;
        v.copy(ev.core.position);
        spin.localToWorld(v);
        const facing = v.clone().normalize().dot(camDir);
        const p = v.clone().project(camera);
        const x = (p.x * 0.5 + 0.5) * stageW;
        const y = (-p.y * 0.5 + 0.5) * stageH;
        const visible = facing > 0.14 && p.z < 1 && x > -40 && x < stageW + 40 && y > -30 && y < stageH + 30;
        ev.el.classList.toggle('visible', visible);
        if (visible) {
          const toLeft = x > stageW - 175;
          const w = ev.el.offsetWidth || 110;
          const lx = toLeft ? x - 13 - w : x + 13;
          let ly = y;
          for (let a = 0; a < 7; a++) {
            const rect = { l: lx, r: lx + w, t: ly - 11, b: ly + 11 };
            const hit = placed.some(o => rect.l < o.r && rect.r > o.l && rect.t < o.b && rect.b > o.t);
            if (!hit) break;
            ly += (a % 2 === 0 ? 1 : -1) * Math.ceil((a + 1) / 2) * 22;
          }
          ly = clamp(ly, 22, stageH - 22);
          placed.push({ l: lx, r: lx + w, t: ly - 11, b: ly + 11 });
          ev.el.classList.toggle('left', toLeft);
          ev.el.classList.remove('below');
          ev.el.style.left = `${x.toFixed(1)}px`;
          ev.el.style.top = `${ly.toFixed(1)}px`;
        }
      });

      if (frame++ % 8 === 0) updateCenterLon();

      renderer.render(scene, camera);
    }
    animate();

    stageLoading.classList.add('hidden');
    setTimeout(() => { if (!globeReady) stageLoading.classList.remove('hidden'); }, 1200);
  }

  function updateCenterLon() {
    if (!window.THREE || !spin) return;
    let lon = 90 - THREE.MathUtils.radToDeg(spin.rotation.y) - 180;
    lon = ((lon + 540) % 360) - 180;
    const el = $('#centerLon');
    if (el) el.textContent = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  }

  function locateLon(lon) {
    if (!spin) return;
    const targetBase = Math.PI / 2 - THREE.MathUtils.degToRad(lon + 180);
    const current = spin.rotation.y;
    const delta = ((targetBase - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    locateFrom = current;
    locateTarget = current + delta;
    locateStart = performance.now();
    resumeAt = performance.now() + 6500;
  }

  /* ----------------------------------------------------------
     地球事件热点重建
  ---------------------------------------------------------- */
  function rebuildGlobeEvents() {
    if (!globeEventGroup || !globeAssets) return;

    while (globeEventGroup.children.length) {
      const child = globeEventGroup.children.pop();
      if (child.material) child.material.dispose();
    }
    eventLayer.innerHTML = '';

    const natural = events.filter(ev => ev.source === 'NASA EONET' && ev.type !== '地震').slice(0, 4);
    const quakes = [];
    const seenQuakeArea = new Set();
    events.filter(ev => ev.type === '地震').forEach(ev => {
      const area = `${Math.round(ev.lat / 6)}:${Math.round(ev.lon / 6)}`;
      if (seenQuakeArea.has(area)) return;
      seenQuakeArea.add(area);
      quakes.push(ev);
    });
    const list = dataMode === 'live' && natural.length
      ? [...natural, ...quakes.slice(0, 3)]
      : events.slice(0, 6);

    list.forEach((ev, i) => {
      ev.phase = i * 0.41;
      ev.core = null;
      ev.ring = null;

      const p = latLonToVec3(ev.lat, ev.lon, 1.018);
      const color = new THREE.Color(ev.color);

      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: globeAssets.glowTex, color, transparent: true, opacity: 0.92,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      core.position.copy(p);
      core.scale.set(0.07, 0.07, 1);
      globeEventGroup.add(core);

      const ring = new THREE.Sprite(new THREE.SpriteMaterial({
        map: globeAssets.ringTex, color, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      ring.position.copy(p);
      ring.scale.set(0.06, 0.06, 1);
      globeEventGroup.add(ring);

      ev.core = core;
      ev.ring = ring;

      const btn = document.createElement('button');
      btn.className = 'event-pin';
      btn.dataset.key = ev.key;
      btn.style.setProperty('--pin', ev.color);
      if (ev.key === selectedKey) btn.classList.add('active');
      btn.innerHTML = `<i class="pin-dot"></i><span>${escapeHtml(ev.label || ev.name)}</span><em>${escapeHtml(ev.shortId || ev.id)}</em>`;
      btn.addEventListener('click', () => {
        selectEvent(ev.key);
        resumeAt = performance.now() + 5000;
      });
      eventLayer.appendChild(btn);
      ev.el = btn;
    });

    updateEventCount();
  }

  function syncMapSelection() {
    if (!map || !mapMarkerLayer) return;
    mapMarkerLayer.eachLayer(layer => {
      const key = layer.__eventKey;
      if (!key) return;
      const el = layer.getElement && layer.getElement();
      if (el) el.classList.toggle('active', key === selectedKey);
    });
  }

  /* ----------------------------------------------------------
     卫星画面 A · 台风
  ---------------------------------------------------------- */
  const feedA = $('#feedA');
  const ctxA = feedA.getContext('2d');
  const feedB = $('#feedB');
  const ctxB = feedB.getContext('2d');
  const FW = 480, FH = 200;

  const noiseCanvas = document.createElement('canvas');
  noiseCanvas.width = 240;
  noiseCanvas.height = 100;
  const nctx = noiseCanvas.getContext('2d');
  const noiseImg = nctx.createImageData(240, 100);
  let noiseTime = 0;

  function refreshNoise() {
    const d = noiseImg.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 16;
    }
    nctx.putImageData(noiseImg, 0, 0);
  }

  function drawNoise(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(noiseCanvas, 0, 0, FW, FH);
    ctx.restore();
  }

  // 柔和云团贴图，避免硬边圆点
  const puffCanvas = document.createElement('canvas');
  puffCanvas.width = puffCanvas.height = 96;
  {
    const p = puffCanvas.getContext('2d');
    const gr = p.createRadialGradient(48, 48, 2, 48, 48, 48);
    gr.addColorStop(0, 'rgba(255,255,255,.9)');
    gr.addColorStop(0.38, 'rgba(235,250,252,.38)');
    gr.addColorStop(1, 'rgba(220,245,250,0)');
    p.fillStyle = gr;
    p.fillRect(0, 0, 96, 96);
  }
  function puff(ctx, x, y, r, a) {
    ctx.globalAlpha = a;
    ctx.drawImage(puffCanvas, x - r, y - r, r * 2, r * 2);
  }

  function drawTyphoon(t) {
    const ctx = ctxA;
    const g = ctx.createLinearGradient(0, 0, FW, FH);
    g.addColorStop(0, '#061f2a');
    g.addColorStop(0.55, '#03121b');
    g.addColorStop(1, '#01070c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FW, FH);

    // 海面微光
    ctx.strokeStyle = 'rgba(80,170,190,.05)';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 28 + i * 26);
      ctx.bezierCurveTo(120, 20 + i * 26, 340, 40 + i * 26, FW, 24 + i * 26);
      ctx.stroke();
    }

    // 经纬网格
    ctx.strokeStyle = 'rgba(112,205,225,.07)';
    ctx.lineWidth = 1;
    for (let x = 30; x < FW; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, FH); ctx.stroke();
    }
    for (let y = 24; y < FH; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FW, y); ctx.stroke();
    }

    const cx = 244, cy = 98;

    // 高层云罩
    const shield = ctx.createRadialGradient(cx, cy, 16, cx, cy, 190);
    shield.addColorStop(0, 'rgba(222,242,246,.15)');
    shield.addColorStop(0.45, 'rgba(166,210,220,.06)');
    shield.addColorStop(1, 'rgba(120,180,195,0)');
    ctx.fillStyle = shield;
    ctx.fillRect(0, 0, FW, FH);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.022);
    ctx.globalCompositeOperation = 'lighter';

    // 外围螺旋云带
    for (let arm = 0; arm < 3; arm++) {
      const offset = arm * Math.PI * 2 / 3;
      for (let i = 0; i < 50; i++) {
        const a = offset + i * 0.155 + Math.sin(i * 0.19) * 0.07;
        const r = 36 + i * 2.5;
        const x = Math.cos(a) * r * 1.42;
        const y = Math.sin(a) * r * 0.68;
        const size = 17 + i * 0.58;
        const band = 0.62 + 0.38 * Math.sin(i * 0.7 + arm);
        puff(ctx, x, y, size, (0.06 + 0.085 * (1 - i / 56)) * band);
      }
    }

    // 内圈对流云团
    for (let arm = 0; arm < 3; arm++) {
      const offset = arm * Math.PI * 2 / 3 + 0.4;
      for (let i = 0; i < 22; i++) {
        const a = offset - i * 0.23;
        const r = 20 + i * 1.45;
        puff(ctx, Math.cos(a) * r * 1.22, Math.sin(a) * r * 0.78, 12 + i * 0.55, 0.10 + 0.08 * (1 - i / 24));
      }
    }

    // 中心密蔽云区
    puff(ctx, 0, 0, 74, 0.12);

    // 眼墙
    ctx.globalAlpha = 1;
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2;
      const r = 29 + Math.sin(i * 2.1) * 2.2;
      puff(ctx, Math.cos(a) * r * 1.2, Math.sin(a) * r * 0.76, 8.5, 0.24);
    }

    // 台风眼
    ctx.globalCompositeOperation = 'source-over';
    const eye = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
    eye.addColorStop(0, 'rgba(1,8,12,.98)');
    eye.addColorStop(0.55, 'rgba(2,14,20,.92)');
    eye.addColorStop(1, 'rgba(2,14,20,0)');
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fillStyle = eye;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(235,250,252,.6)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // 外围环流
    ctx.strokeStyle = 'rgba(170,215,225,.09)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 152 + i * 32, 66 + i * 15, -0.13, 0.15, Math.PI * 1.6);
      ctx.stroke();
    }

    // 冷云顶色温
    const wash = ctx.createRadialGradient(cx, cy, 10, cx, cy, 210);
    wash.addColorStop(0, 'rgba(150,225,235,.06)');
    wash.addColorStop(0.45, 'rgba(100,180,210,.025)');
    wash.addColorStop(1, 'rgba(80,160,200,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, FW, FH);

    // 中心锁定标记
    ctx.strokeStyle = 'rgba(255,196,107,.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 6, cy);
    ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6);
    ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 18);
    ctx.stroke();

    drawNoise(ctx);
  }

  /* ----------------------------------------------------------
     卫星画面 B · 海冰
  ---------------------------------------------------------- */
  const floes = [];
  function buildFloes() {
    floes.length = 0;
    for (let i = 0; i < 30; i++) {
      const pts = [];
      const verts = 5 + ((Math.random() * 5) | 0);
      const baseR = 3 + Math.random() * 9;
      for (let j = 0; j < verts; j++) {
        const a = (j / verts) * Math.PI * 2;
        const r = baseR * (0.55 + Math.random() * 0.65);
        pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.72]);
      }
      floes.push({
        x: Math.random() * FW,
        y: 98 + Math.random() * 54,
        pts,
        speed: 0.3 + Math.random() * 0.9,
        alpha: 0.42 + Math.random() * 0.4,
        rot: Math.random() * Math.PI
      });
    }
  }
  buildFloes();

  function drawIce(t) {
    const ctx = ctxB;
    const g = ctx.createLinearGradient(0, 0, 0, FH);
    g.addColorStop(0, '#072330');
    g.addColorStop(0.6, '#04141d');
    g.addColorStop(1, '#02080d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FW, FH);

    // 海水纹理
    ctx.strokeStyle = 'rgba(80,150,175,.10)';
    for (let i = 0; i < 12; i++) {
      const y = 158 + i * 4;
      ctx.beginPath();
      for (let x = 0; x <= FW; x += 12) {
        const yy = y + Math.sin((x + t * 12 + i * 30) * 0.035) * 1.6;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    // 连续冰盖边缘
    const edgeY = x => 74 + Math.sin(x * 0.028 + 1.2) * 9 + Math.sin(x * 0.11) * 4 + Math.sin(x * 0.23 + 2) * 2.2;

    const iceGrad = ctx.createLinearGradient(0, 0, 0, 130);
    iceGrad.addColorStop(0, 'rgba(232,249,253,.88)');
    iceGrad.addColorStop(1, 'rgba(160,208,224,.60)');

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(FW, 0);
    ctx.lineTo(FW, edgeY(FW));
    for (let x = FW; x >= 0; x -= 6) ctx.lineTo(x, edgeY(x));
    ctx.closePath();
    ctx.fillStyle = iceGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,253,255,.7)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 冰脊
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = 34 + i * 76;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x + 14, 24 + (i % 3) * 8);
      ctx.lineTo(x + 9, 42 + (i % 4) * 5);
      ctx.stroke();
    }

    // 融池
    [[82, 22, 26, 9], [300, 38, 21, 7], [438, 18, 18, 7], [142, 55, 24, 7], [340, 58, 16, 6]].forEach(([x, y, rx, ry]) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28,86,105,.14)';
      ctx.fill();
    });

    // 冰盖裂纹
    ctx.strokeStyle = 'rgba(105,160,182,.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const x = 18 + i * 48 + (i % 2) * 7;
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x + 8, 16 + (i % 3) * 7);
      ctx.lineTo(x + 1, 36 + (i % 4) * 6);
      ctx.lineTo(x + 11, 56 + (i % 2) * 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 1, 36 + (i % 4) * 6);
      ctx.lineTo(x - 7, 47 + (i % 3) * 5);
      ctx.stroke();
    }

    // 浮冰
    floes.forEach((f, i) => {
      let x = f.x + t * f.speed;
      x = ((x + 40) % (FW + 80)) - 40;
      ctx.save();
      ctx.translate(x, f.y);
      ctx.rotate(f.rot);
      ctx.beginPath();
      f.pts.forEach(([px, py], j) => {
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = `rgba(207,240,249,${f.alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(240,254,255,${f.alpha + 0.18})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (i % 3 === 0) {
        ctx.strokeStyle = 'rgba(120,180,195,.3)';
        ctx.beginPath();
        ctx.moveTo(-5, -3);
        ctx.lineTo(4, 2);
        ctx.lineTo(10, -4);
        ctx.stroke();
      }
      ctx.restore();
    });

    // 冰缘线
    ctx.strokeStyle = 'rgba(169,231,255,.45)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    for (let x = 0; x <= FW; x += 8) {
      const y = 148 + Math.sin(x * 0.021 + 1.4) * 10 + Math.sin(x * 0.052) * 3;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 漂移箭头
    const driftX = 40 + ((t * 9) % 350);
    const driftY = 178;
    ctx.strokeStyle = 'rgba(121,200,255,.65)';
    ctx.fillStyle = 'rgba(121,200,255,.65)';
    ctx.beginPath();
    ctx.moveTo(driftX, driftY);
    ctx.lineTo(driftX + 26, driftY);
    ctx.moveTo(driftX + 20, driftY - 3);
    ctx.lineTo(driftX + 26, driftY);
    ctx.lineTo(driftX + 20, driftY + 3);
    ctx.stroke();
    ctx.font = '8px "Cascadia Mono", Consolas, monospace';
    ctx.fillText('DRIFT 0.4 kn', driftX + 2, driftY - 7);

    // 冷色温
    ctx.fillStyle = 'rgba(90,180,220,.045)';
    ctx.fillRect(0, 0, FW, FH);

    ctx.strokeStyle = 'rgba(169,231,255,.55)';
    ctx.strokeRect(356, 152, 108, 26);
    ctx.font = '8px "Cascadia Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(200,240,255,.7)';
    ctx.fillText('ICE EDGE', 362, 149);

    ctx.fillStyle = 'rgba(150,200,210,.45)';
    ctx.fillText('PAN 78.2N 15.6E  ·  RES 10m', 12, FH - 8);

    drawNoise(ctx);
  }

  /* ----------------------------------------------------------
     观测画面：无真实下行时显示 NO SIGNAL
     两路使用不同的失锁/待机纹样，不再生成相同的假卫星图
  ---------------------------------------------------------- */
  function drawNoSignalA(t) {
    const ctx = ctxA;
    const g = ctx.createLinearGradient(0, 0, FW, FH);
    g.addColorStop(0, '#10080a');
    g.addColorStop(0.55, '#09070a');
    g.addColorStop(1, '#030507');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FW, FH);

    // 模拟下行失锁的横向撕裂
    for (let i = 0; i < 34; i++) {
      const y = (i * 7 + Math.sin(t * 0.8 + i * 0.7) * 3 + FH) % FH;
      const w = 40 + ((Math.sin(i * 2.3 + t * 1.1) + 1) * 0.5) * (FW - 40);
      const x = ((Math.sin(i * 1.7 + t * 0.5) + 1) * 0.5) * (FW - w);
      ctx.fillStyle = i % 4 === 0 ? 'rgba(255,110,95,.13)' : 'rgba(210,120,105,.055)';
      ctx.fillRect(x, y, w, i % 5 === 0 ? 2 : 1);
    }

    // 滚动的失锁亮带
    const bandY = (t * 38) % (FH + 40) - 20;
    const band = ctx.createLinearGradient(0, bandY - 20, 0, bandY + 20);
    band.addColorStop(0, 'rgba(255,98,89,0)');
    band.addColorStop(0.5, 'rgba(255,98,89,.16)');
    band.addColorStop(1, 'rgba(255,98,89,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, bandY - 20, FW, 40);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    drawNoise(ctx);
    ctx.restore();

    // 模拟信号格与失锁计时
    ctx.font = '8px "Cascadia Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(255,145,125,.38)';
    ctx.fillText('SYNC LOST · 0x00 · NO CARRIER', 12, FH - 10);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < 1 ? 'rgba(255,98,89,.5)' : 'rgba(255,98,89,.1)';
      ctx.fillRect(FW - 92 + i * 15, 12, 10, 5);
    }
  }

  function drawNoSignalB(t) {
    const ctx = ctxB;
    ctx.fillStyle = '#040b13';
    ctx.fillRect(0, 0, FW, FH);

    // 待机测试卡：与 A 路的模拟失锁不同
    const bars = ['#8fd8ff', '#5ff0e0', '#4a9eff', '#2f7dff', '#d7e6f2', '#17293a'];
    const bw = FW / bars.length;
    bars.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = i === 4 ? 0.22 : 0.14;
      ctx.fillRect(i * bw, 0, bw, FH * 0.72);
    });
    ctx.globalAlpha = 1;

    // 低亮度灰阶条
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `rgba(190,220,235,${0.02 + i * 0.008})`;
      ctx.fillRect(0, FH * 0.72 + i * 2.4, FW, 1.4);
    }

    // 数字块损坏
    for (let i = 0; i < 12; i++) {
      const x = ((Math.sin(i * 2.1 + t * 0.35) + 1) * 0.5) * FW;
      const y = ((Math.cos(i * 1.3 + t * 0.4) + 1) * 0.5) * FH;
      const w = 10 + (i % 4) * 17;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(95,240,224,.10)' : 'rgba(74,158,255,.08)';
      ctx.fillRect(x, y, w, 3 + (i % 3) * 2);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    drawNoise(ctx);
    ctx.restore();

    ctx.strokeStyle = 'rgba(143,216,255,.24)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, FW - 16, FH - 16);
    ctx.font = '8px "Cascadia Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(143,216,255,.42)';
    ctx.fillText('PAYLOAD STANDBY · NO PASS · 0x00', 12, FH - 10);
    ctx.fillText('TEST CARD · 75%', FW - 108, 22);
  }

  let lastFeed = 0;
  function feedLoop(ts) {
    if (ts - lastFeed > 62) {
      const t = ts / 1000;
      if (ts - noiseTime > 95) { refreshNoise(); noiseTime = ts; }
      drawNoSignalA(t);
      drawNoSignalB(t);
      lastFeed = ts;
    }
    requestAnimationFrame(feedLoop);
  }
  requestAnimationFrame(feedLoop);

  /* ==========================================================
     实时数据接入 · USGS / NASA EONET / RainViewer
  ========================================================== */
  const LIVE_SOURCES = {
    usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30',
    rain: 'https://api.rainviewer.com/public/weather-maps.json'
  };

  const CATEGORY_CN = {
    'Wildfires': '野火', 'Severe Storms': '强风暴', 'Volcanoes': '火山',
    'Sea and Lake Ice': '海冰', 'Floods': '洪水', 'Drought': '干旱',
    'Dust and Haze': '沙尘', 'Temperature Extremes': '极端温度', 'Manmade': '人为事件',
    'Earthquakes': '地震', 'Landslides': '滑坡', 'Snow': '积雪',
    'Water Color': '水体异常', 'Ecological': '生态'
  };
  const CATEGORY_COLOR = {
    '野火': '#d94a3d', '强风暴': '#c77a1a', '火山': '#d1692f', '海冰': '#2a8fb8',
    '洪水': '#2b6bff', '干旱': '#b8862f', '沙尘': '#9a7b52', '极端温度': '#d94a3d',
    '地震': '#6b5bd6', '滑坡': '#a35d2f', '积雪': '#4f9ec7', '水体异常': '#0f9f8a'
  };

  let liveLoading = false;
  let lastLiveUpdate = null;
  let lastApiLatency = null;
  let rainPath = null;
  let rainFrameTime = null;

  function fetchJSON(url, timeout = 14000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, { cache: 'no-store', signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .finally(() => clearTimeout(timer));
  }

  function geometryPoint(geom) {
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    let ring = null;
    if (geom.type === 'Polygon') ring = geom.coordinates[0];
    else if (geom.type === 'MultiPolygon') ring = geom.coordinates[0][0];
    if (!ring || !ring.length) return null;
    let sx = 0, sy = 0;
    ring.forEach(([x, y]) => { sx += x; sy += y; });
    return [sx / ring.length, sy / ring.length];
  }

  function mapEonetEvents(payload) {
    if (!payload || !Array.isArray(payload.events)) return [];
    return payload.events.map((ev, idx) => {
      const geom = ev.geometry && ev.geometry[ev.geometry.length - 1];
      const coord = geometryPoint(geom);
      if (!coord) return null;
      const [lon, lat] = coord;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const cat = ev.categories && ev.categories[0] ? ev.categories[0].title : 'Other';
      const type = CATEGORY_CN[cat] || '自然事件';
      const color = CATEGORY_COLOR[type] || '#2b6bff';
      const time = geom.date || (ev.geometry && ev.geometry[0] && ev.geometry[0].date) || new Date().toISOString();
      const rawName = ev.title || `${type}事件`;
      const label = rawName
        .replace(/^Tropical Storm/i, '热带风暴')
        .replace(/^Tropical Cyclone/i, '热带气旋')
        .replace(/^Typhoon/i, '台风')
        .replace(/^Hurricane/i, '飓风')
        .replace(/^Wildfire/i, '野火')
        .replace(/^Volcano/i, '火山')
        .replace(/^Sea and Lake Ice/i, '海冰');
      return {
        key: `eonet_${ev.id}`,
        shortId: 'EONET',
        id: `EONET`,
        name: rawName,
        label,
        en: `${cat} · NASA EONET`,
        type,
        status: '实时',
        color,
        lat: Number(lat),
        lon: Number(lon),
        time,
        source: 'NASA EONET',
        url: (ev.sources && ev.sources[0] && ev.sources[0].url) || `https://eonet.gsfc.nasa.gov/api/v3/events/${ev.id}`,
        confidence: 95,
        stats: [
          ['类别', type],
          ['记录时间', fmtEventTime(time)],
          ['数据源', 'NASA EONET'],
          ['坐标', `${lat.toFixed(1)}, ${lon.toFixed(1)}`]
        ],
        note: `NASA EONET 收录的开放自然事件，类别「${type}」。切换到地图可放大查看最新观测位置。`
      };
    }).filter(Boolean).slice(0, 14);
  }

  function mapUsgsEvents(payload) {
    if (!payload || !Array.isArray(payload.features)) return [];
    return payload.features
      .filter(f => f.properties && Number.isFinite(f.properties.mag) && f.properties.mag >= 4.5)
      .sort((a, b) => b.properties.mag - a.properties.mag)
      .slice(0, 9)
      .map(f => {
        const p = f.properties;
        const coords = f.geometry && f.geometry.coordinates;
        if (!coords) return null;
        const [lon, lat, depth] = coords;
        const shortPlace = (p.place || '')
          .replace(/^\d+\s*km\s+\w+\s+of\s+/i, '')
          .split(',')[0];
        return {
          key: `usgs_${f.id}`,
          shortId: 'USGS',
          id: 'USGS',
          name: `M${p.mag.toFixed(1)} 地震`,
          label: `M${p.mag.toFixed(1)}${shortPlace ? ` · ${shortPlace}` : ''}`,
          en: p.place || 'USGS Earthquake',
          type: '地震',
          status: '实时',
          color: '#6b5bd6',
          lat: Number(lat),
          lon: Number(lon),
          mag: p.mag,
          depth,
          time: new Date(p.time).toISOString(),
          source: 'USGS',
          url: p.url,
          confidence: 99,
          stats: [
            ['震级', `M ${p.mag.toFixed(1)}`],
            ['震源深度', `${Number(depth).toFixed(1)} km`],
            ['位置', p.place || '--'],
            ['发生时间', fmtEventTime(p.time)]
          ],
          note: `USGS 实时测定的地震事件，震源深度 ${Number(depth).toFixed(1)} km。自动解算结果可能随后修订。`
        };
      }).filter(Boolean);
  }

  function pickFocusEvent(list) {
    const preferred = list.find(ev =>
      ['强风暴', '野火', '火山', '洪水'].includes(ev.type) &&
      ev.lon > 40 && ev.lon < 175 && ev.lat > -35 && ev.lat < 55
    );
    return preferred || list.find(ev => ev.type === '地震') || list[0];
  }

  function setLiveStatus(state, text) {
    const el = $('#liveStatus');
    if (!el) return;
    el.className = `live-status ${state}`;
    el.innerHTML = `<i></i>${escapeHtml(text)}`;
  }

  function updateMapStatus() {
    const el = $('#mapStatus');
    if (!el) return;
    el.innerHTML = `<i></i>${dataMode === 'live' ? `${events.length} 个实时事件` : `${events.length} 个样例事件`}${lastLiveUpdate ? ` · 更新 ${pad(lastLiveUpdate.getHours())}:${pad(lastLiveUpdate.getMinutes())}` : ''}`;
    const up = $('#mapUpdated');
    if (up) up.textContent = lastLiveUpdate ? `更新 ${pad(lastLiveUpdate.getHours())}:${pad(lastLiveUpdate.getMinutes())}` : '--';
  }

  async function loadLiveData(manual = false) {
    if (liveLoading) return;
    liveLoading = true;
    const refreshBtn = $('#refreshLive');
    if (refreshBtn) refreshBtn.classList.add('spinning');
    setLiveStatus('loading', '更新实时数据…');

    const started = performance.now();
    const [usgsRes, eonetRes, rainRes] = await Promise.allSettled([
      fetchJSON(LIVE_SOURCES.usgs),
      fetchJSON(LIVE_SOURCES.eonet),
      fetchJSON(LIVE_SOURCES.rain, 10000)
    ]);
    lastApiLatency = Math.round(performance.now() - started);

    let quakes = [];
    let natural = [];
    let sources = [];

    if (usgsRes.status === 'fulfilled') {
      try {
        quakes = mapUsgsEvents(usgsRes.value);
        if (quakes.length) sources.push('USGS');
      } catch (err) { console.warn('USGS parse failed', err); }
    }
    if (eonetRes.status === 'fulfilled') {
      try {
        natural = mapEonetEvents(eonetRes.value);
        if (natural.length) sources.push('EONET');
      } catch (err) { console.warn('EONET parse failed', err); }
    }
    if (rainRes.status === 'fulfilled') {
      try {
        const radar = rainRes.value && rainRes.value.radar;
        if (radar && radar.past && radar.past.length) {
          rainPath = radar.past[radar.past.length - 1].path;
          rainFrameTime = radar.past[radar.past.length - 1].time;
          if (map) refreshRadarLayer();
        }
      } catch (err) { console.warn('RainViewer parse failed', err); }
    }

    const merged = [...natural, ...quakes];

    if (!merged.length) {
      setLiveStatus('sample', '离线样例 · 数据源不可达');
      dataMode = 'sample';
      updateMapStatus();
      if (manual) addLog('实时数据源暂不可达，已保留离线样例。', '警报', 'warn');
      liveLoading = false;
      if (refreshBtn) refreshBtn.classList.remove('spinning');
      return;
    }

    const previousIds = new Set(events.map(e => e.key));
    events = merged;
    dataMode = 'live';
    lastLiveUpdate = new Date();

    if (!events.some(e => e.key === selectedKey)) {
      selectedKey = pickFocusEvent(events).key;
    }

    rebuildGlobeEvents();
    rebuildMapMarkers();
    selectEvent(selectedKey, { silent: true });
    updateEventCount();
    updateMapStatus();

    const sourceLabel = sources.join(' + ') || '实时源';
    setLiveStatus('live', `实时 · ${sourceLabel}`);
    updateEarthTicker();
    if (manual) {
      addLog(`实时数据刷新完成：<b>${natural.length}</b> 条自然事件 / <b>${quakes.length}</b> 条强震，延迟 ${lastApiLatency} ms`, '实时');
    } else {
      addLog(`已接入实时数据：<b>${natural.length}</b> 条 NASA EONET 事件 / <b>${quakes.length}</b> 条 USGS M4.5+ 地震`, '实时');
    }

    const fresh = events.filter(e => !previousIds.has(e.key)).slice(0, 2);
    fresh.forEach(e => addLog(`新事件 · <b>${escapeHtml(e.label || e.name)}</b> · ${e.type} · ${fmtLat(e.lat)} ${fmtLon(e.lon)}`, '实时', 'warn'));

    // 更新网络模式中的真实 API 延迟
    const apiEl = $('#apiLatency');
    if (apiEl) apiEl.textContent = `${lastApiLatency} ms`;

    if (terminalStarted) {
      renderTermEvents();
      pollTermSys();
    }

    liveLoading = false;
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }

  /* ==========================================================
     地图模式 · Leaflet + 高德瓦片 + NASA GIBS + RainViewer
  ========================================================== */
  let mapBase = 'sat';
  let mapBaseLayer = null;
  let radarLayer = null;
  let radarOn = false;
  let mapHasOpened = false;
  const mapLayers = {};

  function gibsDate() {
    const d = new Date(Date.now() - 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function initMap() {
    if (map || !window.L) return;
    const el = $('#mapView');
    if (!el) return;

    map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 2,
      maxZoom: 18,
      zoomSnap: 1,
      worldCopyJump: true,
      preferCanvas: false
    }).setView([28, 112], 3);

    mapLayers.sat = L.tileLayer(
      'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      { subdomains: '1234', maxZoom: 18, className: 'map-base-tiles', attribution: '© 高德地图' }
    );
    mapLayers.street = L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: '1234', maxZoom: 18, className: 'map-base-tiles', attribution: '© 高德地图' }
    );
    mapLayers.gibs = L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${gibsDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      { maxNativeZoom: 9, maxZoom: 18, className: 'map-base-tiles', attribution: 'NASA GIBS' }
    );

    mapBaseLayer = mapLayers.sat;
    mapBaseLayer.addTo(map);
    mapMarkerLayer = L.layerGroup().addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 90 }).addTo(map);

    map.on('mousemove', e => {
      $('#mapCoords').textContent = `${fmtLat(e.latlng.lat)} ${fmtLon(e.latlng.lng)}`;
    });
    map.on('move zoom', updateMapReadout);
    map.on('zoomend', () => {
      $('#mapZoom').textContent = `Z ${pad(map.getZoom())}`;
      updateMapReadout();
    });

    refreshRadarLayer();
    rebuildMapMarkers();
    updateMapReadout();
    setTimeout(() => { if (map) map.invalidateSize(); }, 80);
  }

  function setMapBase(name) {
    if (!map) return;
    const next = mapLayers[name];
    if (!next) return;
    if (mapBaseLayer) map.removeLayer(mapBaseLayer);
    mapBaseLayer = next;
    mapBaseLayer.addTo(map);
    mapBase = name;
    $$('.map-layer[data-map-layer="sat"], .map-layer[data-map-layer="street"], .map-layer[data-map-layer="gibs"]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mapLayer === name);
    });
    if (radarLayer && radarOn) radarLayer.bringToFront();
  }

  function refreshRadarLayer() {
    if (!map || !rainPath) return;
    if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
    radarLayer = L.tileLayer(
      `https://tilecache.rainviewer.com${rainPath}/256/{z}/{x}/{y}/2/1_1.png`,
      { opacity: 0.55, maxNativeZoom: 10, maxZoom: 18, className: 'radar-tiles', attribution: 'RainViewer' }
    );
    if (radarOn) radarLayer.addTo(map);
  }

  function toggleRadar(force) {
    radarOn = typeof force === 'boolean' ? force : !radarOn;
    if (!map || !radarLayer) return;
    if (radarOn) radarLayer.addTo(map);
    else map.removeLayer(radarLayer);
    const btn = $('.map-layer[data-map-layer="rain"]');
    if (btn) btn.classList.toggle('active', radarOn);
  }

  function mapIcon(ev) {
    const quake = ev.type === '地震';
    return L.divIcon({
      className: 'map-marker-wrap',
      html: `<span class="map-marker ${quake ? 'is-quake' : ''}" style="--pin:${ev.color}">
        <i class="mm-ring"></i><i class="mm-dot"></i>
        <span class="mm-label">${escapeHtml(ev.label || ev.name)}</span>
      </span>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });
  }

  function rebuildMapMarkers() {
    if (!map || !mapMarkerLayer) return;
    mapMarkerLayer.clearLayers();
    events.forEach(ev => {
      if (!Number.isFinite(ev.lat) || !Number.isFinite(ev.lon)) return;
      const marker = L.marker([ev.lat, ev.lon], {
        icon: mapIcon(ev),
        riseOnHover: true,
        title: ev.name
      });
      marker.__eventKey = ev.key;
      marker.on('click', () => selectEvent(ev.key));
      marker.addTo(mapMarkerLayer);
      if (ev.key === selectedKey) {
        const apply = () => {
          const el = marker.getElement();
          if (el) el.classList.add('active');
        };
        apply();
        setTimeout(apply, 0);
      }
    });
    syncMapSelection();
    updateMapStatus();
  }

  function updateMapReadout() {
    if (!map) return;
    const c = map.getCenter();
    $('#mapCoords').textContent = `${fmtLat(c.lat)} ${fmtLon(c.lng)}`;
    $('#mapZoom').textContent = `Z ${pad(map.getZoom())}`;
    updateMapStatus();
  }

  function setStageMode(mode) {
    stageMode = mode;
    const isMap = mode === 'map';
    $('#stage').classList.toggle('map-mode', isMap);
    $$('.view-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.stageView === mode));

    if (isMap) {
      initMap();
      $('#stageView').innerHTML = '<b>地图视图 01</b><span>DEEP ZOOM · 高德 / NASA GIBS / 雷达</span>';
      setTimeout(() => {
        if (!map) return;
        map.invalidateSize();
        if (!mapHasOpened) {
          const ev = eventByKey(selectedKey);
          if (ev) map.setView([ev.lat, ev.lon], 3);
          mapHasOpened = true;
        }
        updateMapReadout();
      }, 90);
    } else {
      $('#stageView').innerHTML = '<b>观测视角 03</b><span>ALT 35,786 KM · 东经 105° 上空</span>';
    }
  }

  $$('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => setStageMode(btn.dataset.stageView));
  });

  $$('.map-layer[data-map-layer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.mapLayer;
      if (name === 'rain') toggleRadar();
      else setMapBase(name);
    });
  });

  $('#mapReset').addEventListener('click', () => {
    if (map) map.flyTo([20, 105], 2, { duration: 1 });
  });

  /* ==========================================================
     网络空间模式 · 本机探针 + 合成骨干流量
  ========================================================== */
  const NET_NODES = [
    { name: '北京', lat: 39.9, lon: 116.4 },
    { name: '上海', lat: 31.2, lon: 121.5 },
    { name: '新加坡', lat: 1.35, lon: 103.8 },
    { name: '东京', lat: 35.7, lon: 139.7 },
    { name: '法兰克福', lat: 50.1, lon: 8.7 },
    { name: '伦敦', lat: 51.5, lon: -0.1 },
    { name: '弗吉尼亚', lat: 38.9, lon: -77.4 },
    { name: '旧金山', lat: 37.8, lon: -122.4 },
    { name: '圣保罗', lat: -23.5, lon: -46.6 },
    { name: '悉尼', lat: -33.9, lon: 151.2 },
    { name: '迪拜', lat: 25.2, lon: 55.3 },
    { name: '孟买', lat: 19.1, lon: 72.9 }
  ];

  const NET_LINKS = [
    { a: 0, b: 4, color: '#2b6bff', speed: 0.00018, phase: 0.1 },
    { a: 0, b: 2, color: '#0f9f8a', speed: 0.00022, phase: 0.4 },
    { a: 4, b: 6, color: '#2b6bff', speed: 0.00016, phase: 0.7 },
    { a: 5, b: 7, color: '#2b6bff', speed: 0.0002, phase: 0.2 },
    { a: 7, b: 9, color: '#0f9f8a', speed: 0.00017, phase: 0.55 },
    { a: 8, b: 5, color: '#2b6bff', speed: 0.00014, phase: 0.35 },
    { a: 10, b: 11, color: '#2b6bff', speed: 0.00024, phase: 0.8 },
    { a: 11, b: 4, color: '#0f9f8a', speed: 0.00019, phase: 0.6 },
    { a: 9, b: 2, color: '#2b6bff', speed: 0.00021, phase: 0.15 },
    { a: 3, b: 6, color: '#d99a2b', speed: 0.00018, phase: 0.45, warn: true },
    { a: 1, b: 4, color: '#d94a3d', speed: 0.00023, phase: 0.9, bad: true },
    { a: 0, b: 6, color: '#2b6bff', speed: 0.00015, phase: 0.5 }
  ];

  const THREAT_TEMPLATES = [
    { tag: 'DDoS', level: 'high', text: '持续流量洪泛，目标法兰克福边缘节点', target: '法兰克福', value: '42.6 Gbps' },
    { tag: 'SCAN', level: 'mid', text: '来自 198.51.100.24 的横向端口扫描', target: '上海', value: '1,842 ports/min' },
    { tag: 'DNS', level: 'high', text: '高熵域名查询命中 DNS 隧道特征', target: '弗吉尼亚', value: '3.8K qps' },
    { tag: 'TLS', level: 'mid', text: '异常 TLS 指纹与自签名证书链', target: '新加坡', value: 'SNI mismatch' },
    { tag: 'BOT', level: 'mid', text: 'IoT 僵尸网络活动较基线上升', target: '东京', value: '+38%' },
    { tag: 'ANOMALY', level: 'low', text: '夜间时段出口流量偏离基线 3.4σ', target: '北京', value: '3.4σ' },
    { tag: 'BGP', level: 'high', text: '检测到异常路由前缀宣告', target: '伦敦', value: '/24 hijack' }
  ];

  const CITY_POOL = ['北京', '上海', '新加坡', '东京', '法兰克福', '伦敦', '弗吉尼亚', '旧金山', '圣保罗', '悉尼', '迪拜', '孟买'];
  const CYBER_PROBE_URL = (location.protocol === 'http:' || location.protocol === 'https:')
    ? '/api/netstats'
    : 'http://127.0.0.1:8792/api/netstats';

  let cyberStarted = false;
  let cyberCanvas = null;
  let cyberCtx = null;
  let cyberW = 1;
  let cyberH = 1;
  let cyberImage = null;
  let cyberMapTexture = null;
  let cyberImageReady = false;
  let chartCanvas = null;
  let chartCtx = null;
  let probeLive = false;
  let probeLast = null;
  let probeTimer = null;
  let lastCyberFrame = 0;
  let cyberFrames = 0;
  let earthTickerText = '';
  let cyberTickerTimer = null;
  let lastTotalMbps = 0;
  let attacksBlocked = 42;
  let realFeed = null;
  let realFeedActive = false;
  let realConnectionCount = null;
  let latestBgp = null;
  let cyberMapBound = false;

  const cyberCam = {
    scale: 1,
    panX: 0,
    panY: 0,
    trackMode: 'off',
    point: null,
    label: ''
  };

  const RRC_GEO = {
    rrc00: [52.37, 4.89], rrc01: [51.51, -0.13], rrc03: [52.37, 4.89],
    rrc04: [46.20, 6.14], rrc05: [48.21, 16.37], rrc06: [35.68, 139.69],
    rrc07: [59.33, 18.07], rrc08: [37.34, -121.89], rrc10: [45.46, 9.19],
    rrc11: [40.71, -74.01], rrc12: [50.11, 8.68], rrc13: [55.76, 37.62],
    rrc14: [37.44, -122.14], rrc15: [-23.55, -46.63], rrc16: [25.76, -80.19],
    rrc18: [41.39, 2.17], rrc19: [-26.20, 28.05], rrc20: [47.38, 8.54],
    rrc21: [48.86, 2.35], rrc22: [45.46, 9.19], rrc23: [1.35, 103.82],
    rrc24: [6.52, 3.38], rrc25: [52.37, 4.89], rrc26: [43.65, -79.38]
  };

  const cyberMetrics = {
    down: 0, up: 0, pps: 0, flows: 18420, loss: 0.02,
    historyDown: [], historyUp: []
  };

  function fmtNum(n, digits = 1) {
    if (!Number.isFinite(n)) return '--';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    if (n >= 100) return String(Math.round(n));
    return n.toFixed(digits);
  }

  function updateTickerText(text) {
    $$('.ticker-track span').forEach(span => { span.textContent = text; });
  }

  function updateEarthTicker() {
    const top = events.find(e => ['强风暴', '野火', '火山', '洪水'].includes(e.type)) || events[0];
    const focus = top ? `${top.label || top.name} · ${fmtLat(top.lat)} ${fmtLon(top.lon)}` : '等待实时事件';
    earthTickerText = `实时事件 ${events.length} 条 · ${focus} · 在轨卫星 12/12 · 全球覆盖率 99.7% · 数据源 USGS + NASA EONET · ` +
      `CO₂ 424.6 ppm · 全球均温 +1.35°C · 北极海冰 4.28M km² · 守护我们唯一的家园 · FOR OUR ONLY HOME ·`;
    if (appMode === 'earth') updateTickerText(earthTickerText);
  }

  function cyberTicker() {
    const total = cyberMetrics.down + cyberMetrics.up;
    const flows = realConnectionCount == null ? Math.round(cyberMetrics.flows) : realConnectionCount;
    const bgp = latestBgp ? `${latestBgp.prefix} · AS${latestBgp.origin}` : '等待 RIS 流';
    updateTickerText(
      `实时吞吐 ${total.toFixed(1)} Mbps · 下行 ${cyberMetrics.down.toFixed(1)} · 上行 ${cyberMetrics.up.toFixed(1)} · ` +
      `本机 TCP ${flows} · BGP ${bgp} · 情报命中 ${attacksBlocked} · ` +
      `本机探针 ${probeLive ? '在线' : '未连接'} · 真实 BGP / 威胁情报 / 本机连接 · 拓扑为示意 ·`
    );
  }

  function startCyber() {
    if (cyberStarted) return;
    cyberStarted = true;
    cyberCanvas = $('#netMapCanvas');
    cyberCtx = cyberCanvas.getContext('2d');
    chartCanvas = $('#trafficChart');
    chartCtx = chartCanvas.getContext('2d');

    cyberImage = new Image();
    cyberImage.onload = () => {
      const off = document.createElement('canvas');
      off.width = cyberImage.width;
      off.height = cyberImage.height;
      const octx = off.getContext('2d');
      octx.filter = 'grayscale(1) sepia(.2) hue-rotate(175deg) saturate(2.4) brightness(1.2)';
      octx.drawImage(cyberImage, 0, 0);
      cyberMapTexture = off;
      cyberImageReady = true;
    };
    cyberImage.src = EARTH_TEXTURES.night;

    for (let i = 0; i < 64; i++) {
      const base = 700 + Math.sin(i * 0.28) * 140 + Math.cos(i * 0.11) * 90;
      cyberMetrics.historyDown.push(base * 0.72);
      cyberMetrics.historyUp.push(base * 0.28);
    }
    cyberMetrics.down = 612.4;
    cyberMetrics.up = 230.2;
    cyberMetrics.pps = 128400;
    lastTotalMbps = cyberMetrics.down + cyberMetrics.up;

    resizeCyber();
    bindCyberMap();
    if (window.ResizeObserver) new ResizeObserver(resizeCyber).observe($('#cyberStage'));
    else window.addEventListener('resize', resizeCyber);

    addThreat({ tag: 'DDoS', level: 'high', text: '持续流量洪泛，目标法兰克福边缘节点', target: '法兰克福', value: '42.6 Gbps' }, true);
    addThreat({ tag: 'DNS', level: 'mid', text: '高熵域名查询命中 DNS 隧道特征', target: '弗吉尼亚', value: '3.8K qps' }, true);
    addThreat({ tag: 'SCAN', level: 'low', text: '来自 192.0.2.18 的低速端口探测已阻断', target: '北京', value: 'blocked' }, true);
    addThreat({ tag: 'TLS', level: 'mid', text: '异常 TLS 指纹与自签名证书链', target: '新加坡', value: 'SNI mismatch' }, true);
    addThreat({ tag: 'BOT', level: 'mid', text: 'IoT 僵尸网络活动较基线上升', target: '东京', value: '+38%' }, true);

    for (let i = 0; i < 8; i++) addFlow(true);

    updateTrafficUI();
    drawTrafficChart();
    updateProbeUI(false);

    setInterval(updateTraffic, 800);
    setInterval(() => { if (!realFeedActive) addThreat(); }, 7200);
    setInterval(() => { if (!realFeedActive) addFlow(); }, 1500);
    setInterval(updateProtocols, 3400);
    setInterval(updateLinkInfo, 4500);
    probeTimer = setInterval(probeNetwork, 2200);
    probeNetwork();
    cyberTickerTimer = setInterval(() => { if (appMode === 'cyber') cyberTicker(); }, 1600);
    startRealFeed();
    requestAnimationFrame(cyberLoop);
  }

  function resizeCyber() {
    if (!cyberCanvas) return;
    const rect = $('#cyberStage').getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cyberW = rect.width;
    cyberH = rect.height;
    cyberCanvas.width = Math.round(cyberW * dpr);
    cyberCanvas.height = Math.round(cyberH * dpr);
    cyberCanvas.style.width = `${cyberW}px`;
    cyberCanvas.style.height = `${cyberH}px`;
    cyberCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cyberClampCamera();
    drawTrafficChart();
  }

  /* ---------- 网络地图相机：缩放 / 平移 / 持续追踪 ---------- */
  function cyberMapMetrics() {
    const mapW = Math.min(cyberW * 0.92, cyberH * 1.9);
    const mapH = mapW / 2;
    return { mapW, mapH, mx: (cyberW - mapW) / 2, my: (cyberH - mapH) / 2 - 6 };
  }

  function cyberBasePoint(lat, lon) {
    const { mapW, mapH, mx, my } = cyberMapMetrics();
    return [mx + (lon + 180) / 360 * mapW, my + (90 - lat) / 180 * mapH];
  }

  function cyberScreenPoint(lat, lon) {
    const [bx, by] = cyberBasePoint(lat, lon);
    const cx = cyberW / 2;
    const cy = cyberH / 2;
    return [
      cx + (bx - cx) * cyberCam.scale + cyberCam.panX,
      cy + (by - cy) * cyberCam.scale + cyberCam.panY
    ];
  }

  function cyberClampCamera() {
    const maxX = (cyberCam.scale - 1) * cyberW * 0.5 + 20;
    const maxY = (cyberCam.scale - 1) * cyberH * 0.5 + 20;
    cyberCam.panX = Math.max(-maxX, Math.min(maxX, cyberCam.panX));
    cyberCam.panY = Math.max(-maxY, Math.min(maxY, cyberCam.panY));
  }

  function cyberUpdateTrackUI() {
    const btn = $('#cyberTrackBtn');
    const info = $('#cyberTrackInfo');
    if (btn) btn.classList.toggle('active', cyberCam.trackMode !== 'off');
    if (info) {
      if (cyberCam.trackMode === 'off') info.textContent = 'TRACK OFF · 滚轮缩放 / 拖动平移';
      else info.textContent = `TRACK ${cyberCam.trackMode === 'live' ? 'LIVE' : 'NODE'} · ${cyberCam.label || 'waiting'}`;
    }
  }

  function cyberTrackPoint(lat, lon, label, mode = 'node') {
    cyberCam.point = [lat, lon];
    cyberCam.label = label;
    cyberCam.trackMode = mode;
    if (cyberCam.scale < 1.8) cyberCam.scale = 1.8;
    cyberClampCamera();
    cyberUpdateTrackUI();
  }

  function cyberStopTrack() {
    cyberCam.trackMode = 'off';
    cyberCam.point = null;
    cyberCam.label = '';
    cyberUpdateTrackUI();
  }

  function cyberFollow(instant = false) {
    if (cyberCam.trackMode === 'off' || !cyberCam.point) return;
    const [bx, by] = cyberBasePoint(cyberCam.point[0], cyberCam.point[1]);
    const cx = cyberW / 2;
    const cy = cyberH / 2;
    const targetX = (cx - bx) * cyberCam.scale;
    const targetY = (cy - by) * cyberCam.scale;
    const k = instant ? 1 : 0.1;
    cyberCam.panX += (targetX - cyberCam.panX) * k;
    cyberCam.panY += (targetY - cyberCam.panY) * k;
    cyberClampCamera();
  }

  function cyberResetCamera() {
    cyberCam.scale = 1;
    cyberCam.panX = 0;
    cyberCam.panY = 0;
    cyberStopTrack();
  }

  function cyberZoomAt(factor, px, py) {
    const old = cyberCam.scale;
    const next = Math.max(1, Math.min(5, old * factor));
    if (next === old) return;
    const cx = cyberW / 2;
    const cy = cyberH / 2;
    const screenX = px == null ? cx : px;
    const screenY = py == null ? cy : py;
    const baseX = cx + (screenX - cx - cyberCam.panX) / old;
    const baseY = cy + (screenY - cy - cyberCam.panY) / old;
    cyberCam.scale = next;
    cyberCam.panX = screenX - cx - (baseX - cx) * next;
    cyberCam.panY = screenY - cy - (baseY - cy) * next;
    if (cyberCam.trackMode !== 'live') cyberStopTrack();
    cyberClampCamera();
  }

  function cyberHitNode(px, py) {
    let best = null;
    let bestD = 14;
    NET_NODES.forEach((node, index) => {
      const [x, y] = cyberScreenPoint(node.lat, node.lon);
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) { bestD = d; best = { node, index }; }
    });
    return best;
  }

  function cyberCollectorGeo(host) {
    const key = String(host || '').toLowerCase().match(/rrc\d+/);
    return key ? RRC_GEO[key[0]] || null : null;
  }

  function bindCyberMap() {
    if (cyberMapBound || !cyberCanvas) return;
    cyberMapBound = true;
    let drag = null;
    let moved = false;

    cyberCanvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = cyberCanvas.getBoundingClientRect();
      cyberZoomAt(e.deltaY < 0 ? 1.16 : 1 / 1.16, e.clientX - rect.left, e.clientY - rect.top);
      if (cyberCam.trackMode === 'node') cyberStopTrack();
    }, { passive: false });

    cyberCanvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, panX: cyberCam.panX, panY: cyberCam.panY };
      moved = false;
      cyberCanvas.setPointerCapture(e.pointerId);
      cyberCanvas.style.cursor = 'grabbing';
    });

    cyberCanvas.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) {
        cyberCam.panX = drag.panX + dx;
        cyberCam.panY = drag.panY + dy;
        if (cyberCam.trackMode === 'node') cyberStopTrack();
        cyberClampCamera();
      }
    });

    const endDrag = e => {
      if (!drag) return;
      const wasMoved = moved;
      drag = null;
      cyberCanvas.style.cursor = 'grab';
      try { cyberCanvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (wasMoved) return;
      const rect = cyberCanvas.getBoundingClientRect();
      const hit = cyberHitNode(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) cyberTrackPoint(hit.node.lat, hit.node.lon, hit.node.name, 'node');
    };
    cyberCanvas.addEventListener('pointerup', endDrag);
    cyberCanvas.addEventListener('pointercancel', () => { drag = null; cyberCanvas.style.cursor = 'grab'; });

    cyberCanvas.addEventListener('dblclick', () => cyberResetCamera());

    const zoomIn = $('#cyberZoomIn');
    const zoomOut = $('#cyberZoomOut');
    const reset = $('#cyberZoomReset');
    const track = $('#cyberTrackBtn');
    if (zoomIn) zoomIn.addEventListener('click', () => cyberZoomAt(1.28));
    if (zoomOut) zoomOut.addEventListener('click', () => cyberZoomAt(1 / 1.28));
    if (reset) reset.addEventListener('click', () => cyberResetCamera());
    if (track) {
      track.addEventListener('click', () => {
        if (cyberCam.trackMode !== 'off') {
          cyberStopTrack();
          return;
        }
        if (latestBgp) {
          const geo = cyberCollectorGeo(latestBgp.collector);
          if (geo) {
            cyberTrackPoint(geo[0], geo[1], `${latestBgp.collector} · ${latestBgp.prefix}`, 'live');
            return;
          }
        }
        cyberTrackPoint(NET_NODES[0].lat, NET_NODES[0].lon, NET_NODES[0].name, 'live');
      });
    }
    cyberUpdateTrackUI();
  }

  function cyberLoop(ts) {
    requestAnimationFrame(cyberLoop);
    if (appMode !== 'cyber') return;
    if (ts - lastCyberFrame < 33) return;
    lastCyberFrame = ts;
    drawCyberMap(ts);
  }

  function drawCyberMap(ts) {
    const ctx = cyberCtx;
    if (!ctx) return;
    const t = ts / 1000;
    ctx.clearRect(0, 0, cyberW, cyberH);
    cyberFollow();

    ctx.save();
    ctx.translate(cyberW / 2 + cyberCam.panX, cyberH / 2 + cyberCam.panY);
    ctx.scale(cyberCam.scale, cyberCam.scale);
    ctx.translate(-cyberW / 2, -cyberH / 2);

    const mapW = Math.min(cyberW * 0.92, cyberH * 1.9);
    const mapH = mapW / 2;
    const mx = (cyberW - mapW) / 2;
    const my = (cyberH - mapH) / 2 - 6;

    if (cyberImageReady && cyberMapTexture) {
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(cyberMapTexture, 0, 0, cyberMapTexture.width, cyberMapTexture.height, mx, my, mapW, mapH);
      ctx.restore();
    }

    const veil = ctx.createLinearGradient(0, my, 0, my + mapH);
    veil.addColorStop(0, 'rgba(4,13,24,.32)');
    veil.addColorStop(0.5, 'rgba(4,13,24,.06)');
    veil.addColorStop(1, 'rgba(4,13,24,.42)');
    ctx.fillStyle = veil;
    ctx.fillRect(mx, my, mapW, mapH);

    // 地图边框与经纬网格
    ctx.strokeStyle = 'rgba(90,170,255,.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mapW, mapH);
    ctx.strokeStyle = 'rgba(90,170,255,.10)';
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

    // 链路
    NET_LINKS.forEach(link => {
      const a = NET_NODES[link.a];
      const b = NET_NODES[link.b];
      const p0 = project(a.lat, a.lon);
      const p1 = project(b.lat, b.lon);
      const midX = (p0[0] + p1[0]) / 2;
      const midY = Math.min(p0[1], p1[1]) - Math.abs(p1[0] - p0[0]) * 0.16 - 28;

      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.quadraticCurveTo(midX, midY, p1[0], p1[1]);
      ctx.strokeStyle = link.bad ? 'rgba(255,110,95,.8)' : link.warn ? 'rgba(255,190,90,.65)' : 'rgba(86,168,255,.4)';
      ctx.lineWidth = link.bad || link.warn ? 1.5 : 1;
      ctx.stroke();

      const u = ((t * link.speed * 1000 + link.phase) % 1);
      const qx = (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * midX + u * u * p1[0];
      const qy = (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * midY + u * u * p1[1];
      ctx.beginPath();
      ctx.arc(qx, qy, link.bad ? 2.8 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = link.bad ? '#ff7a66' : link.warn ? '#ffc46b' : '#7fc4ff';
      ctx.shadowBlur = 10;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // 节点
    NET_NODES.forEach((node, i) => {
      const [x, y] = project(node.lat, node.lon);
      const major = i === 0 || i === 4 || i === 6;
      ctx.beginPath();
      ctx.arc(x, y, major ? 4.2 : 2.8, 0, Math.PI * 2);
      ctx.fillStyle = major ? '#8fc4ff' : '#6f9fd8';
      ctx.shadowBlur = major ? 16 : 9;
      ctx.shadowColor = 'rgba(90,180,255,.9)';
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(x, y, major ? 9 : 6, 0, Math.PI * 2);
      ctx.strokeStyle = major ? 'rgba(120,190,255,.42)' : 'rgba(100,150,200,.26)';
      ctx.stroke();

      if (major || cyberW > 900) {
        ctx.font = `${major ? 10 : 8.5}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = major ? 'rgba(228,244,255,.95)' : 'rgba(156,190,222,.8)';
        ctx.fillText(node.name, x + 8, y - 6);
      }
    });

    // 攻击脉冲
    const targets = [4, 6, 0];
    targets.forEach((idx, k) => {
      const [x, y] = project(NET_NODES[idx].lat, NET_NODES[idx].lon);
      const phase = ((t * 0.55 + k * 0.31) % 1);
      ctx.beginPath();
      ctx.arc(x, y, 6 + phase * 30, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,100,85,${(1 - phase) * 0.65})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });

    // 真实 BGP 事件：在采集器地理位置画脉冲
    if (latestBgp) {
      const geo = cyberCollectorGeo(latestBgp.collector);
      if (geo) {
        const [x, y] = project(geo[0], geo[1]);
        const phase = (t * 0.8) % 1;
        ctx.beginPath();
        ctx.arc(x, y, 3 + phase * 26, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(95,240,224,${(1 - phase) * 0.75})`;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = '#5ff0e0';
        ctx.shadowBlur = 14;
        ctx.shadowColor = '#5ff0e0';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = '8px "Cascadia Mono", monospace';
        ctx.fillStyle = 'rgba(180,245,240,.85)';
        ctx.fillText(`BGP ${latestBgp.prefix}`, x + 7, y - 7);
      }
    }

    ctx.restore();
  }

  function updateTraffic() {
    let down, up, pps, flows, loss;
    if (probeLive && probeLast && probeLast.totals) {
      down = (Number(probeLast.totals.rxBps) || 0) * 8 / 1e6;
      up = (Number(probeLast.totals.txBps) || 0) * 8 / 1e6;
      pps = ((Number(probeLast.totals.rxBps) || 0) + (Number(probeLast.totals.txBps) || 0)) / 1100;
      flows = Number(probeLast.connections) || Math.round(800 + pps * 0.06);
      loss = Number(probeLast.loss) || 0;
    } else {
      const t = Date.now() / 1000;
      const base = 780 + Math.sin(t * 0.21) * 170 + Math.sin(t * 0.067) * 120 + (Math.random() - 0.5) * 36;
      down = base * 0.72;
      up = base * 0.28;
      pps = 92000 + Math.sin(t * 0.4) * 18000 + Math.random() * 5200;
      flows = 17600 + Math.sin(t * 0.09) * 1800 + Math.random() * 340;
      loss = 0.012 + Math.random() * 0.02;
    }

    cyberMetrics.down = Math.max(0, down);
    cyberMetrics.up = Math.max(0, up);
    cyberMetrics.pps = Math.max(0, pps);
    cyberMetrics.flows = Math.max(0, flows);
    cyberMetrics.loss = loss;

    cyberMetrics.historyDown.push(cyberMetrics.down);
    cyberMetrics.historyUp.push(cyberMetrics.up);
    if (cyberMetrics.historyDown.length > 72) cyberMetrics.historyDown.shift();
    if (cyberMetrics.historyUp.length > 72) cyberMetrics.historyUp.shift();

    updateTrafficUI();
    drawTrafficChart();
    if (appMode === 'cyber') cyberTicker();
  }

  function updateTrafficUI() {
    const total = cyberMetrics.down + cyberMetrics.up;
    const trend = lastTotalMbps ? ((total - lastTotalMbps) / Math.max(lastTotalMbps, 0.001)) * 100 : 0;
    lastTotalMbps = total;
    const m = $('#thrMbps');
    if (m) m.textContent = total >= 100 ? total.toFixed(1) : total.toFixed(2);
    const d = $('#thrDown'); if (d) d.textContent = cyberMetrics.down.toFixed(cyberMetrics.down < 10 ? 2 : 1);
    const u = $('#thrUp'); if (u) u.textContent = cyberMetrics.up.toFixed(cyberMetrics.up < 10 ? 2 : 1);
    const tr = $('#thrTrend');
    if (tr) {
      tr.textContent = `${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend).toFixed(1)}%`;
      tr.className = trend >= 0 ? 'up' : 'down';
    }
    const p = $('#ppsVal'); if (p) p.textContent = fmtNum(cyberMetrics.pps);
    const shownFlows = realConnectionCount == null ? cyberMetrics.flows : realConnectionCount;
    const f = $('#flowVal'); if (f) f.textContent = Math.round(shownFlows).toLocaleString();
    const l = $('#lossVal'); if (l) l.textContent = `${cyberMetrics.loss.toFixed(2)}%`;
    const af = $('#activeFlows'); if (af) af.textContent = fmtNum(shownFlows);
    const ab = $('#attacksBlocked'); if (ab) ab.textContent = attacksBlocked;
  }

  function drawTrafficChart() {
    if (!chartCtx) return;
    const ctx = chartCtx;
    const W = chartCanvas.width, H = chartCanvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(95,240,224,.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = (H / 5) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const down = cyberMetrics.historyDown.slice(-72);
    const up = cyberMetrics.historyUp.slice(-72);
    const max = Math.max(1.2, ...down, ...up) * 1.18;
    const step = W / Math.max(1, down.length - 1);

    function pathFor(data, color, fill) {
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i * step;
        const y = H - 12 - (v / max) * (H - 28);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.lineTo((data.length - 1) * step, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, fill);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i * step;
        const y = H - 12 - (v / max) * (H - 28);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    pathFor(down, '#4a9eff', 'rgba(74,158,255,.18)');
    pathFor(up, '#5ff0e0', 'rgba(95,240,224,.12)');
  }

  function addThreat(preset, silent = false) {
    const list = $('#threatList');
    if (!list) return;
    const t = preset || THREAT_TEMPLATES[Math.floor(Math.random() * THREAT_TEMPLATES.length)];
    const li = document.createElement('li');
    li.className = `threat-item ${t.level}`;
    const now = new Date();
    li.innerHTML = `
      <div class="threat-top">
        <span class="threat-tag">${escapeHtml(t.tag)}</span>
        <span class="threat-time">${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}</span>
      </div>
      <p>${escapeHtml(t.text)}</p>
      <em>${escapeHtml(t.target)} · ${escapeHtml(t.value)}</em>`;
    list.prepend(li);
    while (list.children.length > 5) list.lastElementChild.remove();

    if (t.level === 'high') {
      attacksBlocked++;
      const ab = $('#attacksBlocked'); if (ab) ab.textContent = attacksBlocked;
      if (!silent) showAttackToast(t);
    }
  }

  function showAttackToast(t) {
    const toast = $('#attackToast');
    if (!toast) return;
    toast.querySelector('span').textContent = t.tag;
    toast.querySelector('b').textContent = `${t.target}节点`;
    toast.querySelector('em').textContent = t.value;
    toast.classList.add('show');
    clearTimeout(showAttackToast._timer);
    showAttackToast._timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function addFlow(silent = false) {
    const list = $('#flowList');
    if (!list) return;
    const proto = ['TLS 1.3', 'QUIC', 'HTTPS', 'DNS', 'TCP'][Math.floor(Math.random() * 5)];
    const state = Math.random() > 0.14 ? 'ALLOWED' : 'BLOCKED';
    const srcCity = CITY_POOL[Math.floor(Math.random() * CITY_POOL.length)];
    const dstCity = CITY_POOL[Math.floor(Math.random() * CITY_POOL.length)];
    const src = `10.${20 + Math.floor(Math.random() * 40)}.${Math.floor(Math.random() * 200)}.${10 + Math.floor(Math.random() * 240)}`;
    const dst = `198.51.100.${10 + Math.floor(Math.random() * 240)}`;
    const row = document.createElement('div');
    row.className = 'flow-row';
    row.innerHTML = `
      <span class="fl-src"><b>${src}</b><em>${srcCity}</em></span>
      <span class="fl-dst"><b>${dst}</b><em>${dstCity}</em></span>
      <span class="fl-proto">${proto}</span>
      <span class="fl-state ${state === 'ALLOWED' ? 'ok' : 'blocked'}">${state}</span>`;
    list.prepend(row);
    while (list.children.length > 10) list.lastElementChild.remove();
    if (!silent) {
      const fc = $('#flowCount');
      if (fc) fc.textContent = fmtNum(cyberMetrics.flows);
    }
  }

  /* ---------- 实时数据：SSE / BGP / 威胁 / 本机 TCP ---------- */
  let realFeeds = {};

  function setFeedStatus(state, text) {
    const el = $('#feedStatus');
    if (!el) return;
    el.className = `head-note ${state}`;
    el.innerHTML = `<i></i>${text}`;
    const live = $('#cyberLive');
    if (live) {
      live.className = `cyber-live ${state}`;
      live.innerHTML = `<i></i>${state === 'live' ? 'LIVE BGP · RIS' : 'FEED ' + (state === 'error' ? 'ERROR' : 'CONNECTING')}`;
    }
  }

  function updateFeedStatus(feeds = realFeeds) {
    realFeeds = { ...realFeeds, ...feeds };
    const ris = realFeeds.ris || {};
    const local = realFeeds.local || {};
    const kev = realFeeds.kev || {};
    const state = ris.state === 'live' ? 'live' : ris.state === 'error' ? 'error' : 'connecting';
    setFeedStatus(state, ris.state === 'live' ? 'RIS LIVE' : ris.state === 'error' ? 'RIS ERROR' : 'RIS CONNECTING');
    const hint = $('#cyberHint');
    if (hint) {
      hint.textContent = `BGP ${ris.state || '--'} · KEV ${kev.state || '--'} · 本机 TCP ${local.state || '--'} · 拓扑为示意`;
      hint.classList.toggle('live', state === 'live');
    }
  }

  function handleBgpEvent(ev) {
    if (!ev || !ev.prefix) return;
    latestBgp = ev;
    const prefix = $('#cyberBgpPrefix');
    const detail = $('#cyberBgpDetail');
    if (prefix) prefix.textContent = ev.prefix;
    if (detail) detail.textContent = `AS${ev.origin || '--'} · ${ev.collector || 'rrc'} · ${ev.kind === 'W' ? 'WITHDRAW' : 'ANNOUNCE'}`;
    if (cyberCam.trackMode === 'live') {
      const geo = cyberCollectorGeo(ev.collector);
      if (geo) cyberTrackPoint(geo[0], geo[1], `${ev.collector} · ${ev.prefix}`, 'live');
    }
  }

  function renderConnections(payload) {
    const data = payload && payload.connections ? payload : { connections: [] };
    const list = $('#flowList');
    if (!list) return;
    const rows = (data.connections || []).slice(0, 10);
    list.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<div class="flow-empty">NO EXTERNAL TCP · 本机回环连接已过滤</div>';
    }
    rows.forEach(c => {
      const src = `${c.local || '--'}:${c.localPort || '--'}`;
      const dst = `${c.remote || '--'}:${c.remotePort || '--'}`;
      const row = document.createElement('div');
      row.className = 'flow-row';
      row.innerHTML = `
        <span class="fl-src"><b>${escapeHtml(src)}</b><em>LOCAL</em></span>
        <span class="fl-dst"><b>${escapeHtml(dst)}</b><em>REMOTE</em></span>
        <span class="fl-proto">TCP</span>
        <span class="fl-state ok">ESTABLISHED</span>`;
      list.appendChild(row);
    });
    const count = (data.connections || []).length;
    realConnectionCount = count;
    const fc = $('#flowCount');
    if (fc) fc.textContent = String(count);
    const fv = $('#flowVal');
    if (fv) fv.textContent = String(count);
    const af = $('#activeFlows');
    if (af) af.textContent = String(count);
    updateProtocolFromConnections(data.connections || []);
  }

  function updateProtocolFromConnections(rows) {
    if (!rows.length) return;
    const buckets = { HTTPS: 0, TCP: 0, DNS: 0, QUIC: 0, UDP: 0, OTHER: 0 };
    rows.forEach(c => {
      const p = Number(c.remotePort);
      if (p === 443 || p === 8443) buckets.HTTPS++;
      else if (p === 80 || p === 8080 || p === 8000 || p === 8792) buckets.TCP++;
      else if (p === 53) buckets.DNS++;
      else buckets.OTHER++;
    });
    const total = Math.max(1, rows.length);
    const dom = $$('#protocolBody .proto-row');
    dom.forEach(row => {
      const key = row.dataset.proto;
      const value = key === 'UDP' ? 0 : key === 'QUIC' ? 0 : (buckets[key] || 0);
      const pct = Math.round(value / total * 100);
      const bar = row.querySelector('i');
      const b = row.querySelector('b');
      if (bar) bar.style.width = `${Math.max(value ? 4 : 0, pct)}%`;
      if (b) b.textContent = `${pct}%`;
    });
  }

  function startRealFeed() {
    if (realFeed || location.protocol === 'file:') {
      if (location.protocol === 'file:') updateFeedStatus({ ris: { state: 'error' } });
      return;
    }
    if (!('EventSource' in window)) {
      updateFeedStatus({ ris: { state: 'error' } });
      return;
    }
    realFeed = new EventSource('/api/stream');
    realFeed.onopen = () => setFeedStatus('live', 'STREAM OPEN');
    realFeed.onerror = () => setFeedStatus('error', 'STREAM RETRY');
    realFeed.addEventListener('snapshot', event => {
      try {
        const data = JSON.parse(event.data);
        realFeedActive = true;
        updateFeedStatus(data.feeds || {});
        const list = $('#threatList');
        if (list) {
          list.innerHTML = '';
          (data.threats || []).slice().reverse().forEach(t => addThreat(t, true));
        }
        renderConnections({ connections: data.connections || [] });
        if (data.bgp && data.bgp.length) handleBgpEvent(data.bgp[0]);
      } catch (err) { /* ignore */ }
    });
    realFeed.addEventListener('feed', event => {
      try {
        const data = JSON.parse(event.data);
        if (data.key) updateFeedStatus({ [data.key]: data });
      } catch (err) { /* ignore */ }
    });
    realFeed.addEventListener('threat', event => {
      try {
        const threat = JSON.parse(event.data);
        realFeedActive = true;
        addThreat(threat, true);
      } catch (err) { /* ignore */ }
    });
    realFeed.addEventListener('bgp', event => {
      try { handleBgpEvent(JSON.parse(event.data)); } catch (err) { /* ignore */ }
    });
    realFeed.addEventListener('connections', event => {
      try {
        const data = JSON.parse(event.data);
        realFeedActive = true;
        renderConnections(data);
      } catch (err) { /* ignore */ }
    });
  }

  function updateProtocols() {
    if (realFeedActive) return;
    const base = [46, 18, 14, 12, 7, 3];
    const jitter = base.map(v => v + (Math.random() - 0.5) * 4);
    const sum = jitter.reduce((a, b) => a + b, 0);
    const normalized = jitter.map(v => Math.max(1, Math.round(v / sum * 100)));
    const rows = $$('#protocolBody .proto-row');
    rows.forEach((row, i) => {
      const val = normalized[i];
      const bar = row.querySelector('i');
      const b = row.querySelector('b');
      if (bar) bar.style.width = `${val}%`;
      if (b) b.textContent = `${val}%`;
    });
  }

  async function probeNetwork() {
    if (location.protocol === 'file:') {
      updateProbeUI(false);
      return;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2600);
      const res = await fetch(CYBER_PROBE_URL, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.totals) throw new Error('invalid probe payload');
      probeLast = data;
      if (!probeLive) {
        probeLive = true;
        lastTotalMbps = 0;
        const rd = (Number(data.totals.rxBps) || 0) * 8 / 1e6;
        const ru = (Number(data.totals.txBps) || 0) * 8 / 1e6;
        cyberMetrics.historyDown = new Array(36).fill(rd);
        cyberMetrics.historyUp = new Array(36).fill(ru);
        updateProbeUI(true);
        if (terminalStarted) pollTermSys();
      }
    } catch (err) {
      if (probeLive) {
        probeLive = false;
        probeLast = null;
        updateProbeUI(false);
      }
    }
  }

  function updateProbeUI(live) {
    const ps = $('#probeStatus');
    if (ps) {
      ps.innerHTML = live ? '<i></i>本机探针 · 实时' : '<i></i>合成流量 · 演示';
      ps.classList.toggle('probe-live', live);
    }
    const pl = $('#probeLink');
    if (pl) {
      pl.innerHTML = live ? '<i></i>探针在线' : '<i></i>未连接';
      pl.classList.toggle('probe-live', live);
    }
    updateLinkInfo();
  }

  function updateLinkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const api = $('#apiLatency');
    if (api) api.textContent = lastApiLatency
      ? (lastApiLatency > 1500 ? `${(lastApiLatency / 1000).toFixed(1)} s` : `${lastApiLatency} ms`)
      : '--';
    const dl = $('#netDownlink');
    if (dl) dl.textContent = conn && Number.isFinite(conn.downlink) ? `${conn.downlink} Mbps` : '--';
    const nt = $('#netType');
    if (nt) nt.textContent = conn && conn.effectiveType ? conn.effectiveType.toUpperCase() : '--';
    const no = $('#netOnline');
    if (no) no.textContent = navigator.onLine ? '在线' : '离线';

    const ai = $('#adapterInfo');
    if (ai) {
      if (probeLive && probeLast && probeLast.adapters && probeLast.adapters.length) {
        const a = probeLast.adapters[0];
        ai.textContent = `${a.name} · ${a.desc || '本机网卡'} · 2.2s 采样`;
      } else {
        ai.textContent = '本机探针未连接 · 当前为合成演示';
      }
    }
    const hint = document.querySelector('.cyber-hint');
    if (hint) hint.textContent = probeLive
      ? '本机网卡实时采样 · 全球拓扑为合成演示'
      : '合成骨干流量 · 启动 start.bat 接入本机探针';
  }

  function setAppMode(mode) {
    appMode = mode;
    const isCyber = mode === 'cyber';
    const isTerminal = mode === 'terminal';
    const earth = $('#earthScreen');
    const cyber = $('#cyberScreen');
    const terminal = $('#terminalScreen');
    if (earth) earth.hidden = mode !== 'earth';
    if (cyber) cyber.hidden = !isCyber;
    if (terminal) terminal.hidden = !isTerminal;
    $('#app').classList.toggle('mode-terminal', isTerminal);
    $$('.app-mode').forEach(btn => btn.classList.toggle('active', btn.dataset.appMode === mode));

    if (isTerminal) {
      $('#missionKicker').textContent = 'LOCAL SHELL / 安全终端';
      $('#missionName').innerHTML = '天网终端 <em>SKYNET TTY</em>';
      $('#footSub').textContent = 'LOCAL SHELL // REAL PROBES';
    } else if (isCyber) {
      $('#missionKicker').textContent = 'CYBER WATCH / 网络空间';
      $('#missionName').innerHTML = '网络脉搏 <em>CYBER PULSE</em>';
      $('#footSub').textContent = 'CYBER FABRIC NOMINAL';
    } else {
      $('#missionKicker').textContent = 'GLOBAL WATCH / 全球守望';
      $('#missionName').innerHTML = '地球脉动 <em>PLANET PULSE</em>';
      $('#footSub').textContent = 'ALL SYSTEMS NOMINAL';
    }

    if (isTerminal) {
      startTerminal();
      setTimeout(() => { if (termInput) termInput.focus(); }, 140);
    } else if (isCyber) {
      startCyber();
      setTimeout(() => { resizeCyber(); updateTraffic(); }, 80);
      cyberTicker();
    } else {
      updateTickerText(earthTickerText);
      if (map) setTimeout(() => map.invalidateSize(), 120);
    }
  }

  $$('.app-mode').forEach(btn => {
    btn.addEventListener('click', () => setAppMode(btn.dataset.appMode));
  });

  earthTickerText = $$('.ticker-track span')[0] ? $$('.ticker-track span')[0].textContent : '';

  const refreshBtn = $('#refreshLive');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadLiveData(true));

  /* ---- 会话 / 锁定 ---- */
  const lockBtn = $('#lockSession');
  if (lockBtn) {
    if (location.protocol === 'file:') {
      lockBtn.hidden = true;
    } else {
      fetch('/api/session', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.ok) $('#sessionUser').textContent = data.user;
        })
        .catch(() => {});
      lockBtn.addEventListener('click', async () => {
        try { await fetch('/api/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
        window.location.href = '/login.html';
      });
    }
  }

  /* ==========================================================
     终端模式 · eDEX 风格
  ========================================================== */
  let terminalStarted = false;
  let termInput = null;
  let termOut = null;
  let termFilesEl = null;
  let termEventsEl = null;
  let termCmdHistory = [];
  let termHistPos = -1;
  let termFiles = [];
  let termSys = null;
  let termCpuHistory = [];
  let termDownHistory = [];
  let termUpHistory = [];
  let termVisibleEvents = [];
  let termSysTimer = null;
  let termNetTimer = null;
  let termClockTimer = null;
  let termProbeTimer = null;

  const TERM_COMMANDS = [
    'help', 'status', 'events', 'event', 'focus', 'earth', 'map', 'net', 'refresh',
    'probe', 'ops', 'tools', 'recon', 'nmap', 'scan', 'web', 'vuln', 'audit', 'searchsploit',
    'msf', 'hydra', 'sqlmap', 'sqli', 'payload', 'scope', 'target', 'report', 'hash',
    'sys', 'neofetch', 'ls', 'cat', 'ping', 'clear', 'banner', 'reboot',
    'date', 'whoami', 'hostname', 'uptime', 'uname', 'ifconfig', 'exit', 'sudo', 'rm'
  ];

  const TERM_BANNER = [
    '███████╗██╗  ██╗██╗   ██╗███╗   ██╗███████╗████████╗',
    '██╔════╝██║ ██╔╝╚██╗ ██╔╝████╗  ██║██╔════╝╚══██╔══╝',
    '███████╗█████╔╝  ╚████╔╝ ██╔██╗ ██║█████╗     ██║   ',
    '╚════██║██╔═██╗   ╚██╔╝  ██║╚██╗██║██╔══╝     ██║   ',
    '███████║██║  ██╗   ██║   ██║ ╚████║███████╗   ██║   ',
    '╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝╚══════╝   ╚═╝   '
  ].join('\n');

  function termScroll() {
    if (termOut) termOut.scrollTop = termOut.scrollHeight;
  }

  function termLine(html = '', cls = '') {
    if (!termOut) return;
    const div = document.createElement('div');
    div.className = `term-line ${cls}`;
    div.innerHTML = html;
    termOut.appendChild(div);
    while (termOut.children.length > 420) termOut.firstElementChild.remove();
    termScroll();
  }

  function termEcho(cmd) {
    termLine(`<span style="color:#4fffd7">skynet@core:~$</span> <span style="color:#e4fffa">${escapeHtml(cmd)}</span>`);
  }

  function termBoot() {
    if (!termOut) return;
    termOut.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = 'term-banner';
    banner.textContent = TERM_BANNER;
    termOut.appendChild(banner);
    termLine('SKYNET // LOCAL SHELL · TTY1 · REAL PROBES', 'white');
    termLine('<span class="dim">TYPE</span> <span class="ok">help</span> <span class="dim">TO LIST COMMANDS ·</span> <span class="blue">↑↓</span> <span class="dim">HISTORY ·</span> <span class="blue">TAB</span> <span class="dim">COMPLETE</span>');
    termLine('');
    const secure = location.protocol === 'https:';
    let webgl = false;
    try { webgl = Boolean(document.createElement('canvas').getContext('webgl')); } catch (err) { webgl = false; }
    const lines = [
      [`[ ${secure ? 'OK' : '!!'} ] transport · ${secure ? 'HTTPS' : 'HTTP 明文（本地回环）'}`, secure ? 'ok' : 'warn'],
      [`[ ${webgl ? 'OK' : '!!'} ] earth engine · ${webgl ? 'WebGL renderer online' : 'WebGL unavailable'}`, webgl ? 'ok' : 'warn'],
      [`[ ${dataMode === 'live' ? 'OK' : '..'} ] feeds · USGS / NASA EONET · ${dataMode === 'live' ? 'LIVE' : 'SAMPLE'}`, dataMode === 'live' ? 'ok' : 'dim'],
      [location.protocol === 'file:' ? '[ !! ] local probe · OFFLINE (use start.bat)' : '[ OK ] local probe bridge · /api/sysstats /api/netstats', location.protocol === 'file:' ? 'warn' : 'ok'],
      [location.protocol === 'file:' ? '[ -- ] real probes · /api/lab/* needs local service' : '[ OK ] real probes · TCP · HTTP · TLS · DNS · ICMP · NVD · KEV', location.protocol === 'file:' ? 'dim' : 'ok'],
      ['[ .. ] waiting for operator input', 'dim']
    ];
    lines.forEach(([text, cls], i) => {
      setTimeout(() => {
        if (termOut) termLine(text, cls);
      }, 110 * (i + 1));
    });
  }

  function termFormatBytes(n) {
    if (!Number.isFinite(n)) return '--';
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}G`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)}M`;
    if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
    return `${n}B`;
  }

  function termFormatUptime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function termFallbackSys() {
    // 本机服务不可用时只使用浏览器真实暴露的字段，未知项保持 null（显示 --）。
    const nav = navigator;
    const deviceMem = Number(nav.deviceMemory);
    const uaData = nav.userAgentData || {};
    return {
      hostname: location.hostname || 'local',
      platform: uaData.platform || nav.platform || 'browser',
      release: '',
      arch: uaData.architecture || '--',
      uptime: performance.now() / 1000,
      cpuModel: '--',
      cores: Number(nav.hardwareConcurrency) || 0,
      cpuPct: null,
      memTotal: Number.isFinite(deviceMem) && deviceMem > 0 ? deviceMem * 1024 ** 3 : null,
      memFree: null,
      memPct: null,
      disk: null,
      node: 'browser',
      source: 'browser'
    };
  }

  async function pollTermSys() {
    let s = null;
    if (location.protocol !== 'file:') {
      try {
        const r = await fetch('/api/sysstats', { cache: 'no-store' });
        if (r.ok) s = await r.json();
      } catch (err) { /* fallback below */ }
    }
    if (!s) s = termFallbackSys();
    termSys = s;

    const cpu = Number.isFinite(s.cpuPct) ? Math.round(s.cpuPct) : null;
    const memPct = Number.isFinite(s.memPct) ? Math.round(s.memPct) : null;
    const diskPct = s.disk && Number.isFinite(s.disk.pct) ? Math.round(s.disk.pct) : null;

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const width = (id, v) => { const el = document.getElementById(id); if (el) el.style.width = `${clamp(v, 0, 100)}%`; };

    set('termCpu', cpu == null ? '--' : `${cpu}%`);
    set('termMem', memPct == null ? '--' : `${memPct}%`);
    set('termDisk', diskPct == null ? '--' : `${diskPct}%`);
    width('termCpuBar', cpu || 0);
    width('termMemBar', memPct || 0);
    width('termDiskBar', diskPct || 0);

    set('termHost', s.hostname || '--');
    set('termKernel', `${s.platform || '--'} ${s.release || ''}`.trim());
    set('termUptime2', termFormatUptime(s.uptime));
    set('termCores', String(s.cores || '--'));
    set('termUptime', `UPTIME ${termFormatUptime(s.uptime)}`);
    set('termFootHost', `HOST ${s.hostname || '--'}`);

    const probe = document.getElementById('termProbe');
    if (probe) {
      probe.textContent = probeLive ? 'ONLINE' : 'OFFLINE';
      probe.className = probeLive ? 'ok' : 'warn';
    }
    const usgs = document.getElementById('termUsgs');
    if (usgs) {
      usgs.textContent = dataMode === 'live' ? 'ONLINE' : 'SAMPLE';
      usgs.className = dataMode === 'live' ? 'ok' : 'warn';
    }
    const eonet = document.getElementById('termEonet');
    if (eonet) {
      eonet.textContent = dataMode === 'live' ? 'ONLINE' : 'SAMPLE';
      eonet.className = dataMode === 'live' ? 'ok' : 'warn';
    }
    set('termEventCount', String(events.length));
    const mapEngine = document.getElementById('termTiles');
    if (mapEngine) {
      const leaflet = window.L && window.L.version;
      mapEngine.textContent = leaflet ? `LEAFLET ${leaflet}` : '--';
      mapEngine.className = leaflet ? 'ok' : 'warn';
    }

    const foot = document.querySelectorAll('.term-foot-left span');
    if (foot[2]) foot[2].textContent = `MEM ${termMemText(s)}`;

    if (cpu != null) {
      termCpuHistory.push(cpu);
      if (termCpuHistory.length > 56) termCpuHistory.shift();
    }
    drawTermCpuGraph();
    termProcsRefresh();
  }

  function renderTermProc() {
    const list = document.getElementById('termProcList');
    if (!list) return;
    if (!termProcs.length) {
      list.innerHTML = '<div class="proc-row"><span class="p-pid">--</span><b>process data unavailable</b><span class="p-cpu">--</span><span class="p-mem">--</span></div>';
      return;
    }
    list.innerHTML = termProcs.slice(0, 6).map(p => {
      const cpu = Number.isFinite(p.cpuPct) ? `${p.cpuPct.toFixed(1)}%` : '--';
      return `<div class="proc-row"><span class="p-pid">${escapeHtml(String(p.pid))}</span><b>${escapeHtml(p.name || '--')}</b><span class="p-cpu">${cpu}</span><span class="p-mem">${p.mem ? termFormatBytes(p.mem) : '--'}</span></div>`;
    }).join('');
  }

  function drawTermCpuGraph() {
    const c = document.getElementById('termCpuGraph');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(79,255,215,.08)';
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    const data = termCpuHistory.slice(-56);
    if (data.length < 2) return;
    const step = W / Math.max(1, data.length - 1);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step;
      const y = H - 3 - (clamp(v, 0, 100) / 100) * (H - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo((data.length - 1) * step, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(79,255,215,.18)');
    grad.addColorStop(1, 'rgba(79,255,215,0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step;
      const y = H - 3 - (clamp(v, 0, 100) / 100) * (H - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#4fffd7';
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(79,255,215,.6)';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function pollTermNet() {
    let down = null;
    let up = null;
    let pps = null;
    if (probeLive && probeLast && probeLast.totals) {
      down = (Number(probeLast.totals.rxBps) || 0) * 8 / 1e6;
      up = (Number(probeLast.totals.txBps) || 0) * 8 / 1e6;
      pps = Number.isFinite(Number(probeLast.totals.pps)) ? Number(probeLast.totals.pps) : null;
    }

    const fmt = v => (v == null ? '--' : `${v.toFixed(v < 10 ? 2 : 1)} Mbps`);
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('termDown', fmt(down));
    set('termUp', fmt(up));
    set('termPps', pps == null ? '--' : fmtNum(pps));
    const foot = document.querySelectorAll('.term-foot-left span');
    if (foot[3]) foot[3].textContent = down == null ? 'NET --' : `NET ${down.toFixed(1)} Mbps`;

    if (down == null || up == null) {
      drawTermNetGraph();
      return;
    }
    termDownHistory.push(down);
    termUpHistory.push(up);
    if (termDownHistory.length > 60) termDownHistory.shift();
    if (termUpHistory.length > 60) termUpHistory.shift();
    drawTermNetGraph();
  }

  function drawTermNetGraph() {
    const c = document.getElementById('termNetGraph');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(79,255,215,.07)';
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    const down = termDownHistory.slice(-60);
    const up = termUpHistory.slice(-60);
    const max = Math.max(0.5, ...down, ...up) * 1.2;
    const step = W / Math.max(1, down.length - 1);

    function line(data, color) {
      if (data.length < 2) return;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i * step;
        const y = H - 4 - (v / max) * (H - 9);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.shadowBlur = 7;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    line(up, '#49a6ff');
    line(down, '#4fffd7');
  }

  function renderTermEvents() {
    if (!termEventsEl) return;
    termVisibleEvents = events.slice(0, 8);
    termEventsEl.innerHTML = termVisibleEvents.map((ev, i) => `
      <div class="term-event" data-key="${escapeHtml(ev.key)}" style="--pin:${ev.color}">
        <i></i><span>${escapeHtml(ev.label || ev.name)}</span><em>${escapeHtml(ev.type)}</em><span class="te-id">${pad(i + 1)}</span>
      </div>`).join('');
    termEventsEl.querySelectorAll('.term-event').forEach(row => {
      row.addEventListener('click', () => {
        const ev = events.find(e => e.key === row.dataset.key);
        if (!ev) return;
        selectEvent(ev.key);
        termEcho(`event ${ev.key}`);
        termLine(`<span class="ok">${escapeHtml(ev.label || ev.name)}</span> <span class="dim">·</span> ${escapeHtml(ev.type)} <span class="dim">·</span> ${fmtLat(ev.lat)} ${fmtLon(ev.lon)}`);
        termLine(`<span class="dim">${escapeHtml(ev.note)}</span>`);
        focusTermWindow();
      });
    });
  }

  async function loadTermFiles(path = '.') {
    if (!termFilesEl) return;
    if (location.protocol === 'file:') {
      termFiles = [];
      termFilesEl.innerHTML = '<div class="term-file"><i>·</i><span>local service required</span><em>start.bat</em></div>';
      return;
    }
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      termFiles = j.entries || [];
      renderTermFiles();
    } catch (err) {
      termLine(`ls: ${escapeHtml(String(err.message || err))}`, 'err');
    }
  }

  function renderTermFiles() {
    if (!termFilesEl) return;
    termFilesEl.innerHTML = termFiles.slice(0, 9).map(f => `
      <div class="term-file ${f.type === 'dir' ? 'dir' : ''}" data-path="${escapeHtml(f.path)}" data-type="${f.type}">
        <i>${f.type === 'dir' ? '▸' : '·'}</i><span>${escapeHtml(f.name)}</span><em>${f.type === 'dir' ? 'DIR' : termFormatBytes(f.size)}</em>
      </div>`).join('');
    termFilesEl.querySelectorAll('.term-file').forEach(row => {
      row.addEventListener('click', () => {
        const path = row.dataset.path;
        if (row.dataset.type === 'dir') loadTermFiles(path);
        else termCat(path);
        focusTermWindow();
      });
    });
  }

  function focusTermWindow() {
    if (termInput) termInput.focus();
  }

  function termComplete() {
    const value = termInput.value;
    if (value.startsWith('cat ')) {
      const q = value.slice(4).toLowerCase();
      const match = termFiles.find(f => f.type === 'file' && f.name.toLowerCase().startsWith(q));
      if (match) termInput.value = `cat ${match.path}`;
      return;
    }
    const q = value.trim().toLowerCase();
    const matches = TERM_COMMANDS.filter(c => c.startsWith(q));
    if (matches.length === 1) termInput.value = matches[0] + ' ';
    else if (matches.length > 1 && q) termLine(`<span class="dim">${matches.join('   ')}</span>`);
  }

  async function termCat(path) {
    if (location.protocol === 'file:') {
      termLine('cat: file access requires the local service. Run start.bat.', 'warn');
      return;
    }
    try {
      const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'read failed');
      const lines = String(j.content || '').split(/\r?\n/).slice(0, 90);
      termLine(`<span class="dim">── ${escapeHtml(path)} ─────────────────────</span>`);
      lines.forEach((line, i) => termLine(`<span class="dim">${String(i + 1).padStart(3, '0')} │</span> ${escapeHtml(line)}`));
      termLine('<span class="dim">──────────────────────────────────────</span>');
    } catch (err) {
      termLine(`cat: ${escapeHtml(String(err.message || err))}`, 'err');
    }
  }

  async function termPing(host) {
    const h = String(host || '127.0.0.1').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(h)) {
      termLine('ping: 非法主机名', 'err');
      return;
    }
    termLine(`<span class="dim">PING ${escapeHtml(h)} · 真实测量（ICMP，失败则 TCP 握手延迟）</span>`);
    try {
      const d = await termApi(`/api/lab/ping?host=${encodeURIComponent(h)}`);
      termOpsEvidence.ping = d;
      if (d.method === 'icmp') {
        termLine(`PING ${escapeHtml(d.ip || h)} · ${d.sent} packets · icmp`);
        termLine(`<span class="ok">${d.received}/${d.sent} received</span> · ${d.lossPct}% loss · min/avg/max = ${d.min}/${d.avg}/${d.max} ms${d.ttl ? ` · ttl ${d.ttl}` : ''}`);
      } else if (d.method === 'tcp') {
        termLine(`<span class="warn">[i] ${escapeHtml(d.note)}</span>`);
        termLine(`TCP ${d.port} · ${d.received}/${d.sent} · min/avg/max = ${d.min}/${d.avg}/${d.max} ms · samples ${escapeHtml((d.samples || []).join(', '))}`);
      } else {
        termLine(`<span class="err">[!] ${escapeHtml(d.note || 'unreachable')}</span>`);
      }
    } catch (err) {
      termLine(`ping: ${escapeHtml(String(err.message || err))}`, 'err');
    }
  }

  function termHelp() {
    const rows = [
      ['help', 'show this command list'],
      ['status', 'system + data + probe summary'],
      ['events [filter]', 'list live events'],
      ['event <n>', 'inspect event by index'],
      ['focus <n>', 'open map at event'],
      ['earth / map / net', 'switch system mode'],
      ['refresh', 'refresh realtime feeds'],
      ['sys / neofetch', 'system telemetry'],
      ['ls [path] / cat <file>', 'browse workspace'],
      ['ping <host>', 'real ICMP / TCP latency'],
      ['probe', 'local network probe status'],
      ['ops / tools', 'real security command deck'],
      ['recon / nmap / web / audit', 'real local reconnaissance'],
      ['vuln', 'real evidence-based findings'],
      ['searchsploit <q>', 'real NVD + CISA KEV lookup'],
      ['msf', 'real native scanner console'],
      ['msfconsole', 'real msf binary · lab target'],
      ['lab', 'lab target + tool readiness'],
      ['hydra', 'real wordlist attack · lab target'],
      ['sqlmap', 'real injection scan · lab target'],
      ['payload <text>', 'real encoder + SHA-256'],
      ['scope / target / report', 'lab scope + real report'],
      ['clear / banner / reboot', 'terminal controls'],
      ['exit', 'return to earth view']
    ];
    termLine('<span class="ok">COMMAND</span>                    <span class="dim">DESCRIPTION</span>');
    rows.forEach(([c, d]) => termLine(`<span class="white">${c.padEnd(28, ' ')}</span><span class="dim">${d}</span>`));
    termLine('<span class="dim">所有数据来自真实接口 · 探测失败会如实报错</span>');
  }

  /* ==========================================================
     SKYNET SECURITY OPS · 全部为真实探测
     主动目标：127.0.0.1 本机服务（TCP / HTTP / TLS）
     只读情报：NVD CVE 2.0 · CISA KEV · DNS · RDAP · 真实延迟
     没有模拟输出：探测失败会如实报错，不生成替代数据
  ========================================================== */
  let termOpsFindings = [];
  let termOpsEvidence = {};
  let termOpsTargetHost = '127.0.0.1';
  let termMsf = null;
  let termFacts = null;
  let termFactsAt = 0;
  let termSessionUser = '';
  let termProcs = [];
  let termProcsAt = 0;

  const TERM_MSF_MODULES = [
    { id: 0, name: 'auxiliary/scanner/port/connect', desc: '真实 TCP 连接扫描' },
    { id: 1, name: 'auxiliary/scanner/http/headers', desc: '真实 HTTP 响应头' },
    { id: 2, name: 'auxiliary/scanner/http/methods', desc: '真实 OPTIONS 方法' },
    { id: 3, name: 'auxiliary/scanner/tcp/banner', desc: '真实服务 banner' },
    { id: 4, name: 'auxiliary/gather/tls/cert', desc: '真实 TLS 证书' },
    { id: 5, name: 'auxiliary/gather/dns/lookup', desc: '真实 DNS 记录' },
    { id: 6, name: 'auxiliary/gather/whois/rdap', desc: '真实 RDAP 注册信息' },
    { id: 7, name: 'auxiliary/scanner/http/robots', desc: '真实 robots.txt' }
  ];

  function termPad(text, width) {
    const value = String(text == null ? '' : text);
    return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length);
  }

  function termStamp(ms) {
    if (!Number.isFinite(ms)) return '--';
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  }

  async function termApi(pathname) {
    if (location.protocol === 'file:') throw new Error('本机服务未连接 · 请用 start.bat 启动');
    const res = await fetch(pathname, { cache: 'no-store' });
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    if (!data) throw new Error('本机服务返回了无法解析的数据');
    return data;
  }

  async function termFactsGet(force) {
    if (!force && termFacts && Date.now() - termFactsAt < 60000) return termFacts;
    termFacts = await termApi('/api/lab/recon');
    termFactsAt = Date.now();
    return termFacts;
  }

  async function termProcsRefresh() {
    if (location.protocol === 'file:') {
      termProcs = [];
      renderTermProc();
      return;
    }
    if (Date.now() - termProcsAt < 3500) return;
    termProcsAt = Date.now();
    try {
      const data = await termApi('/api/lab/procs');
      termProcs = Array.isArray(data.processes) ? data.processes : [];
    } catch (err) {
      termProcs = [];
    }
    renderTermProc();
  }

  function termOpsScopeGuard(value) {
    const v = String(value || '').trim().toLowerCase();
    return v === '127.0.0.1' || v === 'localhost' || v === '::1';
  }

  function termOpsTools() {
    termLine('<span class="ok">SKYNET SECURITY OPS</span> <span class="dim">· REAL PROBES ONLY</span>');
    termLine('<span class="dim">────────────────────────────────────────────────────────</span>');
    const rows = [
      ['recon', 'host / OS / NIC / patch · REAL'],
      ['nmap [ports]', '127.0.0.1 TCP connect · REAL'],
      ['web', 'local HTTP + TLS fingerprint · REAL'],
      ['audit', 'Defender / firewall / UAC / SMBv1 / RDP · REAL'],
      ['vuln', 'evidence-based findings · REAL'],
      ['searchsploit <q>', 'NVD 2.0 + CISA KEV · REAL'],
      ['msf', 'native scanner console · REAL'],
      ['lab', 'lab target + tool readiness'],
      ['hydra', 'real wordlist attack → 8793 · REAL'],
      ['sqlmap', 'real injection scan → 8793 · REAL'],
      ['payload <text>', 'real encoder + SHA-256 · REAL'],
      ['scope / target', 'loopback-only scope'],
      ['report', 'download real Markdown report']
    ];
    rows.forEach(([c, d, t]) => termLine(`<span class="white">${c.padEnd(20, ' ')}</span><span class="dim">${d.padEnd(38, ' ')}</span><span class="ok">[${t || 'REAL'}]</span>`));
    termLine('<span class="dim">主动探测只允许回环地址 · 攻击只打内置靶机 127.0.0.1:8793 · 情报查询为真实公共只读接口</span>');
  }

  async function termOpsRecon() {
    termLine('<span class="dim">[*] 本机信息收集 · /api/lab/recon · REAL</span>');
    let f;
    try {
      f = await termFactsGet(true);
    } catch (err) {
      termLine(`<span class="err">[!] 本机服务不可用：</span> ${escapeHtml(String(err.message || err))}`);
      return;
    }
    termOpsEvidence.recon = f;
    const os = f.os || {};
    const cpu = f.cpu || {};
    const mem = f.mem || {};
    const win = f.windows || {};
    const user = f.user || {};

    termLine(`<span class="ok">[+] HOST</span>   ${escapeHtml(os.hostname || '--')} · ${escapeHtml(os.platform || '--')} ${escapeHtml(os.release || '')} · ${escapeHtml(os.arch || '--')}`);
    if (os.caption) termLine(`<span class="ok">[+] OS</span>     ${escapeHtml(os.caption)} · build ${escapeHtml(os.build || '--')} · install ${escapeHtml(os.installDate || '--')}`);
    termLine(`<span class="ok">[+] USER</span>   ${escapeHtml(user.full || user.name || '--')} · home ${escapeHtml(user.home || '--')}`);
    termLine(`<span class="ok">[+] CPU</span>    ${escapeHtml(cpu.model || '--')} · ${cpu.cores || '--'} cores @ ${cpu.speedMHz || '--'} MHz`);
    if (mem.total) termLine(`<span class="ok">[+] MEM</span>    ${termFormatBytes(mem.used)} / ${termFormatBytes(mem.total)} · free ${termFormatBytes(mem.free)}`);
    termLine(`<span class="ok">[+] UPTIME</span> ${termFormatUptime(os.uptime)} · boot ${escapeHtml(termStamp(os.bootTime))}`);

    (f.nic || []).forEach(nic => {
      const addrs = (nic.addresses || []).filter(a => a.family === 'IPv4');
      if (!addrs.length) return;
      const primary = addrs[0];
      termLine(`<span class="ok">[+] NIC</span>    ${escapeHtml(nic.name)} · ${escapeHtml(primary.address)}/${escapeHtml(primary.cidr || '')} · ${escapeHtml(primary.mac || '--')}`);
    });

    const net = f.net || {};
    if (net.gateway) termLine(`<span class="ok">[+] GATEWAY</span> ${escapeHtml(net.gateway)}${net.interfaceAlias ? ` · ${escapeHtml(net.interfaceAlias)}` : ''}`);
    if (net.dnsServers && net.dnsServers.length) termLine(`<span class="ok">[+] DNS</span>    ${escapeHtml(net.dnsServers.join(', '))}`);

    const hf = (win.hotfixes || [])[0];
    if (hf && hf.id) termLine(`<span class="ok">[+] PATCH</span>  ${escapeHtml(hf.id)} · ${escapeHtml(hf.date || '--')}`);
    else termLine('<span class="warn">[!] PATCH</span>  不可读取（通常需要管理员权限）');

    const sec = [];
    if (win.defender) sec.push(`Defender ${win.defender.realtime ? 'ON' : 'OFF'} · sig ${win.defender.signatureAge ?? '--'}d`);
    if (Array.isArray(win.firewall) && win.firewall.length) sec.push(`Firewall ${win.firewall.filter(p => Number(p.Enabled)).length}/${win.firewall.length}`);
    if (typeof win.smb1 === 'boolean') sec.push(`SMBv1 ${win.smb1 ? 'ON' : 'OFF'}`);
    if (typeof win.rdpEnabled === 'boolean') sec.push(`RDP ${win.rdpEnabled ? 'ON' : 'OFF'}`);
    if (typeof win.secureBoot === 'boolean') sec.push(`SecureBoot ${win.secureBoot ? 'ON' : 'OFF'}`);
    if (win.uac) sec.push(`UAC ${Number(win.uac.enableLUA) ? 'ON' : 'OFF'}`);
    if (sec.length) termLine(`<span class="ok">[+] POSTURE</span> ${escapeHtml(sec.join(' · '))}`);
    else termLine(`<span class="warn">[!] POSTURE</span> 不可读取：${escapeHtml(f.windowsError || '需要管理员权限')}`);

    const tools = Object.entries(f.tools || {}).map(([name, path]) => `${name}:${path ? 'yes' : 'no'}`).join('  ');
    if (tools) termLine(`<span class="ok">[+] TOOLS</span>  ${escapeHtml(tools)}`);
    termOpsFindings.push(`recon · ${os.hostname} · ${os.caption || os.platform + ' ' + os.release} · ${cpu.cores} cores`);
  }

  async function termOpsNmap(arg) {
    const value = String(arg || '').trim();
    let ports = '';
    if (value) {
      if (/^\d{1,5}(?:[,-]\d{1,5})*$/.test(value)) ports = value;
      else if (!termOpsScopeGuard(value)) {
        termLine('<span class="err">[!] OUT OF SCOPE</span> · 主动扫描只允许 127.0.0.1 / localhost', 'err');
        return;
      }
    }
    termLine(`<span class="dim">[*] TCP connect 扫描 · 127.0.0.1 ${ports ? `· ports ${escapeHtml(ports)}` : '· 34 个常见端口'} · REAL</span>`);
    try {
      const d = await termApi(`/api/lab/scan${ports ? `?ports=${encodeURIComponent(ports)}` : ''}`);
      termOpsEvidence.scan = d;
      termLine('<span class="dim">PORT      STATE       SERVICE             LATENCY</span>');
      (d.ports || []).forEach(p => {
        const cls = p.state === 'open' ? 'ok' : 'dim';
        termLine(`<span class="${cls}">${termPad(p.port, 9)}</span><span class="${cls}">${termPad(p.state, 12)}</span><span class="white">${termPad(p.service, 20)}</span><span class="dim">${p.latencyMs == null ? '--' : `${p.latencyMs}ms`}</span>`);
      });
      const open = (d.ports || []).filter(p => p.state === 'open');
      termLine(`<span class="ok">[+]</span> ${open.length} open / ${d.scanned} scanned · ${d.duration} ms${d.truncated ? ' · 端口列表已截断到 300' : ''}`);
      if (open.length) termLine('<span class="dim">[i] 服务名为 IANA 端口注册表映射，未做版本指纹</span>');
      termOpsFindings.push(`nmap · open ${open.map(p => p.port).join(',') || 'none'} on 127.0.0.1`);
    } catch (err) {
      termLine(`<span class="err">[!] 扫描失败：</span> ${escapeHtml(String(err.message || err))}`);
    }
  }

  async function termOpsWeb() {
    termLine('<span class="dim">[*] 本机 HTTP / TLS 指纹 · 真实请求 127.0.0.1 · REAL</span>');
    try {
      const d = await termApi('/api/lab/web');
      termOpsEvidence.web = d;
      (d.checks || []).forEach(c => {
        const status = c.status == null ? 'ERR' : String(c.status);
        const okStatus = c.status != null && c.status < 400;
        const tail = c.error ? ` <span class="err">${escapeHtml(c.error)}</span>` : (c.location ? ` <span class="dim">→ ${escapeHtml(c.location)}</span>` : '');
        termLine(`<span class="${okStatus ? 'ok' : 'warn'}">${termPad(c.method || 'GET', 8)}</span>${termPad(c.path, 24)}${termPad(status, 5)}${termPad(c.ms == null ? '--' : `${c.ms}ms`, 9)}<span class="dim">${c.bytes == null ? '' : termFormatBytes(c.bytes)}</span>${tail}`);
      });
      const sec = d.security || {};
      const rows = [
        ['Server', sec.server],
        ['X-Powered-By', sec.poweredBy],
        ['Content-Security-Policy', sec.contentSecurityPolicy],
        ['X-Frame-Options', sec.xFrameOptions],
        ['Strict-Transport-Security', sec.hsts],
        ['X-Content-Type-Options', sec.xContentTypeOptions],
        ['Referrer-Policy', sec.referrerPolicy],
        ['Permissions-Policy', sec.permissionsPolicy],
        ['Access-Control-Allow-Origin', sec.cors]
      ];
      rows.forEach(([label, val]) => {
        termLine(`<span class="${val ? 'ok' : 'warn'}">${val ? '[+]' : '[!]'}</span> ${termPad(label, 27)}<span class="${val ? 'white' : 'dim'}">${escapeHtml(val || 'MISSING')}</span>`);
      });
      termLine(`<span class="dim">[i] 未认证 /api/files → ${d.auth && d.auth.unauthenticatedApi != null ? d.auth.unauthenticatedApi : '--'} · 已认证 → ${d.auth && d.auth.authenticatedApi != null ? d.auth.authenticatedApi : '--'} · 总耗时 ${d.duration}ms</span>`);

      const tls = await termApi('/api/lab/tls?port=443').catch(() => null);
      if (tls && tls.state === 'open') {
        termLine(`<span class="ok">[+] TLS</span> 443 · ${escapeHtml(tls.protocol || '--')} · ${escapeHtml((tls.cipher && tls.cipher.name) || '--')} · ${tls.authorized ? 'trusted' : 'untrusted'}`);
        termLine(`<span class="dim">    subject CN=${escapeHtml((tls.subject && tls.subject.cn) || '--')} · issuer CN=${escapeHtml((tls.issuer && tls.issuer.cn) || '--')} · validTo ${escapeHtml(tls.validTo || '--')} (${tls.daysRemaining} 天)</span>`);
      } else {
        termLine('<span class="warn">[!] TLS</span> 本机 443 未开放 TLS 服务');
      }
      termOpsFindings.push(`web · ${d.missing && d.missing.length ? 'missing ' + d.missing.join('/') : 'security headers complete'} · CORS ${sec.cors || 'none'}`);
    } catch (err) {
      termLine(`<span class="err">[!] HTTP 指纹失败：</span> ${escapeHtml(String(err.message || err))}`);
    }
  }

  async function termOpsAudit() {
    termLine('<span class="dim">[*] 本机安全姿态 · /api/audit · REAL</span>');
    try {
      const d = await termApi('/api/audit');
      termOpsEvidence.audit = d;
      if (!d.ok) throw new Error(d.error || 'audit failed');
      const def = d.defender || {};
      termLine(`<span class="ok">[+] HOST</span>      ${escapeHtml(d.hostname || '--')} · ${escapeHtml(d.platform || '--')} ${escapeHtml(d.release || '')}`);
      if (d.defender) {
        termLine(`<span class="${def.realtime ? 'ok' : 'err'}">[${def.realtime ? '+' : '!'}] DEFENDER</span>  antivirus=${def.antivirus ? 'ON' : 'OFF'} · realtime=${def.realtime ? 'ON' : 'OFF'} · signature age=${def.signatureAge ?? '--'}d`);
      } else {
        termLine('<span class="warn">[!] DEFENDER</span>  不可读取（Defender 未安装或需要管理员权限）');
      }
      const fw = Array.isArray(d.firewall) ? d.firewall : [];
      const fwOff = fw.filter(x => !Number(x.Enabled));
      if (fw.length) {
        termLine(`<span class="${fwOff.length ? 'warn' : 'ok'}">[${fwOff.length ? '!' : '+'}] FIREWALL</span>  ${fw.filter(x => Number(x.Enabled)).length}/${fw.length} profiles enabled${fwOff.length ? ` · OFF: ${escapeHtml(fwOff.map(x => x.Name).join(','))}` : ''}`);
      } else {
        termLine('<span class="warn">[!] FIREWALL</span>  状态不可读取（Get-NetFirewallProfile 无返回）');
      }
      const uac = d.uac || {};
      if (d.uac) termLine(`<span class="${Number(uac.enableLUA) ? 'ok' : 'err'}">[${Number(uac.enableLUA) ? '+' : '!'}] UAC</span>       EnableLUA=${uac.enableLUA} · prompt=${uac.consentPrompt}`);
      else termLine('<span class="warn">[!] UAC</span>       注册表值不可读');
      if (typeof d.smb1 === 'boolean') termLine(`<span class="${d.smb1 ? 'err' : 'ok'}">[${d.smb1 ? '!' : '+'}] SMBv1</span>     ${d.smb1 ? 'ENABLED (CVE-2017-0144 面)' : 'disabled'}`);
      if (typeof d.smbSigning === 'boolean') termLine(`<span class="${d.smbSigning ? 'ok' : 'warn'}">[${d.smbSigning ? '+' : '!'}] SMB SIGN</span> ${d.smbSigning ? 'required' : 'not required'}`);
      if (typeof d.rdp === 'boolean') termLine(`<span class="${d.rdp ? 'warn' : 'ok'}">[${d.rdp ? '!' : '+'}] RDP</span>       ${d.rdp ? 'enabled · 3389' : 'disabled'}`);
      if (typeof d.secureBoot === 'boolean') termLine(`<span class="${d.secureBoot ? 'ok' : 'warn'}">[${d.secureBoot ? '+' : '!'}] SECURE BOOT</span> ${d.secureBoot ? 'enabled' : 'disabled'}`);
      if (d.hotfix && d.hotfix.id) termLine(`<span class="dim">[+] PATCH</span>     ${escapeHtml(d.hotfix.id)} · ${escapeHtml(d.hotfix.date || '--')}`);
      if (Array.isArray(d.admins)) termLine(`<span class="dim">[+] ADMINS</span>    ${d.admins.length} 个本地管理员`);
      const listening = Array.isArray(d.listening) ? d.listening : [];
      const exposed = listening.filter(p => [445, 3389, 135, 139, 22, 5985, 5986].includes(Number(p.LocalPort)) && !['127.0.0.1', '::1'].includes(String(p.LocalAddress)));
      termLine(`<span class="dim">[+] LISTEN</span>    ${listening.length} 个 TCP 监听 · 敏感且非回环: ${escapeHtml(exposed.map(p => `${p.LocalPort}@${p.LocalAddress}`).join(', ') || 'none')}`);
      if (d.windowsError) termLine(`<span class="warn">[!] 部分字段不可读：</span> ${escapeHtml(d.windowsError)}`);
      termLine('<span class="dim">全部读数直接来自系统；本轮未修改任何配置</span>');
      termOpsFindings.push(`audit · Defender ${d.defender ? (def.realtime ? 'realtime ON' : 'realtime OFF') : 'unreadable'} · FW ${fw.length - fwOff.length}/${fw.length}`);
    } catch (err) {
      termLine(`<span class="err">[!] 安全姿态读取失败：</span> ${escapeHtml(String(err.message || err))}`);
    }
  }

  async function termOpsVuln() {
    termLine('<span class="dim">[*] 真实评估：本机姿态 + 回环端口 + HTTP 头 + 认证策略 + CISA KEV</span>');
    try {
      const d = await termApi('/api/lab/vuln');
      termOpsEvidence.vuln = d;
      const sevCls = { critical: 'err', high: 'err', medium: 'warn', low: 'ok', info: 'dim' };
      (d.findings || []).forEach(f => {
        const refs = (f.refs || []).map(r => (r.kev ? `${r.id} · KEV ${r.kev.dateAdded || ''}` : r.id)).filter(Boolean).join(', ');
        termLine(`<span class="${sevCls[f.sev] || 'dim'}">[${String(f.sev).toUpperCase()}]</span> ${escapeHtml(f.id)} · ${escapeHtml(f.title)}`);
        termLine(`    <span class="dim">${escapeHtml(f.evidence)}</span>${refs ? ` · <span class="blue">${escapeHtml(refs)}</span>` : ''}`);
      });
      const c = d.counts || {};
      termLine(`<span class="ok">[+]</span> ${(d.findings || []).length} 条结论 · ${c.critical || 0} critical / ${c.high || 0} high / ${c.medium || 0} medium / ${c.low || 0} low / ${c.info || 0} info`);
      termLine('<span class="dim">[i] 结论由真实读数推导；未执行任何漏洞利用</span>');
      termOpsFindings = (d.findings || []).filter(f => f.sev !== 'info').map(f => `[${String(f.sev).toUpperCase()}] ${f.title} — ${f.evidence}`);
    } catch (err) {
      termLine(`<span class="err">[!] 评估失败：</span> ${escapeHtml(String(err.message || err))}`);
    }
  }

  async function termOpsSearch(query) {
    const q = String(query || '').trim();
    if (!q) { termLine('usage: searchsploit <keyword | CVE-ID | product>', 'warn'); return; }
    termLine(`<span class="dim">[*] 真实漏洞情报 · NVD 2.0 + CISA KEV · "${escapeHtml(q)}"</span>`);
    try {
      const d = await termApi(`/api/lab/search?q=${encodeURIComponent(q)}`);
      termOpsEvidence.search = d;
      if (!d.ok) throw new Error(d.error || 'no result');
      termLine(`<span class="dim">source ${escapeHtml(d.source)} · total ${d.total} · shown ${d.shown}${d.partial ? ' · 部分结果' : ''}${d.catalog ? ` · KEV ${d.catalog.count}` : ''}</span>`);
      (d.results || []).forEach(r => {
        const score = r.score == null ? '--' : Number(r.score).toFixed(1);
        const sev = r.severity ? String(r.severity).toUpperCase() : '--';
        const kev = r.kev ? ` · <span class="err">KEV ${escapeHtml(r.kev.dateAdded || '')}</span>` : '';
        termLine(`<span class="white">${escapeHtml(r.id)}</span>  <span class="ok">${termPad(score, 5)}</span>${termPad(sev, 10)}${escapeHtml(r.published || '--')}${kev}`);
        const summary = String(r.summary || '');
        termLine(`    <span class="dim">${escapeHtml(summary.slice(0, 160))}${summary.length > 160 ? '…' : ''}</span>`);
      });
      if (!(d.results || []).length) termLine('<span class="warn">[!] 没有匹配的真实 CVE 记录</span>');
      if (d.error) termLine(`<span class="warn">[!] ${escapeHtml(d.error)}</span>`);
      if (d.results && d.results.length) termOpsFindings.push(`searchsploit · ${d.query} · ${d.results.map(r => r.id).join(', ')}`);
    } catch (err) {
      termLine(`<span class="err">[!] 情报检索失败：</span> ${escapeHtml(String(err.message || err))}`);
    }
  }

  async function termOpsMsf(arg) {
    const raw = String(arg || '').trim();
    if (!termMsf) {
      termMsf = { module: null, rhosts: '127.0.0.1', rport: 8792 };
      const tools = (termFacts && termFacts.tools) || {};
      termLine('<span class="blue">SKYNET NATIVE SCANNER</span> <span class="dim">· 真实模块 · 仅回环目标</span>');
      termLine(`<span class="dim">msfconsole:</span> ${tools.msfconsole ? escapeHtml(tools.msfconsole) : '<span class="warn">PATH 中未安装 · 使用本机原生探测模块</span>'}`);
      TERM_MSF_MODULES.forEach(m => termLine(`  <span class="ok">${m.id}</span>  <span class="white">${termPad(m.name, 44)}</span><span class="dim">${escapeHtml(m.desc)}</span>`));
      termLine('<span class="dim">use &lt;n&gt; · set RHOSTS/RPORT · show · run · back</span>');
      if (!raw) return;
    }
    const parts = raw.split(/\s+/);
    const sub = (parts.shift() || '').toLowerCase();
    const rest = parts.join(' ');

    if (sub === 'back' || sub === 'exit') {
      termMsf = null;
      termLine('<span class="dim">[*] 已退出扫描控制台</span>');
      return;
    }
    if (!sub) {
      termLine(`<span class="dim">module ${termMsf.module == null ? 'none' : termMsf.module} · ${escapeHtml(termMsf.rhosts)}:${escapeHtml(termMsf.rport)}</span>`);
      return;
    }
    if (sub === 'use') {
      const id = parseInt(rest, 10);
      if (!TERM_MSF_MODULES.some(m => m.id === id)) { termLine('<span class="err">[!] 未知模块 · use 0-7</span>'); return; }
      termMsf.module = id;
      const m = TERM_MSF_MODULES.find(item => item.id === id);
      termLine(`<span class="ok">[+]</span> module = ${escapeHtml(m.name)} <span class="dim">· ${escapeHtml(m.desc)}</span>`);
      return;
    }
    if (sub === 'set') {
      const [key, ...valueParts] = rest.split(/\s+/);
      const value = valueParts.join(' ');
      if (!key) { termLine('<span class="err">[!] usage: set RHOSTS 127.0.0.1</span>'); return; }
      if (key.toUpperCase() === 'RHOSTS') {
        if (!termOpsScopeGuard(value)) { termLine('<span class="err">[!] OUT OF SCOPE</span> · 只允许 127.0.0.1 / localhost'); return; }
        termMsf.rhosts = value;
      } else if (key.toUpperCase() === 'RPORT') {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) { termLine('<span class="err">[!] invalid RPORT</span>'); return; }
        termMsf.rport = port;
      } else {
        termLine('<span class="err">[!] 未知选项 · RHOSTS / RPORT</span>');
        return;
      }
      termLine(`<span class="ok">[+]</span> ${escapeHtml(key.toUpperCase())} =&gt; ${escapeHtml(value)}`);
      return;
    }
    if (sub === 'show') {
      termLine(`<span class="dim">RHOSTS ${escapeHtml(termMsf.rhosts)} · RPORT ${escapeHtml(termMsf.rport)} · module ${termMsf.module == null ? 'none' : termMsf.module}</span>`);
      return;
    }
    if (sub === 'run' || sub === 'exploit') { await termMsfRun(); return; }
    if (sub === 'help') {
      termLine('<span class="dim">use 0-7 · set RHOSTS/RPORT · show · run · back</span>');
      return;
    }
    termLine(`<span class="err">[!] 未知命令：</span> ${escapeHtml(raw)}`);
  }

  async function termMsfRun() {
    const m = TERM_MSF_MODULES.find(item => item.id === termMsf.module);
    if (!m) { termLine('<span class="warn">[!] 未选择模块 · use 0-7</span>'); return; }
    const host = termMsf.rhosts;
    const port = termMsf.rport;
    termLine(`<span class="dim">[*] run ${escapeHtml(m.name)} → ${escapeHtml(host)}:${escapeHtml(port)} · 真实请求</span>`);
    try {
      if (m.id === 0) {
        const d = await termApi(`/api/lab/scan?ports=${encodeURIComponent(port)}`);
        const p = (d.ports || [])[0] || {};
        termLine(`<span class="${p.state === 'open' ? 'ok' : 'warn'}">[${p.state === 'open' ? '+' : '-'}]</span> port ${p.port}/${escapeHtml(p.service || '')} ${escapeHtml(p.state || 'unknown')} · ${p.latencyMs == null ? '--' : `${p.latencyMs}ms`}`);
      } else if (m.id === 1) {
        const d = await termApi('/api/lab/web');
        const login = (d.checks || []).find(c => c.name === 'login') || {};
        termLine(`<span class="ok">[+]</span> GET /login.html → ${login.status} · ${login.bytes} B · ${login.ms}ms`);
        termLine(`<span class="dim">server=${escapeHtml((d.security && d.security.server) || 'none')} · missing=${escapeHtml((d.missing || []).join(',') || 'none')}</span>`);
      } else if (m.id === 2) {
        const d = await termApi('/api/lab/http?path=/api/login&method=OPTIONS');
        termLine(`<span class="ok">[+]</span> OPTIONS /api/login → ${d.status}`);
        termLine(`<span class="dim">allow=${escapeHtml((d.headers && d.headers['access-control-allow-methods']) || '--')} · ACAO=${escapeHtml((d.headers && d.headers['access-control-allow-origin']) || '--')}</span>`);
      } else if (m.id === 3) {
        const d = await termApi(`/api/lab/banner?port=${encodeURIComponent(port)}`);
        termLine(`<span class="${d.state === 'open' ? 'ok' : 'warn'}">[${d.state === 'open' ? '+' : '-'}]</span> ${escapeHtml(d.state)} · ${d.bytes} B`);
        if (d.banner) termLine(`<span class="dim">${escapeHtml(d.banner.slice(0, 400))}</span>`);
      } else if (m.id === 4) {
        const d = await termApi(`/api/lab/tls?port=${encodeURIComponent(port)}`);
        if (d.state === 'open') {
          termLine(`<span class="ok">[+]</span> ${escapeHtml(d.protocol || '--')} · ${escapeHtml((d.cipher && d.cipher.name) || '--')}`);
          termLine(`<span class="dim">subject=${escapeHtml((d.subject && d.subject.cn) || '--')} · issuer=${escapeHtml((d.issuer && d.issuer.cn) || '--')} · validTo=${escapeHtml(d.validTo || '--')} · ${d.daysRemaining} 天</span>`);
        } else {
          termLine(`<span class="warn">[!] ${escapeHtml(d.state)} · ${escapeHtml(d.error || 'no TLS')}</span>`);
        }
      } else if (m.id === 5) {
        const name = host === '127.0.0.1' ? 'localhost' : host;
        const d = await termApi(`/api/lab/dns?name=${encodeURIComponent(name)}`);
        (d.resolved || []).forEach(r => termLine(`<span class="ok">[+]</span> ${escapeHtml(name)} → ${escapeHtml(r.address)} (family ${r.family})`));
        Object.entries(d.records || {}).filter(([k]) => !k.endsWith('Ms')).forEach(([k, v]) => termLine(`<span class="dim">${escapeHtml(k.toUpperCase())}</span> ${escapeHtml(JSON.stringify(v))}`));
        if (!(d.resolved || []).length) termLine(`<span class="warn">[!] ${escapeHtml(JSON.stringify(d.errors || {}))}</span>`);
      } else if (m.id === 6) {
        const d = await termApi(`/api/lab/rdap?ip=${encodeURIComponent(host)}`);
        if (d.ok && d.registered) {
          termLine(`<span class="ok">[+]</span> ${escapeHtml(d.handle || '--')} · ${escapeHtml(d.name || '--')} · ${escapeHtml(d.country || '--')} · ${escapeHtml(d.source || '')}`);
          termLine(`<span class="dim">range ${escapeHtml(d.startAddress || '--')} - ${escapeHtml(d.endAddress || '--')}</span>`);
        } else {
          termLine(`<span class="warn">[!] ${escapeHtml(d.error || d.note || 'no RDAP data')}</span>`);
        }
      } else if (m.id === 7) {
        const d = await termApi('/api/lab/http?path=/robots.txt');
        termLine(`<span class="${d.status === 200 ? 'ok' : 'warn'}">[+]</span> GET /robots.txt → ${d.status} · ${d.bytes} B`);
        if (d.bodyPreview) termLine(`<span class="dim">${escapeHtml(d.bodyPreview.slice(0, 300))}</span>`);
      }
    } catch (err) {
      termLine(`<span class="err">[!] 模块执行失败：</span> ${escapeHtml(String(err.message || err))}`);
    }
  }

  function termToolUnavailable(d, label) {
    termLine(`<span class="err">[!] ${escapeHtml(label)} 不可用：</span> ${escapeHtml(d.error || 'unknown')}`);
    if (d.hint) termLine(`<span class="dim">[i] ${escapeHtml(d.hint)}</span>`);
    termLine('<span class="dim">[i] 不生成替代数据 · 工具装好后这条命令就是真实执行</span>');
  }

  function termToolOutput(text, maxLines = 40) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').filter(line => line.trim() !== '');
    const shown = lines.slice(0, maxLines);
    shown.forEach(line => {
      const cls = /^\s*\[(ERROR|CRITICAL|FATAL)\]/i.test(line) ? 'err'
        : /^\s*\[(WARNING|WARN)\]/i.test(line) ? 'warn'
          : /vulnerable|valid password|\[\+\]/i.test(line) ? 'ok'
            : 'dim';
      termLine(`<span class="${cls}">${escapeHtml(line.slice(0, 200))}</span>`);
    });
    if (lines.length > shown.length) termLine(`<span class="dim">… 其余 ${lines.length - shown.length} 行省略</span>`);
  }

  async function termOpsHydra() {
    termLine('<span class="dim">[*] hydra · 真实字典爆破 → 127.0.0.1:8793/login · 靶机自带弱口令</span>');
    let d;
    try {
      d = await termApi('/api/lab/attack/hydra?user=admin');
    } catch (err) {
      termLine(`<span class="err">[!] 爆破请求失败：</span> ${escapeHtml(String(err.message || err))}`);
      return;
    }
    if (!d.command) { termToolUnavailable(d, 'hydra'); return; }
    termLine(`<span class="white">$ ${escapeHtml(d.command)}</span>`);
    termToolOutput(`${d.stdout || ''}\n${d.stderr || ''}`);
    if (d.parsed && d.parsed.success) {
      termLine(`<span class="ok">[+] HIT</span> ${escapeHtml(d.parsed.user)}:${escapeHtml(d.parsed.password)} · ${d.durationMs}ms · 真实登录成功`);
      termOpsFindings.push(`[HIGH] 靶机弱口令 ${d.parsed.user}:${d.parsed.password} @ /login`);
      termOpsEvidence.hydra = d;
    } else {
      termLine(`<span class="warn">[!] 未命中</span> · ${d.durationMs}ms · ${escapeHtml(d.error || '')}`);
      termOpsEvidence.hydra = d;
    }
    termLine('<span class="dim">[i] 目标固定为内置靶机 · 字典 lab-wordlist.txt · 不做外网爆破</span>');
  }

  async function termOpsSqlmap() {
    termLine('<span class="dim">[*] sqlmap · 真实注入检测 → http://127.0.0.1:8793/item?id=1</span>');
    let d;
    try {
      d = await termApi('/api/lab/attack/sqlmap');
    } catch (err) {
      termLine(`<span class="err">[!] sqlmap 请求失败：</span> ${escapeHtml(String(err.message || err))}`);
      return;
    }
    if (!d.command) { termToolUnavailable(d, 'sqlmap'); return; }
    termLine(`<span class="white">$ ${escapeHtml(d.command)}</span>`);
    termToolOutput(`${d.stdout || ''}\n${d.stderr || ''}`);
    const p = d.parsed || {};
    if (p.vulnerable) {
      termLine(`<span class="ok">[+] 注入点</span> ${escapeHtml(p.parameter || '--')} · DBMS ${escapeHtml(p.dbms || '--')}`);
      if (p.banner) termLine(`<span class="dim">banner</span> ${escapeHtml(p.banner)}`);
      termLine(`<span class="dim">user=${escapeHtml(p.currentUser || '--')} · db=${escapeHtml(p.currentDb || '--')} · host=${escapeHtml(p.hostname || '--')}</span>`);
      if ((p.databases || []).length) termLine(`<span class="dim">databases</span> ${escapeHtml(p.databases.join(', '))}`);
      if ((p.tables || []).length) termLine(`<span class="dim">tables</span> ${escapeHtml(p.tables.join(', '))}`);
      termOpsFindings.push(`[CRITICAL] 靶机 /item?id= SQL 注入（${p.parameter || 'id'} · ${p.dbms || 'sqlite'}）`);
    } else {
      termLine(`<span class="warn">[!] 未确认注入</span> · exit ${d.exitCode} · ${escapeHtml(d.error || '')}`);
    }
    termOpsEvidence.sqlmap = d;
    termLine(`<span class="dim">[i] 目标固定为内置靶机 · --batch --level=1 --risk=1 · 无后渗透、无文件写入</span>`);
  }

  async function termOpsMsfReal() {
    termLine('<span class="dim">[*] msfconsole · auxiliary/scanner/http/http_version → 127.0.0.1:8793</span>');
    let d;
    try {
      d = await termApi('/api/lab/attack/msf');
    } catch (err) {
      termLine(`<span class="err">[!] msf 请求失败：</span> ${escapeHtml(String(err.message || err))}`);
      return;
    }
    if (!d.command) { termToolUnavailable(d, 'msfconsole'); return; }
    termLine(`<span class="white">$ ${escapeHtml(d.command)}</span>`);
    termToolOutput(`${d.stdout || ''}\n${d.stderr || ''}`);
    termLine(`<span class="${d.ok ? 'ok' : 'warn'}">[${d.ok ? '+' : '!'}]</span> exit ${d.exitCode} · ${d.durationMs}ms`);
    termOpsEvidence.msf = d;
  }


  async function termOpsPayload(text) {
    const value = String(text == null ? '' : text).slice(0, 2048);
    if (!value) { termLine('usage: payload <text> · 真实编码 + 摘要', 'warn'); return; }
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    let base64 = '';
    try { base64 = btoa(binary); } catch (err) { base64 = '--'; }
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const counts = new Array(256).fill(0);
    bytes.forEach(b => { counts[b]++; });
    let entropy = 0;
    counts.forEach(count => {
      if (!count) return;
      const p = count / bytes.length;
      entropy -= p * Math.log2(p);
    });
    let sha = null;
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      sha = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (err) { sha = null; }
    termLine(`<span class="ok">input</span>    ${escapeHtml(value)}`);
    termLine(`<span class="ok">bytes</span>    ${bytes.length} · entropy ${entropy.toFixed(2)} bit/byte`);
    termLine(`<span class="ok">sha256</span>   ${sha ? `<span class="white">${sha}</span>` : '<span class="warn">crypto.subtle 不可用</span>'}`);
    termLine(`<span class="ok">base64</span>   <span class="white">${escapeHtml(base64)}</span>`);
    termLine(`<span class="ok">url</span>      <span class="white">${escapeHtml(encodeURIComponent(value))}</span>`);
    termLine(`<span class="ok">hex</span>      <span class="dim">${escapeHtml(hex)}</span>`);
    termLine('<span class="dim">真实编码结果 · 不含 shellcode / 反弹 shell</span>');
  }

  async function termOpsLab() {
    termLine('<span class="dim">[*] LAB 靶机 + 真实工具状态 · /api/lab/target · /api/lab/attack/tools</span>');
    let target = null;
    let tools = null;
    try {
      const pair = await Promise.all([termApi('/api/lab/target'), termApi('/api/lab/attack/tools')]);
      target = pair[0];
      tools = pair[1];
    } catch (err) {
      termLine(`<span class="err">[!] LAB 状态读取失败：</span> ${escapeHtml(String(err.message || err))}`);
      return;
    }
    const up = !!(target && target.running);
    termLine(`<span class="${up ? 'ok' : 'err'}">[${up ? '+' : '!'}] 靶机</span> ${escapeHtml((target && target.host) || '--')}:${(target && target.port) || '--'} · ${up ? `up ${target.uptimeSeconds}s · 登录成功 ${target.logins} / 尝试 ${target.loginAttempts}` : '未运行'}`);
    termLine(`<span class="dim">banner ${escapeHtml((target && target.banner) || '--')} · 内存 SQLite · 仅回环</span>`);
    const t = (tools && tools.tools) || {};
    [['sqlmap', t.sqlmap], ['hydra', t.hydra], ['msfconsole', t.msfconsole]].forEach(([name, info]) => {
      const on = !!(info && info.available);
      const detail = on ? (info.via || 'ready') : (info.hint || info.error || 'not installed');
      termLine(`<span class="${on ? 'ok' : 'warn'}">[${on ? '+' : '-'}]</span> <span class="white">${name.padEnd(12)}</span><span class="dim">${escapeHtml(detail)}</span>`);
    });
    const wordlist = (tools && tools.wordlist) || {};
    termLine(`<span class="dim">字典 ${escapeHtml(wordlist.path || '--')} · ${wordlist.entries || 0} 条 · 攻击目标锁定 ${escapeHtml((tools && tools.scope) || '--')}</span>`);
    termLine('<span class="dim">[i] sqlmap / hydra / msfconsole 走真实进程；缺失时如实报错，绝不返回假结果</span>');
  }

  function termOpsScope() {
    termLine('<span class="ok">[+] ACTIVE SCOPE</span> 127.0.0.1 / localhost / ::1 · 只对本机服务发起探测');
    termLine('<span class="ok">[+] ATTACK SCOPE</span> 127.0.0.1:8793 · 内置靶机（弱口令 + 真实注入点）');
    termLine('<span class="ok">[+] PASSIVE INTEL</span> NVD CVE 2.0 · CISA KEV · DNS · RDAP（真实公共只读接口）');
    termLine(`<span class="ok">[+] TARGET</span> ${escapeHtml(termOpsTargetHost)}`);
    termLine('<span class="warn">[!] 不做外网扫描 · 不做后渗透 / 反弹 shell · 攻击只打内置靶机</span>');
  }

  function termOpsTarget(value) {
    if (!value) { termLine(`target = ${escapeHtml(termOpsTargetHost)}`); return; }
    if (!termOpsScopeGuard(value)) {
      termLine('<span class="err">[!] OUT OF SCOPE</span> · 主动探测只允许 127.0.0.1 / localhost / ::1');
      return;
    }
    termOpsTargetHost = value;
    termLine(`<span class="ok">[+]</span> target => ${escapeHtml(value)}`);
  }

  async function termOpsHash(text) {
    const value = text || 'skynet-lab';
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
      const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      termLine(`<span class="dim">sha256</span>(${escapeHtml(value)}) = <span class="white">${hex}</span>`);
    } catch (err) {
      termLine('<span class="err">[!] crypto.subtle unavailable</span>');
    }
  }

  function termOpsReport() {
    const date = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const ev = termOpsEvidence || {};
    const recon = ev.recon || null;
    const scan = ev.scan || null;
    const web = ev.web || null;
    const vuln = ev.vuln || null;
    const auth = ev.auth || null;
    const inject = ev.inject || null;

    const lines = [
      '# SKYNET · 真实探测报告',
      '',
      `- Target: ${termOpsTargetHost}`,
      `- Operator: ${termSessionUser || '--'}`,
      `- Generated: ${date}`,
      '- Mode: REAL PROBES · 主动目标仅回环地址',
      '',
      '## 主机事实',
      recon
        ? `- ${recon.os.hostname} · ${recon.os.platform} ${recon.os.release} ${recon.os.arch} · ${recon.cpu.cores} cores / ${recon.cpu.model || '--'}`
        : '- 未执行 recon',
      recon && recon.os.caption ? `- ${recon.os.caption} · build ${recon.os.build || '--'} · install ${recon.os.installDate || '--'}` : '',
      recon && recon.windows && recon.windows.hotfixes && recon.windows.hotfixes.length
        ? `- 最近补丁 ${recon.windows.hotfixes[0].id || '--'} · ${recon.windows.hotfixes[0].date || '--'}`
        : '',
      '',
      '## 回环端口',
      scan && scan.ports
        ? `- open: ${scan.ports.filter(p => p.state === 'open').map(p => `${p.port}/${p.service}`).join(', ') || 'none'} · scanned ${scan.scanned} · ${scan.duration} ms`
        : '- 未执行端口扫描',
      '',
      '## HTTP 指纹',
      web && web.checks
        ? web.checks.map(c => `- ${c.method || 'GET'} ${c.path} → ${c.status == null ? 'ERR' : c.status} · ${c.ms == null ? '--' : c.ms + ' ms'}`).join('\n')
        : '- 未执行 HTTP 指纹',
      web && web.missing && web.missing.length ? `- 缺失安全头: ${web.missing.join(', ')}` : '',
      '',
      '## 真实结论',
      ...(vuln && vuln.findings && vuln.findings.length
        ? vuln.findings.map(f => `- [${String(f.sev).toUpperCase()}] ${f.id} · ${f.title}\n  - ${f.evidence}${f.refs && f.refs.length ? `\n  - refs: ${f.refs.map(r => (r.kev ? `${r.id} (KEV ${r.kev.dateAdded || ''})` : r.id)).join(', ')}` : ''}`)
        : ['- 未执行 vuln']),
      '',
      '## 认证策略',
      auth
        ? `- 默认口令在用: ${auth.defaultCredentialInUse ? 'YES' : 'no'} · 失败计数 ${auth.failuresInWindow}/${auth.maxAttempts} · 会话 ${auth.policy && auth.policy.sessionTtlHours}h · cookie Secure=${auth.policy && auth.policy.cookie.secure ? 'yes' : 'no'}`
        : '- 未执行口令策略审计',
      '',
      '## 参数审计',
      inject
        ? `- ${inject.summary.payloads} 次真实请求 · 异常 ${inject.summary.anomalies} · ${inject.summary.clean ? '未发现注入面' : '存在异常项'}`
        : '- 未执行参数审计',
      '',
      '## 其他结论',
      ...(termOpsFindings.length ? termOpsFindings.map(f => `- ${f}`) : ['- none']),
      '',
      '> 全部数据来自真实系统读数与真实网络请求；探测失败在报告中留空，不生成替代数据。'
    ].filter(line => line != null);
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skynet-real-report-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    termLine(`<span class="ok">[OUT]</span> 真实报告已生成 · ${termOpsFindings.length} 条结论`);
  }

  function termMetric(value, suffix = '') {
    return Number.isFinite(value) ? `${Math.round(value)}${suffix}` : '--';
  }

  function termMemText(s) {
    if (!s || !Number.isFinite(s.memTotal) || !Number.isFinite(s.memFree)) return '--';
    return `${termFormatBytes(s.memTotal - s.memFree)} / ${termFormatBytes(s.memTotal)}`;
  }

  function termStatus() {
    const s = termSys || termFallbackSys();
    termLine(`<span class="ok">NODE</span>     ${escapeHtml(s.hostname || '--')} · ${escapeHtml(s.platform || '--')} ${escapeHtml(s.release || '')}`);
    termLine(`<span class="ok">CPU</span>      ${termMetric(s.cpuPct, '%')} · ${s.cores || '--'} cores`);
    termLine(`<span class="ok">MEM</span>      ${termMemText(s)}`);
    termLine(`<span class="ok">FEEDS</span>    ${dataMode === 'live' ? 'LIVE' : 'SAMPLE'} · ${events.length} events`);
    termLine(`<span class="ok">PROBE</span>    ${probeLive ? 'ONLINE' : 'OFFLINE'} · ${probeLive ? 'real NIC counters' : 'start.bat required'}`);
    termLine(`<span class="ok">UPLINK</span>   USGS · NASA EONET · GIBS · RainViewer`);
    termLine('<span class="ok">PROBES</span>   terminal probes: /api/lab/* · REAL');
  }

  function termSysInfo(fancy) {
    const s = termSys || termFallbackSys();
    if (fancy) {
      termLine('<span class="ok">      ▄▄▄▄▄▄▄      </span>  <span class="dim">skynet@core</span>');
      termLine('<span class="ok">   ▄█████████▄   </span>  <span class="dim">────────────</span>');
      termLine('<span class="ok">  █████████████  </span>  OS      ' + escapeHtml(`${s.platform || '--'} ${s.release || ''}`));
      termLine('<span class="ok">  ███▀▀▀▀▀▀▀███  </span>  HOST    ' + escapeHtml(s.hostname || '--'));
      termLine('<span class="ok">  ███  ▄▄▄  ███  </span>  CPU     ' + escapeHtml(s.cpuModel || '--'));
      termLine('<span class="ok">  ███  ███  ███  </span>  CORES   ' + (s.cores || '--'));
      termLine('<span class="ok">   ▀█████████▀   </span>  MEMORY  ' + termMemText(s));
    }
    termLine(`<span class="ok">CPU</span>     ${termMetric(s.cpuPct, '%')}   <span class="dim">LOAD</span> ${Number.isFinite(s.cpuPct) ? (s.cores * s.cpuPct / 100).toFixed(2) : '--'}`);
    termLine(`<span class="ok">MEM</span>     ${termMemText(s)} (${termMetric(s.memPct, '%')})`);
    termLine(`<span class="ok">DISK</span>    ${s.disk ? `${termFormatBytes(s.disk.used)} / ${termFormatBytes(s.disk.total)} (${Math.round(s.disk.pct)}%)` : '--'}`);
    termLine(`<span class="ok">UPTIME</span>  ${termFormatUptime(s.uptime)}   <span class="dim">NODE</span> ${escapeHtml(s.node || '--')}`);
  }

  async function termLs(path = '.') {
    if (location.protocol === 'file:') {
      termLine('ls: 文件浏览需要本机服务 · 用 start.bat 启动', 'warn');
      return;
    }
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      const entries = j.entries || [];
      termLine(`<span class="dim">total ${entries.length} · ${escapeHtml(j.path)}</span>`);
      entries.forEach(f => {
        termLine(`${f.type === 'dir' ? '<span class="blue">drwxr-xr-x</span>' : '<span class="dim">-rw-r--r--</span>'}  ${String(termFormatBytes(f.size)).padStart(6, ' ')}  <span class="${f.type === 'dir' ? 'blue' : 'white'}">${escapeHtml(f.name)}${f.type === 'dir' ? '/' : ''}</span>`);
      });
    } catch (err) {
      termLine(`ls: ${escapeHtml(String(err.message || err))}`, 'err');
    }
  }

  async function termRun(raw) {
    const input = String(raw || '').trim();
    termEcho(raw);
    if (!input) return;
    termCmdHistory.push(raw);
    if (termCmdHistory.length > 80) termCmdHistory.shift();
    termHistPos = termCmdHistory.length;

    const parts = input.split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const arg = parts.join(' ');
    const s = termSys || termFallbackSys();

    switch (cmd) {
      case 'help':
        termHelp();
        break;
      case 'status':
        termStatus();
        break;
      case 'events': {
        const q = arg.toLowerCase();
        termVisibleEvents = events.filter(e => !q || `${e.name} ${e.label || ''} ${e.type}`.toLowerCase().includes(q)).slice(0, 10);
        if (!termVisibleEvents.length) { termLine('no matching events', 'warn'); break; }
        termLine('<span class="dim">IDX  TYPE      LABEL                              COORD</span>');
        termVisibleEvents.forEach((e, i) => {
          termLine(`<span class="ok">${String(i + 1).padStart(2, '0')}</span>  <span class="blue">${escapeHtml(e.type).padEnd(8, ' ')}</span>  <span class="white">${escapeHtml(e.label || e.name).slice(0, 32).padEnd(33, ' ')}</span>  <span class="dim">${fmtLat(e.lat)} ${fmtLon(e.lon)}</span>`);
        });
        break;
      }
      case 'event':
      case 'focus': {
        const n = parseInt(arg, 10);
        const e = termVisibleEvents[n - 1] || events[n - 1];
        if (!e) { termLine('usage: events  →  event <index>', 'warn'); break; }
        selectEvent(e.key);
        termLine(`<span class="ok">${escapeHtml(e.label || e.name)}</span> <span class="dim">· ${escapeHtml(e.type)} · ${fmtLat(e.lat)} ${fmtLon(e.lon)}</span>`);
        termLine(`<span class="dim">${escapeHtml(e.note)}</span>`);
        if (cmd === 'focus') {
          setAppMode('earth');
          setStageMode('map');
          setTimeout(() => { if (map) map.flyTo([e.lat, e.lon], 6, { duration: 1.2 }); }, 420);
        }
        break;
      }
      case 'earth':
        termLine('<span class="ok">opening earth view…</span>');
        setAppMode('earth');
        setStageMode('globe');
        break;
      case 'map':
        termLine('<span class="ok">opening satellite map…</span>');
        setAppMode('earth');
        setStageMode('map');
        break;
      case 'net':
        termLine('<span class="ok">opening network operations…</span>');
        setAppMode('cyber');
        break;
      case 'refresh':
        termLine('<span class="dim">refreshing realtime feeds…</span>');
        loadLiveData(true);
        break;
      case 'probe':
        termLine(`PROBE ${probeLive ? '<span class="ok">ONLINE</span>' : '<span class="warn">OFFLINE</span>'} · ${probeLive ? `${((Number(probeLast.totals.rxBps) || 0) * 8 / 1e6).toFixed(2)} Mbps down` : 'run start.bat to attach local NIC'}`);
        if (probeLive && probeLast.adapters) termLine(`<span class="dim">${escapeHtml(probeLast.adapters.map(a => a.name).join(', '))}</span>`);
        break;
      case 'ops':
      case 'tools':
        termOpsTools();
        break;
      case 'recon':
        await termOpsRecon();
        break;
      case 'nmap':
      case 'scan':
        await termOpsNmap(arg);
        break;
      case 'web':
        await termOpsWeb();
        break;
      case 'vuln':
        await termOpsVuln();
        break;
      case 'audit':
        await termOpsAudit();
        break;
      case 'searchsploit':
        await termOpsSearch(arg);
        break;
      case 'msf':
        await termOpsMsf(arg);
        break;
      case 'msfconsole':
        await termOpsMsfReal();
        break;
      case 'lab':
        await termOpsLab();
        break;
      case 'hydra':
        await termOpsHydra();
        break;
      case 'sqlmap':
      case 'sqli':
        await termOpsSqlmap();
        break;
      case 'payload':
        await termOpsPayload(arg);
        break;
      case 'scope':
        termOpsScope();
        break;
      case 'target':
        termOpsTarget(arg);
        break;
      case 'report':
        termOpsReport();
        break;
      case 'hash':
        await termOpsHash(arg);
        break;
      case 'sys':
        termSysInfo(false);
        break;
      case 'neofetch':
        termSysInfo(true);
        break;
      case 'ls':
        termLs(arg || '.');
        break;
      case 'cat':
        if (!arg) termLine('usage: cat <file>', 'warn');
        else termCat(arg);
        break;
      case 'ping':
        await termPing(arg);
        break;
      case 'clear':
        termOut.innerHTML = '';
        break;
      case 'banner':
        termOut.innerHTML = '';
        termBoot();
        break;
      case 'reboot':
        termOut.innerHTML = '';
        termLine('<span class="warn">SYSTEM REBOOT REQUESTED…</span>');
        setTimeout(termBoot, 500);
        break;
      case 'date':
        termLine(new Date().toString());
        break;
      case 'whoami': {
        if (location.protocol === 'file:') { termLine('whoami: 需要本机服务 · 用 start.bat 启动', 'warn'); break; }
        try {
          const f = await termFactsGet();
          const user = f.user || {};
          termLine(`<span class="white">${escapeHtml(user.full || user.name || '--')}</span> · session ${escapeHtml(termSessionUser || '--')} · host ${escapeHtml((f.os && f.os.hostname) || '--')}`);
          termLine(`<span class="dim">uid=${escapeHtml(user.name || '--')} · ${escapeHtml((f.os && (f.os.caption || f.os.platform)) || '--')}</span>`);
        } catch (err) {
          termLine(`whoami: ${escapeHtml(String(err.message || err))}`, 'err');
        }
        break;
      }
      case 'hostname':
        try {
          const f = await termFactsGet();
          termLine(escapeHtml(f.os.hostname));
        } catch (err) {
          termLine(`hostname: ${escapeHtml(String(err.message || err))}`, 'err');
        }
        break;
      case 'uptime':
        try {
          const f = await termFactsGet();
          termLine(`up ${termFormatUptime(f.os.uptime)} · boot ${escapeHtml(termStamp(f.os.bootTime))} · ${events.length} events`);
        } catch (err) {
          termLine(`up ${termFormatUptime(s.uptime)} · ${events.length} events`);
        }
        break;
      case 'uname':
        try {
          const f = await termFactsGet();
          termLine(`${escapeHtml(f.os.type || f.os.platform)} ${escapeHtml(f.os.release)} ${escapeHtml(f.os.arch)} · node ${escapeHtml(f.os.node)}`);
        } catch (err) {
          termLine(`${escapeHtml(s.platform || '--')} ${escapeHtml(s.release || '')} ${escapeHtml(s.arch || '')}`);
        }
        break;
      case 'ifconfig': {
        if (location.protocol === 'file:') { termLine('ifconfig: 需要本机服务 · 用 start.bat 启动', 'warn'); break; }
        try {
          const f = await termFactsGet();
          (f.nic || []).forEach(nic => {
            (nic.addresses || []).forEach(a => {
              const stat = ((probeLast && probeLast.adapters) || []).find(x => x.name === nic.name) || null;
              const rate = stat ? ` · ↓ ${((stat.rxBps || 0) * 8 / 1e6).toFixed(2)} / ↑ ${((stat.txBps || 0) * 8 / 1e6).toFixed(2)} Mbps` : '';
              termLine(`${escapeHtml(nic.name)} · ${escapeHtml(a.address)} · ${escapeHtml(a.mac || '--')}${a.internal ? ' · internal' : ''}${rate}`);
            });
          });
          if (!(f.nic || []).length) termLine('ifconfig: 未读取到网卡', 'warn');
        } catch (err) {
          termLine(`ifconfig: ${escapeHtml(String(err.message || err))}`, 'err');
        }
        break;
      }
      case 'exit':
        setAppMode('earth');
        break;
      case 'sudo':
        termLine('[sudo] 本终端不提供提权 · 没有密码提示，也没有执行任何命令', 'warn');
        break;
      case 'rm':
        termLine('rm: 本终端为只读界面 · 未删除任何文件', 'warn');
        break;
      default:
        termLine(`command not found: ${escapeHtml(cmd)} · type <span class="ok">help</span>`, 'err');
    }
  }

  function runTermInput() {
    const raw = termInput.value;
    termInput.value = '';
    termRun(raw);
    focusTermWindow();
  }

  function bindTerminal() {
    termOut = document.getElementById('termOutput');
    termInput = document.getElementById('termInput');
    termFilesEl = document.getElementById('termFiles');
    termEventsEl = document.getElementById('termEvents');

    document.getElementById('termWindow').addEventListener('click', focusTermWindow);

    termInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runTermInput();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!termCmdHistory.length) return;
        termHistPos = Math.max(0, termHistPos - 1);
        termInput.value = termCmdHistory[termHistPos] || '';
        setTimeout(() => termInput.setSelectionRange(termInput.value.length, termInput.value.length), 0);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        termHistPos = Math.min(termCmdHistory.length, termHistPos + 1);
        termInput.value = termCmdHistory[termHistPos] || '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        termComplete();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        termOut.innerHTML = '';
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        termLine('^C', 'warn');
        termInput.value = '';
      } else if (e.key === 'F1') {
        e.preventDefault();
        termHelp();
      }
    });

    document.querySelectorAll('#termKeyboard .key').forEach(key => {
      key.addEventListener('click', () => {
        const k = key.dataset.key;
        if (k === 'Enter') runTermInput();
        else if (k === 'Backspace') termInput.value = termInput.value.slice(0, -1);
        else if (k === 'Tab') termComplete();
        else if (k.length === 1) { termInput.value += k; }
        focusTermWindow();
        key.classList.add('active');
        setTimeout(() => key.classList.remove('active'), 120);
      });
    });

    document.addEventListener('keydown', e => {
      if (appMode !== 'terminal') return;
      if (e.key === 'F1') { e.preventDefault(); termHelp(); }
      const target = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      document.querySelectorAll(`#termKeyboard .key[data-key="${target.replace(/"/g, '\\"')}"]`).forEach(k => k.classList.add('active'));
    });
    document.addEventListener('keyup', e => {
      const target = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      document.querySelectorAll(`#termKeyboard .key[data-key="${target.replace(/"/g, '\\"')}"]`).forEach(k => k.classList.remove('active'));
    });

    document.getElementById('termClock').textContent = nowParts().text;
    termClockTimer = setInterval(() => {
      const n = nowParts();
      const el = document.getElementById('termClock');
      if (el) el.textContent = n.text;
      if (termSys) {
        const up = document.getElementById('termUptime');
        if (up) up.textContent = `UPTIME ${termFormatUptime(termSys.uptime)}`;
      }
    }, 1000);
  }

  function startTerminal() {
    if (terminalStarted) return;
    terminalStarted = true;
    bindTerminal();
    termBoot();

    termCpuHistory = [];
    termDownHistory = [];
    termUpHistory = [];
    termSys = termFallbackSys();
    drawTermCpuGraph();
    drawTermNetGraph();
    renderTermProc();
    pollTermSys();
    pollTermNet();
    loadTermFiles();
    renderTermEvents();

    termSysTimer = setInterval(pollTermSys, 3000);
    termNetTimer = setInterval(pollTermNet, 1200);
    setInterval(renderTermEvents, 8000);
    setInterval(termProcsRefresh, 5000);

    if (location.protocol !== 'file:') {
      fetch('/api/session', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data && data.ok) termSessionUser = data.user || ''; })
        .catch(() => {});
      termFactsGet().catch(() => {});
      probeNetwork();
      termProbeTimer = setInterval(probeNetwork, 2600);
    }
  }

  /* ----------------------------------------------------------
     初始化
  ---------------------------------------------------------- */
  try {
    initGlobe();
  } catch (err) {
    console.error(err);
    if (stageLoading) stageLoading.textContent = '地球投影初始化失败 · 请检查 WebGL';
  }

  selectEvent(events[0].key, { silent: true });
  updateEventCount();
  updateCenterLon();
  updateMapStatus();
  updateLinkInfo();
  setTimeout(tickClocks, 100);
  setTimeout(() => loadLiveData(), 900);
  setInterval(() => { if (!liveLoading) loadLiveData(); }, 120000);
})();
