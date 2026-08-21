import { describe, it, expect } from 'vitest';
import { esc } from '../src/core/dom.js';
import { car, resetCar, state, input } from '../src/core/state.js';

describe('esc (захист від XSS з мережі)', () => {
  it('екранує кутові дужки', () => {
    expect(esc('<img onerror=x>')).toBe('&lt;img onerror=x&gt;');
  });
  it('екранує лапки й амперсанд', () => {
    expect(esc(`"&'`)).toBe('&quot;&amp;&#39;');
  });
  it('лишає звичайний текст (кирилиця)', () => {
    expect(esc('Мурчик 🐱')).toBe('Мурчик 🐱');
  });
});

describe('state / resetCar', () => {
  it('дефолти стану', () => {
    expect(state.money).toBe(900);
    expect(state.fuel).toBe(5);
    expect(state.phase).toBe('menu');
    expect(input.gas).toBe(false);
  });
  it('resetCar замінює поля (старі зникають)', () => {
    car.someOld = 1;
    resetCar({ x: 5, y: 0, mode: 'auto' });
    expect(car.x).toBe(5);
    expect(car.mode).toBe('auto');
    expect(car.someOld).toBeUndefined();
  });
});
