// Printed labels are evidence only. Never derive a usable scale from them.
export const SCALE_GATE_VERSION='2026-09-05-v1';
export const SCALE_TOLERANCE=0.005;
export function checkScale(g){
 const fail=message=>{throw new Error('SCALE_GATE_BLOCKED: '+message);};
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
 if(!g||!Array.isArray(g.viewport)||g.viewport.length!==4||!g.viewport.every(Number.isFinite))fail('Viewport bounds required');
 const [x0,y0,x1,y1]=g.viewport;
 if(x1<=x0||y1<=y0)fail('Invalid viewport');
 const inside=p=>point(p)&&p[0]>=x0&&p[0]<=x1&&p[1]>=y0&&p[1]<=y1;
 if(g.notToScale!==false||!Array.isArray(g.anchors)||g.anchors.length<2)fail('Two known dimensions required; NTS prohibited');
 const anchors=g.anchors.map(a=>{
  if(!Array.isArray(a.points)||a.points.length!==2||!a.points.every(inside)||!Number.isFinite(a.knownFeet)||a.knownFeet<=0||typeof a.label!=='string'||!a.label.trim())fail('Invalid known dimension');
  const dx=a.points[1][0]-a.points[0][0],dy=a.points[1][1]-a.points[0][1],length=Math.hypot(dx,dy);
  if(length<=0)fail('Zero dimension length');
  return {ratio:a.knownFeet/length,direction:[dx/length,dy/length],key:a.points.map(p=>p.join(',')).sort().join(';')};
 });
 if(new Set(anchors.map(a=>a.key)).size!==anchors.length)fail('Independent dimension checks required; duplicate anchor');
 // Require approximately perpendicular checks, not two nearly parallel lines.
 if(!anchors.some((a,i)=>anchors.slice(i+1).some(b=>Math.abs(a.direction[0]*b.direction[1]-a.direction[1]*b.direction[0])>=0.95)))fail('Scale checks must span two directions, approximately perpendicular');
 const ratios=anchors.map(a=>a.ratio),min=Math.min(...ratios),max=Math.max(...ratios);
 if(!Number.isFinite(max)||min<=0)fail('Invalid calibration ratio');
 const disagreement=max/min-1;
 if(disagreement>SCALE_TOLERANCE)fail('Scale cross-check differs by more than 0.5 percent; resolve distortion or mixed scales');
 return {version:SCALE_GATE_VERSION,status:'GEOMETRY_CHECK_PASSED_SOURCE_REVIEW_REQUIRED',feetPerPdfPoint:ratios[0],relativeDisagreement:disagreement,tolerance:SCALE_TOLERANCE,viewport:g.viewport,anchors:g.anchors,coordinateSystem:'PDF_POINTS_LOWER_LEFT',printedScaleTrusted:false};
}
