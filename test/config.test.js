import { describe, it, expect } from 'vitest';
import { torqueCurve, ENG, GEARS_M, CFG } from '../src/core/config.js';

describe('torqueCurve (крива крутного моменту)', () => {
  it('пік близько 3500 об/хв', () => {
    expect(torqueCurve(3500)).toBe(1.0);
    expect(torqueCurve(3500)).toBeGreaterThan(torqueCurve(800));
    expect(torqueCurve(3500)).toBeGreaterThan(torqueCurve(6000));
  });
  it('0 на паливному відсіканні', () => {
    expect(torqueCurve(6500)).toBe(0);
  });
  it('нижче холостого = стартове значення', () => {
    expect(torqueCurve(400)).toBe(0.5);
  });
  it('монотонно зростає до піку', () => {
    expect(torqueCurve(2000)).toBeGreaterThan(torqueCurve(800));
    expect(torqueCurve(3500)).toBeGreaterThan(torqueCurve(2000));
  });
});

describe('константи КПП/економіки', () => {
  it('редлайн вище холостого', () => expect(ENG.redline).toBeGreaterThan(ENG.idle));
  it('передачі R і 5 задані', () => {
    expect(GEARS_M['-1']).toBeLessThan(0);
    expect(GEARS_M['5']).toBeGreaterThan(0);
  });
  it('старт: 5 л / 900 грн, бак 50 л', () => {
    expect(CFG.startFuel).toBe(5);
    expect(CFG.startMoney).toBe(900);
    expect(CFG.tank).toBe(50);
  });
});
