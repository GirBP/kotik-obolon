// ================= ІНТЕРПОЛЯЦІЯ (чиста математика, тестується) =================
// Використовується мультиплеєром для плавного руху чужих котиків між ~10 Гц оновленнями.

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Інтерполяція кута найкоротшою дугою (щоб не «прокручувало» довгим шляхом через ±π). */
export function lerpAngle(a, b, t) {
  const TAU = 2 * Math.PI;
  // нормалізуємо різницю в (−π, π] через ДОДАТНИЙ модуль (JS % зберігає знак діленого)
  const d = (((b - a) % TAU) + 3 * Math.PI) % TAU - Math.PI;
  return a + d * t;
}

/**
 * Стан {x,y,h} з буфера семплів [{x,y,h,t}] (t зростає) на момент часу rt.
 * rt ≤ найстарішого → перший семпл; rt ≥ найновішого → останній (freeze);
 * між двома → лінійно (позиція) + найкоротша дуга (курс). null, якщо буфер порожній.
 */
export function interpAt(buf, rt) {
  if (!buf || !buf.length) return null;
  if (rt <= buf[0].t) return { x: buf[0].x, y: buf[0].y, h: buf[0].h };
  const last = buf[buf.length - 1];
  if (rt >= last.t) return { x: last.x, y: last.y, h: last.h };
  let i = 0;
  while (i < buf.length - 1 && buf[i + 1].t < rt) i++;
  const a = buf[i],
    c = buf[i + 1];
  const t = (rt - a.t) / Math.max(1, c.t - a.t);
  return { x: lerp(a.x, c.x, t), y: lerp(a.y, c.y, t), h: lerpAngle(a.h, c.h, t) };
}
