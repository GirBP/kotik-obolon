// ================= ДОРОГИ (сегменти + сітка + розмітка + снапінг) =================
import { CFG, GRID } from '../core/config.js';
import { toXY, fromXY } from '../core/geo.js';
import { map } from './map.js';
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
  drawMarkings(markings);
}

// зміщення полілінії на d метрів праворуч від напряму (усереднені нормалі)
function offsetLine(pts, d){
  const out=[];
  for(let i=0;i<pts.length;i++){
    const p0=pts[Math.max(0,i-1)], p1=pts[Math.min(pts.length-1,i+1)];
    let nx=p1.y-p0.y, ny=-(p1.x-p0.x);
    const L=Math.hypot(nx,ny)||1; nx/=L; ny/=L;
    out.push(fromXY(pts[i].x+nx*d, pts[i].y+ny*d));
  }
  return out.map(p=>[p.lat,p.lng]);
}
function drawMarkings(ways){
  const layer=L.layerGroup();
  const W=CFG.laneW;
  ways.forEach(w=>{
    const latlngs=w.pts.map(p=>{ const q=fromXY(p.x,p.y); return [q.lat,q.lng]; });
    if(w.oneway){
      // односмугова стрічка: роздільники між смугами, по центру ширини
      for(let k=1;k<w.lanes;k++){
        const off=(k - w.lanes/2)*W;
        L.polyline(offsetLine(w.pts,off), {color:'#fff', weight:1.3, opacity:.85, dashArray:'7,11', interactive:false}).addTo(layer);
      }
    } else {
      // осьова: суцільна (широкі) або переривчаста (вузькі)
      if(w.lanes>=2)
        L.polyline(latlngs, {color:'#fff', weight:2.2, opacity:.95, interactive:false}).addTo(layer);
      else
        L.polyline(latlngs, {color:'#fff', weight:1.4, opacity:.8, dashArray:'9,13', interactive:false}).addTo(layer);
      // роздільники смуг у кожному напрямку
      for(let k=1;k<w.lanes;k++){
        for(const sgn of [1,-1]){
          L.polyline(offsetLine(w.pts, sgn*k*W), {color:'#fff', weight:1.2, opacity:.75, dashArray:'7,11', interactive:false}).addTo(layer);
        }
      }
    }
  });
  layer.addTo(map);
}
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
