import { describe, it, expect } from 'vitest';
import { lerp, lerpAngle, interpAt } from '../src/core/interp.js';

describe('interp (плавний рух мультиплеєра)', () => {
  const buf = [
    { x: 0, y: 0, h: 0, t: 1000 },
    { x: 1000, y: 200, h: 1, t: 2000 },
  ];

  it('інтерполює позицію МІЖ семплами (плавно, не телепорт)', () => {
    const s = interpAt(buf, 1500); // рівно посередині
    expect(s.x).toBeCloseTo(500, 3);
    expect(s.y).toBeCloseTo(100, 3);
    expect(s.h).toBeCloseTo(0.5, 3);
  });

  it('rt раніше найстарішого → перший; пізніше найновішого → останній (freeze)', () => {
    expect(interpAt(buf, 500).x).toBe(0);
    expect(interpAt(buf, 9999).x).toBe(1000);
  });

  it('порожній буфер → null', () => {
    expect(interpAt([], 1)).toBeNull();
    expect(interpAt(null, 1)).toBeNull();
  });

  it('lerpAngle йде НАЙКОРОТШОЮ дугою через ±π (не прокручує назад)', () => {
    // від 3.0 до −3.0 короткий шлях — уперед через π (Δ≈+0.283), а не назад через 0 (Δ≈−6)
    const r = lerpAngle(3.0, -3.0, 0.5);
    expect(Math.abs(r)).toBeGreaterThan(3.0); // опинилися біля ±π, а не біля 0
  });

  it('lerp базовий', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });
});
