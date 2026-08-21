// ================= МУЛЬТИПЛЕЄР (v0.9, якісний клієнт на публічному MQTT) =================
// Serverless: публічні брокери (EMQX→HiveMQ фолбек). Якість — на клієнті:
//  • інтерполяційний буфер → плавний рух чужих котиків (без телепортів);
//  • справжній спрайт котика-авто, тонований за гравцем, з ніком і КУРСОМ;
//  • передаємо x,y,heading,speed → приймач гладко інтерполює;
//  • надійний реконект (close/offline/error) + presence-таймаут.
// Канал публічний і best-effort (свідомий вибір власника); передаються лише
// нік і позиція в грі. Текст ніка екранується (esc) перед вставкою в DOM.
import { MP_BROKERS } from '../core/config.js';
import { car, state } from '../core/state.js';
import { fromXY } from '../core/geo.js';
import { esc, toast } from '../core/dom.js';
import { map } from '../world/map.js';
import { interpAt } from '../core/interp.js';

const PUB_MS = 100; // 10 Гц публікація позиції
const INTERP_MS = 160; // рендеримо чужих на ~160 мс у минулому (буфер згладжування)
const PRESENCE_MS = 6000; // немає оновлень стільки → зникає
const RECONNECT_MS = 3000; // пауза перед повторним підключенням
const BUF_MAX = 16;

export const mp = {
  on: false,
  enabled: false,
  client: null,
  id: 'k' + Math.random().toString(36).slice(2, 9),
  nick: 'Котик',
  room: 'obolon',
  base: '',
  ghosts: new Map(), // id -> { mk, carEl, buf:[{x,y,h,t}], last, hue }
  brokerIdx: 0,
  pubT: null,
  pruneT: null,
  reconnectT: null,
};

