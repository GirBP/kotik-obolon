// ================= ЛИСТІВКА З ОБОЛОНІ (шер-картка) =================
// Гра сама малює кадр поїздки: шматок живого світу навколо котика (той самий
// рендер, що й на карті) + рамка, підпис вулиці, час, погода і статистика.
// Один тап — «Поділитися» (Web Share API з файлом) або завантажити.
//
// Це головна механіка поширення: людина ділиться не скріншотом інтерфейсу,
// а листівкою, яку хочеться показати. Кольори беруться з THEME, тож листівка
// автоматично відповідає темі гри — теплій діорамі вдень, бурштину на
// чорнильно-синьому вночі.
import { THEME } from '../world/theme.js';
import { drawRegion } from '../world/scenery.js';
import { car, state } from '../core/state.js';
import { fromXY } from '../core/geo.js';
import { toast } from '../core/dom.js';

const W = 1080; // портрет під Threads/X
const H = 1350;

// Manrope — бажаний бренд-шрифт (якщо колись буде підвантажений сторінкою),
// але ми ніколи не покладаємось на нього повністю: усі довжини рядків
// перевіряються через measureText() у рантаймі, тож фолбек-шрифти системи
// не зламають компонування, навіть якщо Manrope відсутній.
const FONT_STACK = '"Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Обрізати текст з «…», щоб він гарантовано влазив у maxWidth (шрифт вже має бути виставлений). */
function fitText(ctx, text, maxWidth) {
  try {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s.length < text.length ? s.trimEnd() + '…' : s;
  } catch (_) {
    return text;
  }
}

// котик-авто згори (той самий силует, що в грі)
function drawCat(ctx, cx, cy, scale, heading) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading || 0);
  ctx.scale(scale, scale);
  ctx.translate(-22, -32); // центр viewBox 44x64
  const p = (d, fill) => {
    const path = new Path2D(d);
    ctx.fillStyle = fill;
    ctx.fill(path);
  };
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  p('M9 16 L4 3 L17 11 Z', '#d98a1e');
  p('M35 16 L40 3 L27 11 Z', '#d98a1e');
  ctx.shadowColor = 'transparent';
  p('M10 14 L7 6 L15 11 Z', '#f7b8c0');
  p('M34 14 L37 6 L29 11 Z', '#f7b8c0');
  rr(ctx, 6, 10, 32, 50, 13);
  ctx.fillStyle = '#F5A623';
  ctx.fill();
  rr(ctx, 11, 15, 22, 12, 5);
  ctx.fillStyle = '#bfe0f2';
  ctx.fill();
  ctx.fillStyle = '#1a1c20';
  ctx.beginPath();
  ctx.arc(17, 21, 2.4, 0, 7);
  ctx.arc(27, 21, 2.4, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#fff6c2';
  ctx.beginPath();
  ctx.arc(12, 13, 2.2, 0, 7);
  ctx.arc(32, 13, 2.2, 0, 7);
  ctx.fill();
  ctx.restore();
}

/** Слід котячої лапки: подушечка + 4 пальці (проста canvas-фігура, без шрифтів/іконок). */
function drawPawPrint(ctx, cx, cy, scale, color) {
  try {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 6, 9, 7.2, 0, 0, Math.PI * 2);
    ctx.fill();
    const toe = (tx, ty, rot) => {
      ctx.beginPath();
      ctx.ellipse(tx, ty, 3.4, 4.3, rot, 0, Math.PI * 2);
      ctx.fill();
    };
    toe(-9, -4.5, -0.4);
    toe(-3.1, -8.4, -0.12);
    toe(3.1, -8.4, 0.12);
    toe(9, -4.5, 0.4);
    ctx.restore();
  } catch (_) {
    /* декоративний штрих — тиша при будь-якій помилці canvas */
  }
}

// Текст уздовж дуги штемпеля: контекст обертається посимвольно навколо (0,0),
// кожен символ малюється на відстані radius «вгору» від центру локальної системи —
// класична техніка кругового написання без залежностей.
function arcText(ctx, text, radius, totalAngle) {
  const n = text.length;
  if (!n) return;
  const step = totalAngle / n;
  ctx.save();
  ctx.rotate(-totalAngle / 2 + step / 2);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(0, -radius);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
    ctx.rotate(step);
  }
  ctx.restore();
}

