import { CFG, ENG, GEARS_M, torqueCurve } from '../core/config.js';
import { toast } from '../core/dom.js';
import { car, input, state } from '../core/state.js';
import { updateDrivetrainPure, shiftGearPure, startEnginePure } from '../core/drivetrain.js';
import { fmEvent } from './fm.js';

// Тонка обгортка над чистою фізикою КПП (core/drivetrain.js): та сама рахує
// car.speed/rpm/gear, ця — лише додає toast/SFX/fmEvent за результатом.
export function updateDrivetrain(dt){
  const grip = window.LIVE ? window.LIVE.grip : 1;
  const { stalled } = updateDrivetrainPure(car, input, dt, { CFG, ENG, GEARS_M, torqueCurve, grip, hasFuel: state.fuel>0 });
  if(stalled){ toast('💥 Двигун заглух! Вижми зчеплення і заведи (🔑).'); fmEvent('stall'); }
}

export function shiftGear(delta){
  const r = shiftGearPure(car, delta);
  if(!r.ok){
    if(r.reason==='clutch') toast('Вижми зчеплення, щоб перемкнути передачу');
    return;
  }
  toast('Передача: '+(r.gear===-1?'R':r.gear===0?'N':r.gear));
}

export function startEngine(){
  const r = startEnginePure(car, ENG);
  if(!r.ok){
    if(r.reason==='clutch') toast('Вижми зчеплення, щоб завести');
    return;
  }
  window.SFX&&window.SFX.play('engine_start'); toast('🔑 Двигун заведено');
}
