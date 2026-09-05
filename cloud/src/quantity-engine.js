import {checkScale} from './scale-gate.js';

export function calculateQuantity(unit,g){
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
 if(!g||!Array.isArray(g.points)||!g.points.length||g.points.some(p=>!point(p)))throw new Error('Trace coordinates required');
 if(!Array.isArray(g.viewport)||g.viewport.length!==4||!g.viewport.every(Number.isFinite))throw new Error('Viewport bounds required');
 const [x0,y0,x1,y1]=g.viewport;if(x1<=x0||y1<=y0)throw new Error('Invalid viewport');
 const inside=p=>p[0]>=x0&&p[0]<=x1&&p[1]>=y0&&p[1]<=y1;
 if(g.points.some(p=>!inside(p)))throw new Error('Trace outside calibrated viewport');
 if(unit==='EA'){if(new Set(g.points.map(p=>p.join(','))).size!==g.points.length)throw new Error('Duplicate count markers');return g.points.length;}
 const scale=checkScale(g).feetPerPdfPoint;
 if(unit==='LF'){if(g.points.length<2)throw new Error('Length needs two points');return g.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-g.points[i][0],p[1]-g.points[i][1])*scale,0);}
 if(!['SF','CY'].includes(unit)||g.points.length<3||g.closed!==true)throw new Error('Area requires a closed polygon');
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(let i=0;i<g.points.length;i++)for(let j=i+2;j<g.points.length;j++){if(i===0&&j===g.points.length-1)continue;const a=g.points[i],b=g.points[(i+1)%g.points.length],c=g.points[j],d=g.points[(j+1)%g.points.length];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)throw new Error('Self-intersecting polygon');}
 let area=0;for(let i=0;i<g.points.length;i++){const a=g.points[i],b=g.points[(i+1)%g.points.length];area+=a[0]*b[1]-b[0]*a[1];}area=Math.abs(area)/2*scale**2;
 if(area<=0)throw new Error('Zero polygon area');
 if(unit==='CY'){if(!Number.isFinite(g.depthFeet)||g.depthFeet<=0)throw new Error('Verified depth in feet required');return area*g.depthFeet/27;}
 return area;
}
