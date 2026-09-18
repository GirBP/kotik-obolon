// ================= ФІЗИКА КОРОБКИ ПЕРЕДАЧ (чиста частина) =================
// Без DOM, звуку й сповіщень — лише розрахунок над об'єктом car. Побічні ефекти
// (toast, SFX, fmEvent) викликає тонка обгортка в systems/drivetrain.js, яка
// читає прапорці/причини, що повертають ці функції.

/**
 * Один крок фізики трансмісії за dt секунд. Мутує car (speed/rpm/gear/gearDisp/stallT/engineRunning).
 * @param {object} car - стан авто
 * @param {{gas:boolean, brake:boolean}} input - поточний ввід газу/гальма
 * @param {number} dt - крок часу, с
 * @param {{CFG:object, ENG:object, GEARS_M:object, torqueCurve:Function, grip:number, hasFuel:boolean}} opts
 * @returns {{stalled:boolean}} stalled=true, якщо двигун заглух саме цим викликом
 */
export function updateDrivetrainPure(car, input, dt, opts){
  const { CFG, ENG, GEARS_M, torqueCurve, grip, hasFuel } = opts;
  const running = car.engineRunning && hasFuel;
  const throttle = (input.gas && running) ? 1 : 0;
  if(car.mode!=='manual'){
    // АВТОМАТ — аркадна модель, без глохнення
    if(running){ if(input.gas) car.speed+=CFG.accel*dt; else if(input.brake) car.speed-=CFG.brake*grip*dt; else car.speed-=CFG.friction*dt; }
    else { if(input.brake) car.speed-=CFG.brake*grip*dt; else car.speed-=CFG.friction*dt; }
    car.speed=Math.max(0,Math.min(CFG.maxSpeed,car.speed)); car.gearDisp='D';
    return { stalled:false };
  }
  // МЕХАНІКА
  const comb=GEARS_M[String(car.gear)]||0;
  const engaged = car.engineRunning ? (car.gear!==0 ? (1-car.clutch) : 0) : 0;
  const freeTarget = ENG.idle + throttle*(ENG.redline-ENG.idle);
  const wheelRPM = Math.abs(car.speed)*Math.abs(comb)*ENG.KFAC;
  const rpmTarget = freeTarget*(1-engaged) + wheelRPM*engaged;
  car.rpm += (rpmTarget-car.rpm)*(rpmTarget>car.rpm?ENG.revUp:ENG.revDown)*dt;
  car.rpm = Math.max(0, Math.min(ENG.fuelcut, car.rpm));
  if(!car.engineRunning) car.rpm=0;
  let engineForce=0;
  if(car.engineRunning && engaged>0 && car.gear!==0 && hasFuel)
    engineForce = torqueCurve(car.rpm)*throttle*Math.abs(comb)*ENG.forceK*engaged*Math.sign(comb);
  const brakeForce=(input.brake?1:0)*ENG.brakeN*grip;
  const drag=ENG.dragA*car.speed*Math.abs(car.speed)+ENG.roll*Math.sign(car.speed);
  const accel=(engineForce - brakeForce*Math.sign(car.speed) - drag)/ENG.mass;
  car.speed += accel*dt*3.6;
  const minS = car.gear===-1? -CFG.maxSpeed*0.4 : 0;
  car.speed = Math.max(minS, Math.min(CFG.maxSpeed, car.speed));
  let stalled=false;
  if(car.engineRunning && engaged>0.5 && car.rpm<ENG.stall){ car.stallT=(car.stallT||0)+dt;
    if(car.stallT>ENG.stallGrace){ car.engineRunning=false; car.rpm=0; car.speed*=0.6; stalled=true; } }
  else car.stallT=0;
  car.gearDisp = car.gear===-1?'R':(car.gear===0?'N':String(car.gear));
  return { stalled };
}

/**
 * Спроба перемкнути передачу. Мутує car.gear лише коли дозволено.
 * @returns {{ok:boolean, reason?:'auto'|'clutch', gear?:number}}
 */
export function shiftGearPure(car, delta){
  if(car.mode!=='manual') return { ok:false, reason:'auto' };
  if(car.clutch<0.7) return { ok:false, reason:'clutch' };
  car.gear=Math.max(-1,Math.min(5, car.gear+delta));
  return { ok:true, gear:car.gear };
}

/**
 * Спроба завести двигун. Мутує car.engineRunning/car.rpm лише коли дозволено.
 * @returns {{ok:boolean, reason?:'already'|'clutch'}}
 */
export function startEnginePure(car, ENG){
  if(car.engineRunning) return { ok:false, reason:'already' };
  if(car.mode==='manual' && car.clutch<0.7 && car.gear!==0) return { ok:false, reason:'clutch' };
  car.engineRunning=true; car.rpm=ENG.idle;
  return { ok:true };
}
