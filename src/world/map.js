// ================= КАРТА =================
import { CFG } from '../core/config.js';

if(typeof L==='undefined'){
  try{ var _ln=document.getElementById('loadNote'); if(_ln) _ln.textContent='Не вдалось завантажити карту (перевір інтернет).'; }catch(e){}
  throw new Error('no leaflet');
}
const canvasR = L.canvas({ padding: 0.4 });
export const map = L.map('map', { center: CFG.center, zoom: CFG.zoom, zoomControl:false, attributionControl:false,
  dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false,
  touchZoom:false, inertia:false, zoomSnap:0, renderer: canvasR });
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  { maxZoom: CFG.zoom, maxNativeZoom: 19, subdomains:'abcd' }).addTo(map);

/** Відстань між двома точками (м) через Leaflet. */
export function dist(aLat,aLng,bLat,bLng){ return map.distance([aLat,aLng],[bLat,bLng]); }
