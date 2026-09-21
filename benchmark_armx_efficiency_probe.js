// Probe cheap candidate metadata against the saved current-ARMX golden moves.
const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
const files=[
  'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js','Stonefish_v4_5_balance_patch.js',
  'Stonefish_v5.js','Stonefish_v5_pro.js','Stonefish_v5_pro_speed_patch.js','Stonefish_v5_pro_geometry_patch.js',
  'Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js','Stonefish_v5_5_search.js',
  'Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js'
];
vm.runInThisContext(files.map(f=>fs.readFileSync(f,'utf8')).join('\n\n'));
const golden=JSON.parse(zlib.gunzipSync(fs.readFileSync('benchmarks/v5_5/evidence-effort-golden.json.gz')));
const moveUci=m=>m?stonefishV45RawUci(new Chess(),m):null;
function playHistory(history){
 const g=new Chess();
 for(const uci of history){
  const m=g.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'});
  if(!m)throw Error('bad history '+uci);
 }
 return g;
}
const rows=[];
for(let i=0;i<golden.positions.length;i++){
 const row=golden.positions[i],g=playHistory(row.history);
 g.armxObservationStartPly=row.observationStartPly;
 const scored=stonefishV55Testunit1ScoreAllMoves(g);
 const meta=stonefishV55Testunit1LastARMX()||{};
 const low=scored[0]&&scored[0].uci;
 const current=row.armx&&row.armx.entries&&row.armx.entries[0]&&row.armx.entries[0].uci;
 const reports=Array.isArray(meta.reports)?meta.reports:[];
 const provisional=reports.find(r=>r&&meta.provisionalRaw&&stonefishV5SameMove(r.raw,meta.provisionalRaw));
 const proposed=meta.proposedRaw&&reports.find(r=>r&&stonefishV5SameMove(r.raw,meta.proposedRaw));
 rows.push({
  i,match:low===current,low,current,
  gap:Number.isFinite(meta.hostScoreGap)?meta.hostScoreGap:null,
  obs:meta.replyPolicyObservations||0,
  applied:!!meta.adaptationApplied,rejected:!!meta.adaptationRejected,override:!!meta.override,
  reason:meta.rejectionReason||null,
  pSig:provisional?Number(provisional.signal)||0:null,
  cSig:proposed?Number(proposed.signal)||0:null,
  pEv:provisional?Number(provisional.evidence)||0:null,
  cEv:proposed?Number(proposed.evidence)||0:null,
  pConf:provisional?Number(provisional.confidence)||0:null,
  cConf:proposed?Number(proposed.confidence)||0:null,
 });
}
const diffs=rows.filter(r=>!r.match),same=rows.filter(r=>r.match);
function quantile(arr,q){
 const a=arr.filter(Number.isFinite).slice().sort((x,y)=>x-y);
 if(!a.length)return null;return a[Math.min(a.length-1,Math.floor((a.length-1)*q))];
}
function summary(set){
 const gaps=set.map(r=>r.gap),obs=set.map(r=>r.obs);
 return {n:set.length,gapQ:[.1,.25,.5,.75,.9].map(q=>quantile(gaps,q)),
   obsQ:[.1,.25,.5,.75,.9].map(q=>quantile(obs,q)),
   overrides:set.filter(r=>r.override).length,rejected:set.filter(r=>r.rejected).length,
   reasons:Object.fromEntries([...new Set(set.map(r=>r.reason).filter(Boolean))].map(x=>[x,set.filter(r=>r.reason===x).length]))};
}
const thresholds=[0,2,4,6,8,10,15,20,30,40,60,100];
const gapCoverage=thresholds.map(t=>{
 const selected=rows.filter(r=>Number.isFinite(r.gap)&&r.gap<=t);
 const selectedDiff=selected.filter(r=>!r.match).length;
 return {gapLE:t,selected:selected.length,selectedPct:selected.length/rows.length,
  diffCovered:selectedDiff,diffCoverage:diffs.length?selectedDiff/diffs.length:1};
});
console.log('ARMX_EFF_PROBE '+JSON.stringify({all:summary(rows),same:summary(same),diff:summary(diffs),gapCoverage,diffs:diffs.slice(0,80)}));
