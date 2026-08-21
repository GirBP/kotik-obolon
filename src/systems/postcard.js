// ================= ЛИСТІВКА З ОБОЛОНІ (шер-картка) =================
// Гра сама малює красивий кадр поїздки: шматок ЖИВОГО світу навколо котика
// (той самий рендер, що й на карті) + рамка, підпис вулиці, час, погода і статистика.
// Один тап — «Поділитися» (Web Share API з файлом) або завантажити.
//
// Це головна механіка поширення: людина ділиться не скріншотом інтерфейсу,
// а листівкою, яку хочеться показати. Кольори — з THEME, тож листівка
// автоматично відповідає художньому напряму гри.
import { THEME } from '../world/theme.js';
import { drawRegion } from '../world/scenery.js';
import { car, state } from '../core/state.js';
import { fromXY } from '../core/geo.js';
import { toast } from '../core/dom.js';

const W = 1080; // портрет під Threads/X
const H = 1350;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

/** Намалювати листівку у canvas і повернути його. */
export function renderPostcard() {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');

  const pad = 46;
  const mapH = 900;

  // тло-паспарту
  ctx.fillStyle = THEME.cardBg || '#f6f1e6';
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
  // м'яка віньєтка, щоб кадр «дихав»
  const vg = ctx.createRadialGradient(W / 2, pad + mapH / 2, mapH * 0.25, W / 2, pad + mapH / 2, mapH * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, THEME.cardVignette || 'rgba(20,18,12,.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  // котик у центрі кадру
  drawCat(ctx, W / 2, pad + mapH / 2, 2.3, car.heading || 0);
  ctx.restore();

  // рамка вікна
  ctx.strokeStyle = THEME.cardEdge || 'rgba(0,0,0,.10)';
  ctx.lineWidth = 3;
  rr(ctx, pad, pad, W - pad * 2, mapH, 34);
  ctx.stroke();

  // ---- підписи ----
  const ink = THEME.cardInk || '#26221a';
  const soft = THEME.cardInkSoft || 'rgba(38,34,26,.62)';
  let y = pad + mapH + 78;

  // вулиця (велике)
  const street = (state.curStreet || 'Оболонь').split(' · ')[0];
  ctx.fillStyle = ink;
  ctx.font = '700 62px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  let s = street;
  while (ctx.measureText(s).width > W - pad * 2 - 10 && s.length > 4) s = s.slice(0, -2);
  ctx.fillText(s === street ? s : s + '…', pad, y);

  // підзаголовок: час/погода
  y += 52;
  const timeStr = (document.getElementById('liveChip') || {}).textContent || '';
  ctx.fillStyle = soft;
  ctx.font = '500 34px system-ui, -apple-system, sans-serif';
  ctx.fillText(timeStr.trim() || 'Оболонь, Київ', pad, y);

  // ---- смужка статистики ----
  y += 46;
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
    ctx.fillStyle = THEME.cardChip || 'rgba(0,0,0,.05)';
    rr(ctx, x, y, bw, 108, 22);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = '700 34px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ic + ' ' + val, x + bw / 2, y + 66);
  });

  // ---- підпис бренду ----
  ctx.textAlign = 'center';
  ctx.fillStyle = soft;
  ctx.font = '600 30px system-ui, -apple-system, sans-serif';
  ctx.fillText('🐱 Котик за кермом · girbp.github.io/kotik-obolon', W / 2, H - 44);

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
