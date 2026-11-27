const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const files = [
  'StonefishChess.js','models/v1.js','models/v2.js','models/v3.js','models/v4.js',
  'models/v4_5.js','models/v5.js','models/v5_pro.js','models/v5_5.js',
  'models/v6.js','models/v6_1.js','ARMX/ARMX-preview.js','ARMX/ARMX.js','ARMX/ARMX_1_1.js'
];
vm.runInThisContext(files.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v6_1-benchmark-bundle.js'
});
const options = { maxDepth: 5, maxTimeMs: 15000, softNodes: 2500000, hardNodes: 4000000 };
const positions = [
  ['Opening', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['Middlegame', 'r2q1rk1/pp2bppp/2n1pn2/2bp4/3P4/2NBPN2/PPP2PPP/R1BQ1RK1 w - - 0 9'],
  ['Tactical', 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 2 8'],
  ['Endgame', '8/5pk1/6p1/3R4/8/4K3/5PP1/8 w - - 0 1']
];
function median(values) { const sorted=values.slice().sort((a,b)=>a-b); return sorted[Math.floor(sorted.length/2)]; }
function play(fn,key,fen) {
  const game=new Chess(fen), start=performance.now(), move=fn(game,options), wallMs=performance.now()-start;
  const info=globalThis[key]; if(!move||!info)throw new Error(`No ${key} search result for ${fen}`);
  return { move:`${move.from}${move.to}${move.promotion||''}`,wallMs,ms:info.ms,nodes:info.nodes,depth:info.depth,
    cacheHits:info.evalCacheHits||0,cacheMisses:info.evalCacheMisses||0 };
}
const results=[];
for(const [name,fen] of positions){
  for(let i=0;i<2;i++){play(getStonefishV6Move,'SF6_LAST_SEARCH',fen);play(getStonefishV61Move,'SF61_LAST_SEARCH',fen);}
  const a=[],b=[];
  for(let i=0;i<5;i++){a.push(play(getStonefishV6Move,'SF6_LAST_SEARCH',fen));b.push(play(getStonefishV61Move,'SF61_LAST_SEARCH',fen));}
  const v6Ms=median(a.map(x=>x.ms)),v61Ms=median(b.map(x=>x.ms));
  results.push({position:name,depthV6:median(a.map(x=>x.depth)),depthV61:median(b.map(x=>x.depth)),
    v6MedianMs:Number(v6Ms.toFixed(2)),v61MedianMs:Number(v61Ms.toFixed(2)),
    speedRatio:Number((v6Ms/Math.max(.001,v61Ms)).toFixed(3)),
    v6MedianNodes:median(a.map(x=>x.nodes)),v61MedianNodes:median(b.map(x=>x.nodes)),
    v61MedianEvalCacheHits:median(b.map(x=>x.cacheHits)),v61MedianEvalCacheMisses:median(b.map(x=>x.cacheMisses)),
    sameMoveRate:b.filter((x,i)=>x.move===a[i].move).length/5});
}
console.log(JSON.stringify({suite:'StoneFish v6.1 fixed-depth benchmark',options,results},null,2));
if(results.some(r=>r.depthV6!==r.depthV61))process.exitCode=1;
