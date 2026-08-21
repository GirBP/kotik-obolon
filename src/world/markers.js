// ================= МАРКЕРИ POI =================
/** L.divIcon-пін для POI (клас визначає колір у CSS). Використовує глобальний L (CDN). */
export function poiIcon(cls,emoji){ return L.divIcon({ className:'', iconSize:[30,30], iconAnchor:[15,30],
  html:`<div class="poi ${cls}"><span>${emoji}</span></div>` }); }
