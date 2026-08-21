// ================= ДОРОГИ (сегменти + сітка + розмітка + снапінг) =================
import { GRID } from '../core/config.js';
import { toXY } from '../core/geo.js';
import { segments, grid } from '../core/state.js';

export function buildRoads(roads){
  const markings=[];
  roads.forEach(line=>{ const g=line.g;
    const lanes=line.l||1, oneway=line.o||0, cls=line.h||'service';
    const ptsXY=g.map(p=>toXY(p[0],p[1]));
    for(let i=0;i<g.length-1;i++){
      const A=ptsXY[i], B=ptsXY[i+1];
      const dx=B.x-A.x, dy=B.y-A.y, len2=dx*dx+dy*dy;
      if(len2<0.5) continue;
      const s={ ax:A.x,ay:A.y,dx,dy,len2, name:line.n||'', l:lanes, o:oneway, svc: cls==='service'?1:0 };
      const idx=segments.push(s)-1;
      const x0=Math.min(A.x,B.x), x1=Math.max(A.x,B.x), y0=Math.min(A.y,B.y), y1=Math.max(A.y,B.y);
      for(let cx=Math.floor(x0/GRID);cx<=Math.floor(x1/GRID);cx++)
        for(let cy=Math.floor(y0/GRID);cy<=Math.floor(y1/GRID);cy++){
          const k=cx+','+cy; if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(idx);
        }
    }
    // розмітка — лише на класифікованих дорогах (у дворах її нема)
    if(cls!=='service' && cls!=='living_street' && ptsXY.length>1){
      markings.push({pts:ptsXY, lanes, oneway});
    }
  });
  // Розмітку малює scenery.js усередині тайлів власного світу (кешується + знає тему).
  // Якщо власний світ не завантажиться — лишаються тайли CARTO з власною розміткою,
  // тож окремий полілінійний шар більше не потрібен у жодному зі сценаріїв.
  void markings;
}

// зміщення полілінії на d метрів праворуч від напряму (усереднені нормалі)
export function nearestRoad(x,y,stickyName){
  // score = відстань + штраф двору − бонус «тієї самої вулиці»:
  // великі дороги не втрачаються через паралельні проїзди, але у двір заїхати можна.
  const cx=Math.floor(x/GRID), cy=Math.floor(y/GRID);
  let best=null, bs=Infinity;
  for(let R=1; R<=6; R++){
    for(let i=-R;i<=R;i++) for(let j=-R;j<=R;j++){
      const arr=grid.get((cx+i)+','+(cy+j)); if(!arr) continue;
      for(const idx of arr){ const s=segments[idx];
        let t=((x-s.ax)*s.dx+(y-s.ay)*s.dy)/s.len2; t=Math.max(0,Math.min(1,t));
        const px=s.ax+t*s.dx, py=s.ay+t*s.dy;
        const d=Math.sqrt((x-px)*(x-px)+(y-py)*(y-py));
        let score=d + (s.svc?9:0);
        if(stickyName && s.name && s.name===stickyName) score-=7;
        if(score<bs){ bs=score; best={px,py,dist:d,ang:Math.atan2(s.dx,s.dy),name:s.name,l:s.l||1,o:s.o||0,svc:s.svc||0}; }
      }}
    if(best) break;
  }
  return best;
}
