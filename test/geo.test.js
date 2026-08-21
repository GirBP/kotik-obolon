import { describe, it, expect } from 'vitest';
import { toXY, fromXY } from '../src/core/geo.js';

describe('geo (проєкція)', () => {
  it('центр Оболоні ≈ початок координат', () => {
    const p = toXY(50.5085, 30.503);
    expect(Math.abs(p.x)).toBeLessThan(1);
    expect(Math.abs(p.y)).toBeLessThan(1);
  });
  it('roundtrip toXY→fromXY зберігає координати', () => {
    const ll = { lat: 50.515, lng: 30.51 };
    const xy = toXY(ll.lat, ll.lng);
    const back = fromXY(xy.x, xy.y);
    expect(back.lat).toBeCloseTo(ll.lat, 6);
    expect(back.lng).toBeCloseTo(ll.lng, 6);
  });
  it('північ = +y, схід = +x', () => {
    expect(toXY(50.52, 30.503).y).toBeGreaterThan(0);
    expect(toXY(50.5085, 30.52).x).toBeGreaterThan(0);
  });
  it('масштаб реалістичний (~1 км по широті)', () => {
    const p = toXY(50.5085 + 0.009, 30.503); // ~0.009° ≈ 1 км
    expect(p.y).toBeGreaterThan(900);
    expect(p.y).toBeLessThan(1100);
  });
});
