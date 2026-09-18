import { describe, it, expect } from 'vitest';
import { updateDrivetrainPure, shiftGearPure, startEnginePure } from '../src/core/drivetrain.js';
import { CFG, ENG, GEARS_M, torqueCurve } from '../src/core/config.js';

function makeCar(fields){
  return Object.assign({
    speed:0, rpm:0, gear:1, clutch:0, mode:'manual',
    engineRunning:true, gearDisp:'1', stallT:0,
  }, fields);
}
const opts = { CFG, ENG, GEARS_M, torqueCurve, grip:1, hasFuel:true };

describe('updateDrivetrainPure — рушання', () => {
  it('з опущеним зчепленням і газом авто розганяється (механіка)', () => {
    const car = makeCar({ clutch:0, gear:1, rpm:ENG.idle });
    const input = { gas:true, brake:false };
    for(let i=0;i<60;i++) updateDrivetrainPure(car, input, 1/60, opts);
    expect(car.speed).toBeGreaterThan(0);
  });
  it('автомат розганяється без глохнення', () => {
    const car = makeCar({ mode:'auto', clutch:1 });
    const input = { gas:true, brake:false };
    for(let i=0;i<60;i++) updateDrivetrainPure(car, input, 1/60, opts);
    expect(car.speed).toBeGreaterThan(0);
    expect(car.gearDisp).toBe('D');
  });
  it('без палива не розганяється', () => {
    const car = makeCar({ clutch:0, gear:1, rpm:ENG.idle });
    const input = { gas:true, brake:false };
    const noFuel = { ...opts, hasFuel:false };
    for(let i=0;i<30;i++) updateDrivetrainPure(car, input, 1/60, noFuel);
    expect(car.speed).toBe(0);
  });
});

describe('updateDrivetrainPure — глохне двигун', () => {
  it('різко відпущене зчеплення на 1-й передачі без обертів — двигун глохне', () => {
    const car = makeCar({ clutch:0, gear:1, rpm:ENG.idle, speed:0 });
    const input = { gas:false, brake:false };
    let stalled=false;
    for(let i=0;i<120 && !stalled; i++){
      const r = updateDrivetrainPure(car, input, 1/60, opts);
      stalled = r.stalled;
    }
    expect(stalled).toBe(true);
    expect(car.engineRunning).toBe(false);
  });
  it('з газом і плавним зчепленням двигун не глохне', () => {
    const car = makeCar({ clutch:1, gear:1, rpm:ENG.idle, speed:0 });
    const input = { gas:true, brake:false };
    let stalled=false;
    for(let i=0;i<120;i++){
      car.clutch = Math.max(0, car.clutch - 1/60); // плавно відпускаємо за секунду
      const r = updateDrivetrainPure(car, input, 1/60, opts);
      if(r.stalled) stalled=true;
    }
    expect(stalled).toBe(false);
    expect(car.engineRunning).toBe(true);
  });
  it('нейтраль не глохне навіть з відпущеним зчепленням', () => {
    const car = makeCar({ clutch:0, gear:0, rpm:ENG.idle, speed:0 });
    const input = { gas:false, brake:false };
    let stalled=false;
    for(let i=0;i<120;i++){
      const r = updateDrivetrainPure(car, input, 1/60, opts);
      if(r.stalled) stalled=true;
    }
    expect(stalled).toBe(false);
    expect(car.engineRunning).toBe(true);
  });
});

describe('shiftGearPure — перемикання', () => {
  it('з вижатим зчепленням дозволяє перемкнути вгору', () => {
    const car = makeCar({ clutch:1, gear:1 });
    const r = shiftGearPure(car, 1);
    expect(r.ok).toBe(true);
    expect(car.gear).toBe(2);
  });
  it('без вижатого зчеплення відмовляє', () => {
    const car = makeCar({ clutch:0, gear:1 });
    const r = shiftGearPure(car, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('clutch');
    expect(car.gear).toBe(1); // не змінилась
  });
  it('на автоматі відмовляє', () => {
    const car = makeCar({ mode:'auto', clutch:1, gear:1 });
    const r = shiftGearPure(car, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('auto');
  });
  it('не виходить за межі R..5', () => {
    const car = makeCar({ clutch:1, gear:5 });
    shiftGearPure(car, 1);
    expect(car.gear).toBe(5);
    car.gear=-1;
    shiftGearPure(car, -1);
    expect(car.gear).toBe(-1);
  });
});

describe('startEnginePure — старт двигуна', () => {
  it('заводить непрацюючий двигун на нейтралі', () => {
    const car = makeCar({ engineRunning:false, gear:0, clutch:0, rpm:0 });
    const r = startEnginePure(car, ENG);
    expect(r.ok).toBe(true);
    expect(car.engineRunning).toBe(true);
    expect(car.rpm).toBe(ENG.idle);
  });
  it('на механіці з увімкненою передачею і без зчеплення — відмовляє', () => {
    const car = makeCar({ engineRunning:false, gear:1, clutch:0, rpm:0 });
    const r = startEnginePure(car, ENG);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('clutch');
    expect(car.engineRunning).toBe(false);
  });
  it('якщо двигун вже працює — нічого не робить', () => {
    const car = makeCar({ engineRunning:true, rpm:3000 });
    const r = startEnginePure(car, ENG);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('already');
    expect(car.rpm).toBe(3000); // не скинуто
  });
});
