// ================= POI (АЗС / храми / Сенс) =================
import { CFG, BRAND_PRICE, LPG_PRICE } from '../core/config.js';
import { toXY } from '../core/geo.js';
import { map } from './map.js';
import { poiIcon } from './markers.js';
import { nearestRoad } from './roads.js';
import { state, stations, fuelMarks, churchMarks } from '../core/state.js';

export function addPOIs(pois){
  pois.fuel.forEach(f=>{ const price=BRAND_PRICE[f.name]||74.0;
    stations.push({...f, a95:price, lpg:LPG_PRICE});
    fuelMarks.push(L.marker([f.lat,f.lng],{icon:poiIcon('fuel','⛽')}).addTo(map)); });
  pois.churches.forEach(c=>{
    // персональний радіус: храм може стояти в глибині кварталу — рахуємо від найближчої дороги
    const xy=toXY(c.lat,c.lng); const nr=nearestRoad(xy.x,xy.y);
    const r=Math.max(CFG.radioR, (nr?nr.dist:0)+30);
    churchMarks.push({...c, r,
    mk:L.marker([c.lat,c.lng],{icon:poiIcon('church','⛪')}).addTo(map)}); });
  if(pois.sens){ state.sensPoi=pois.sens;
    L.marker([state.sensPoi.lat,state.sensPoi.lng],{icon:poiIcon('sens','📚')}).addTo(map); }
}