// Детермінований «зношений» контур кола: короткі дуги з пропусками фарби,
// щоб штемпель не виглядав як ідеальна векторна лінія.
function brokenRing(ctx, radius, color, lineWidth, seed) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  const segs = 46;
  const step = (Math.PI * 2) / segs;
  let s = (seed >>> 0) || 1;
  for (let i = 0; i < segs; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    if ((s % 100) / 100 < 0.24) continue; // ~24% сегментів пропущено
    const a0 = i * step;
    const a1 = a0 + step * 0.7; // мікро-пропуск і в «намальованих» сегментах
    ctx.beginPath();
    ctx.arc(0, 0, radius, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Круглий поштовий штемпель «ОБОЛОНЬ · КИЇВ» з датою і часом поїздки. */
function drawPostmark(ctx, cx, cy, r, ink) {
  try {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-8 * Math.PI) / 180); // легкий нахил штемпеля

    brokenRing(ctx, r, ink, 3.2, 7);
    brokenRing(ctx, r * 0.7, ink, 2.2, 13);

    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 15px ${FONT_STACK}`;
    // текст по дузі — обертання контексту посимвольно (верхня дуга ~210°)
    arcText(ctx, 'ОБОЛОНЬ · КИЇВ', (r + r * 0.7) / 2, (210 * Math.PI) / 180);

    ctx.font = `800 21px ${FONT_STACK}`;
    ctx.fillText(`${dd}.${mm}.${yyyy}`, 0, -7);

    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.32, 7);
    ctx.lineTo(r * 0.32, 7);
    ctx.stroke();

    ctx.font = `600 15px ${FONT_STACK}`;
    ctx.fillText(`${hh}:${mi}`, 0, 24);

    ctx.restore();
  } catch (_) {
    /* штемпель — суто декоративний елемент, ніколи не валимо рендер листівки */
  }
}

/** Намалювати листівку у canvas і повернути його. */
export function renderPostcard() {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');

  // ---- тема: тепла паперова діорама вдень, бурштин на індиго вночі ----
  let isNight = false;
  try {
    isNight = !!(window.LIVE && window.LIVE.isNight);
  } catch (_) {
    isNight = false;
  }
  const T = isNight
    ? {
        bg: THEME.cardBgNight || '#131b3a',
        ink: THEME.cardInkNight || '#F3E9D2',
        inkSoft: THEME.cardInkSoftNight || 'rgba(243,233,210,.66)',
        chip: THEME.cardChipNight || 'rgba(243,233,210,.14)',
        edge: THEME.cardEdgeNight || 'rgba(243,233,210,.24)',
        vignette: THEME.cardVignetteNight || 'rgba(5,7,20,.46)',
        hairline: THEME.cardHairlineNight || 'rgba(243,233,210,.18)',
      }
    : {
        bg: THEME.cardBg || '#f6f1e6',
        ink: THEME.cardInk || '#26221a',
        inkSoft: THEME.cardInkSoft || 'rgba(38,34,26,.62)',
        chip: THEME.cardChip || 'rgba(0,0,0,.05)',
        edge: THEME.cardEdge || 'rgba(0,0,0,.10)',
        vignette: THEME.cardVignette || 'rgba(20,18,12,.28)',
        hairline: THEME.cardHairline || 'rgba(38,34,26,.13)',
      };
  const stampInk = 'rgba(124,60,32,.55)'; // теплий чорнильний колір — сталий для дня і ночі

  const pad = 46;
  const mapH = 900;

  // тло-паспарту
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);

  // ---- вікно з живим світом ----
  const p = fromXY(car.x, car.y);
  ctx.save();
  rr(ctx, pad, pad, W - pad * 2, mapH, 34);
  ctx.clip();
  const ok = drawRegion(ctx, p.lat, p.lng, W, H, 0.3); // м/px — близько й читабельно
  if (!ok) {
    ctx.fillStyle = THEME.ground;
    ctx.fillRect(0, 0, W, H);
  }
  // м'яка віньєтка, щоб кадр «дихав» (вночі — глибша, щоб продати настрій)
  const vg = ctx.createRadialGradient(W / 2, pad + mapH / 2, mapH * 0.25, W / 2, pad + mapH / 2, mapH * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, T.vignette);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  // котик у центрі кадру
  drawCat(ctx, W / 2, pad + mapH / 2, 2.3, car.heading || 0);
  ctx.restore();

  // рамка вікна
  ctx.strokeStyle = T.edge;
  ctx.lineWidth = 3;
  rr(ctx, pad, pad, W - pad * 2, mapH, 34);
  ctx.stroke();

  // ---- поштовий штемпель (верхній правий кут картки) ----
  const stampR = 86;
  drawPostmark(ctx, W - pad - stampR, pad + stampR, stampR, stampInk);

  // ---- hairline-роздільник між кадром і підписами ----
  const frameBottom = pad + mapH;
  const hairY = frameBottom + 34;
  ctx.strokeStyle = T.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, hairY);
  ctx.lineTo(W - pad, hairY);
  ctx.stroke();

  // ---- підписи: вулиця головна → час/погода підзаголовок → чипи статистики ----
  let y = hairY + 62;

  // вулиця (головний елемент ієрархії)
  const streetRaw = (state.curStreet || 'Оболонь').split(' · ')[0];
  ctx.fillStyle = T.ink;
  ctx.font = `700 60px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, streetRaw, W - pad * 2 - 10), pad, y);

  // підзаголовок: час/погода
  y += 50;
  const timeStr = ((document.getElementById('liveChip') || {}).textContent || '').trim() || 'Оболонь, Київ';
  ctx.fillStyle = T.inkSoft;
  ctx.font = `500 33px ${FONT_STACK}`;
  ctx.fillText(fitText(ctx, timeStr, W - pad * 2), pad, y);

  // ---- смужка статистики (третинний рівень — чипи) ----
  y += 44;
  const chipH = 100;
  const st = (window.SAVE && window.SAVE.stats && window.SAVE.stats()) || {};
  const rank = (window.PROGRESSION && window.PROGRESSION.rank && window.PROGRESSION.rank()) || {};
  const items = [
    ['🛞', (st.totalKm || 0).toFixed(1) + ' км'],
    ['💵', Math.round(state.money) + ' грн'],
    ['🏅', rank.name || 'Новачок'],
  ];
  const bw = (W - pad * 2 - 24) / 3;
  items.forEach(([ic, val], i) => {
    const x = pad + i * (bw + 12);
    ctx.fillStyle = T.chip;
    rr(ctx, x, y, bw, chipH, 22);
    ctx.fill();
    ctx.fillStyle = T.ink;
    ctx.font = `700 28px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    const label = fitText(ctx, ic + ' ' + val, bw - 20);
    ctx.fillText(label, x + bw / 2, y + chipH * 0.6);
  });

  // ---- підпис бренду + слід лапки ----
  const brandText = 'Котик за кермом · girbp.github.io/kotik-obolon';
  const brandY = H - 44;
  ctx.font = `600 29px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  const brandW = ctx.measureText(brandText).width;
  ctx.fillStyle = T.inkSoft;
  ctx.fillText(brandText, W / 2, brandY);
  drawPawPrint(ctx, W / 2 - brandW / 2 - 30, brandY - 9, 1.05, T.inkSoft);

  return cv;
}

function fileName() {
  return 'kotik-obolon-' + Math.random().toString(36).slice(2, 7) + '.png';
}

/** Зробити листівку і запропонувати поділитися (або зберегти). */
export async function share() {
  try {
    const cv = renderPostcard();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png', 0.95));
    if (!blob) {
      toast('Не вдалось зробити листівку');
      return false;
    }
    const file = new File([blob], fileName(), { type: 'image/png' });
    const text = 'Катаюсь Оболонню 🐱🚗';
    const url = 'https://girbp.github.io/kotik-obolon/';
    // 1) поділитися файлом (iOS/Android)
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: 'Котик за кермом' });
        return true;
      }
    } catch (_) {
      return false; // скасував — тиша
    }
    // 2) поділитися посиланням
    try {
      if (navigator.share) {
        await navigator.share({ text, url, title: 'Котик за кермом' });
        return true;
      }
    } catch (_) {
      return false;
    }
    // 3) фолбек: зберегти файл
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('📸 Листівку збережено — кидай у Threads!');
    return true;
  } catch (_) {
    return false;
  }
}

window.POSTCARD = { render: renderPostcard, share };
