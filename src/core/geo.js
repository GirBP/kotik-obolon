// ================= ГЕО-ХЕЛПЕРИ (equirectangular XY) =================
// Локальна пласка проєкція навколо центру Оболоні — швидка й достатньо точна
// для масштабу району. Чисті функції.
import { CFG } from './config.js';

const ORG = { lat: CFG.center[0], lng: CFG.center[1] };
const MLAT = 111320;
const MLNG = 111320 * Math.cos((ORG.lat * Math.PI) / 180);

export const toXY = (lat, lng) => ({ x: (lng - ORG.lng) * MLNG, y: (lat - ORG.lat) * MLAT });
export const fromXY = (x, y) => ({ lat: ORG.lat + y / MLAT, lng: ORG.lng + x / MLNG });