function hueOf(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function injectStyles() {
  if (document.getElementById('mpStyles')) return;
  const css =
    '.mp-ghost{pointer-events:none;}' +
    '.mpg-name{position:absolute;left:50%;top:-2px;transform:translateX(-50%);font-size:9px;font-weight:800;' +
    'background:rgba(20,22,26,.85);color:#fff;border-radius:6px;padding:1px 5px;white-space:nowrap;max-width:80px;' +
    'overflow:hidden;text-overflow:ellipsis;}' +
    '.mpg-car{position:absolute;left:50%;top:20px;transform-origin:50% 50%;margin-left:-12px;' +
    'filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));transition:none;}';
  const st = document.createElement('style');
  st.id = 'mpStyles';
  st.textContent = css;
  document.head.appendChild(st);
}

// спрайт: той самий силует котика-авто, що в гравця, тонований hue гравця
function ghostIcon(nick, hue) {
  const body = `hsl(${hue},70%,55%)`,
    ear = `hsl(${hue},65%,42%)`;
  const svg =
    `<svg class="mpg-car" viewBox="0 0 44 64" width="24" height="35">` +
    `<path d="M9 16 L4 3 L17 11 Z" fill="${ear}"/><path d="M35 16 L40 3 L27 11 Z" fill="${ear}"/>` +
    `<path d="M10 14 L7 6 L15 11 Z" fill="#f7b8c0"/><path d="M34 14 L37 6 L29 11 Z" fill="#f7b8c0"/>` +
    `<rect x="6" y="10" width="32" height="50" rx="13" fill="${body}"/>` +
    `<rect x="11" y="15" width="22" height="12" rx="5" fill="#bfe0f2"/>` +
    `<circle cx="17" cy="21" r="2.4" fill="#1a1c20"/><circle cx="27" cy="21" r="2.4" fill="#1a1c20"/>` +
    `<circle cx="12" cy="13" r="2.2" fill="#fff6c2"/><circle cx="32" cy="13" r="2.2" fill="#fff6c2"/>` +
    `<rect x="3" y="40" width="4" height="12" rx="2" fill="#222"/><rect x="37" y="40" width="4" height="12" rx="2" fill="#222"/>` +
    `</svg>`;
  return L.divIcon({
    className: 'mp-ghost',
    iconSize: [44, 60],
    iconAnchor: [22, 37],
    html: `<div class="mpg-name">${esc(nick)}</div>${svg}`,
  });
}

// ---- вхідні позиції → буфер (мітимо ЛОКАЛЬНИМ часом, щоб не залежати від чужого годинника) ----
function onPos(d) {
  try {
    if (!d || typeof d.id !== 'string' || d.id === mp.id) return;
    if (typeof d.x !== 'number' || typeof d.y !== 'number' || !isFinite(d.x) || !isFinite(d.y)) return;
    const now = performance.now();
    let g = mp.ghosts.get(d.id);
    if (!g) {
      injectStyles();
      const hue = hueOf(d.id);
      const p = fromXY(d.x, d.y);
      const mk = L.marker([p.lat, p.lng], {
        icon: ghostIcon((d.n || 'Котик').slice(0, 12), hue),
        interactive: false,
        keyboard: false,
        zIndexOffset: -100,
      }).addTo(map);
      g = { mk, carEl: null, buf: [], last: now, hue };
      mp.ghosts.set(d.id, g);
      updateChip();
      toast('👥 ' + esc((d.n || 'Котик').slice(0, 12)) + ' поруч!');
    }
    g.buf.push({ x: d.x, y: d.y, h: typeof d.h === 'number' ? d.h : 0, t: now });
    if (g.buf.length > BUF_MAX) g.buf.shift();
    g.last = now;
  } catch (_) {}
}

// ---- рендер: щокадру плавно рухаємо/повертаємо чужих котиків ----
function step() {
  try {
    if (!mp.ghosts.size) return;
    const rt = performance.now() - INTERP_MS; // час рендеру (у минулому)
    for (const g of mp.ghosts.values()) {
      const s = interpAt(g.buf, rt);
      if (!s) continue;
      const { x, y, h } = s;
      const p = fromXY(x, y);
      g.mk.setLatLng([p.lat, p.lng]);
      if (!g.carEl) {
        const el = g.mk.getElement();
        g.carEl = el ? el.querySelector('.mpg-car') : null;
      }
      if (g.carEl) g.carEl.style.transform = `rotate(${h}rad)`;
    }
  } catch (_) {}
}

function dropGhost(id) {
  const g = mp.ghosts.get(id);
  if (g) {
    try {
      map.removeLayer(g.mk);
    } catch (_) {}
    mp.ghosts.delete(id);
    updateChip();
  }
}
function prune() {
  const now = performance.now();
  for (const [id, g] of mp.ghosts) if (now - g.last > PRESENCE_MS) dropGhost(id);
}
function updateChip() {
  try {
    const c = document.getElementById('mpChip');
    if (!c) return;
    if (mp.on) {
      c.classList.remove('hidden');
      c.textContent = '👥 ' + (1 + mp.ghosts.size);
    } else c.classList.add('hidden');
  } catch (_) {}
}

// ================= MQTT =================
function connectBroker() {
  const url = MP_BROKERS[mp.brokerIdx % MP_BROKERS.length];
  try {
    mp.client = mqtt.connect(url, {
      clientId: 'kotik_' + mp.id,
      keepalive: 30,
      connectTimeout: 6000,
      reconnectPeriod: 0, // реконект робимо самі (з фолбеком брокерів)
      will: { topic: mp.base + '/leave', payload: JSON.stringify({ id: mp.id }), qos: 0, retain: false },
    });
  } catch (_) {
    mp.client = null;
    scheduleReconnect(true);
    return;
  }
  mp.client.on('connect', () => {
    mp.on = true;
    mp.brokerIdx = 0;
    try {
      mp.client.subscribe(mp.base + '/pos');
      mp.client.subscribe(mp.base + '/leave');
    } catch (_) {}
    toast('👥 Кімната «' + esc(mp.room) + '»: підключено');
    updateChip();
  });
  mp.client.on('message', (t, msg) => {
    try {
      if (msg && msg.length > 512) return; // захист від сміття
      const d = JSON.parse(msg.toString());
      if (t.endsWith('/leave')) {
        if (d && d.id) dropGhost(d.id);
      } else onPos(d);
    } catch (_) {}
  });
  mp.client.on('error', () => {
    try {
      mp.client.end(true);
    } catch (_) {}
    mp.client = null;
    mp.on = false;
    mp.brokerIdx++;
    scheduleReconnect(mp.brokerIdx >= MP_BROKERS.length); // якщо всі брокери впали — пауза
  });
  mp.client.on('close', () => {
    mp.on = false;
    updateChip();
    scheduleReconnect(false);
  });
  mp.client.on('offline', () => {
    mp.on = false;
    updateChip();
  });
}
function scheduleReconnect(withDelay) {
  if (!mp.enabled) return;
  clearTimeout(mp.reconnectT);
  mp.reconnectT = setTimeout(
    () => {
      if (mp.enabled && !mp.client) connectBroker();
    },
    withDelay ? RECONNECT_MS : 400
  );
}

function start() {
  try {
    if (mp.client) return; // ідемпотентно
    if (!window.mqtt) {
      toast('👥 Мультиплеєр недоступний (не завантажився mqtt)');
      return;
    }
    const nickEl = document.getElementById('mpNick');
    const roomEl = document.getElementById('mpRoom');
    mp.nick = ((nickEl && nickEl.value.trim()) || 'Котик').slice(0, 12);
    mp.room = ((roomEl && roomEl.value.trim().replace(/[^\wа-яіїєґ-]/gi, '')) || 'obolon').slice(0, 16);
    try {
      localStorage.setItem('mpNick', mp.nick);
      localStorage.setItem('mpRoom', mp.room);
    } catch (_) {}
    mp.base = 'kotikobolon/' + mp.room;
    mp.brokerIdx = 0;
    connectBroker();
    clearInterval(mp.pubT);
    mp.pubT = setInterval(() => {
      if (mp.on && state.phase === 'play' && mp.client && mp.client.connected) {
        try {
          mp.client.publish(
            mp.base + '/pos',
            JSON.stringify({
              id: mp.id,
              n: mp.nick,
              x: +car.x.toFixed(1),
              y: +car.y.toFixed(1),
              h: +(car.heading || 0).toFixed(3),
              s: +(car.speed || 0).toFixed(1),
            })
          );
        } catch (_) {}
      }
    }, PUB_MS);
    clearInterval(mp.pruneT);
    mp.pruneT = setInterval(prune, 2000);
  } catch (_) {}
}

function stop() {
  try {
    clearTimeout(mp.reconnectT);
    clearInterval(mp.pubT);
    clearInterval(mp.pruneT);
    if (mp.client) {
      try {
        mp.client.publish(mp.base + '/leave', JSON.stringify({ id: mp.id }));
        mp.client.end(true);
      } catch (_) {}
    }
    mp.client = null;
    mp.on = false;
    for (const [id] of mp.ghosts) dropGhost(id);
    updateChip();
  } catch (_) {}
}

function init() {
  try {
    if (window.__mpInited) return;
    window.__mpInited = true;
    const nickEl = document.getElementById('mpNick');
    const roomEl = document.getElementById('mpRoom');
    try {
      if (nickEl) nickEl.value = localStorage.getItem('mpNick') || '';
      if (roomEl) roomEl.value = localStorage.getItem('mpRoom') || 'obolon';
    } catch (_) {}
    const tgl = document.getElementById('mpToggle');
    if (tgl)
      tgl.addEventListener('click', () => {
        mp.enabled = !mp.enabled;
        state.mpEnabled = mp.enabled;
        tgl.textContent = '👥 Грати разом: ' + (mp.enabled ? 'увімк' : 'вимк');
        tgl.classList.toggle('on', mp.enabled);
        if (!mp.enabled) stop();
      });
  } catch (_) {}
}

window.MP = { init, start, stop, step };
