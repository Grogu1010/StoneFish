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
const options = { maxDepth: 7, maxTimeMs: 20000, softNodes: 5000000, hardNodes: 8000000, rootWidth: 8 };
function historicalMiddlegame() {
  const game = new Chess();
  for (let ply=0; ply<32; ply++) {
    const moves = game.fastMoves();
    if (!moves.length) throw new Error(`Could not construct benchmark history at ply ${ply}`);
    const raw = moves[(ply * 29 + 5) % moves.length];
    game._applyRaw(raw, true);
  }
  return game;
}
const positions = [
  ['Opening', () => new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')],
  ['Middlegame', () => new Chess('r2q1rk1/pp2bppp/2n1pn2/2bp4/3P4/2NBPN2/PPP2PPP/R1BQ1RK1 w - - 0 9')],
  ['Tactical', () => new Chess('r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 2 8')],
  ['Endgame', () => new Chess('8/5pk1/6p1/3R4/8/4K3/5PP1/8 w - - 0 1')],
  ['Middlegame with 32-ply history', historicalMiddlegame]
];
function median(values) { const sorted=values.slice().sort((a,b)=>a-b); return sorted[Math.floor(sorted.length/2)]; }
function play(fn,key,makeGame,clearEvalCache=false) {
  const game=makeGame();
  if (clearEvalCache && key === 'SF61_LAST_SEARCH') stonefishV61ClearEvalCache();
  const start=performance.now(), move=fn(game,options), wallMs=performance.now()-start;
  const info=globalThis[key]; if(!move||!info)throw new Error(`No ${key} search result for ${game.fen()}`);
  return { move:`${move.from}${move.to}${move.promotion||''}`,wallMs,ms:info.ms,nodes:info.nodes,depth:info.depth,
    cacheHits:info.evalCacheHits||0,cacheMisses:info.evalCacheMisses||0 };
}
const results=[];
for(const [name,makeGame] of positions){
  for(let i=0;i<2;i++){
    play(getStonefishV6Move,'SF6_LAST_SEARCH',makeGame);
    play(getStonefishV61Move,'SF61_LAST_SEARCH',makeGame);
  }
  const a=[],b=[];
  for(let i=0;i<15;i++){
    if(i&1){
      b.push(play(getStonefishV61Move,'SF61_LAST_SEARCH',makeGame,true));
      a.push(play(getStonefishV6Move,'SF6_LAST_SEARCH',makeGame));
    } else {
      a.push(play(getStonefishV6Move,'SF6_LAST_SEARCH',makeGame));
      // Clear 6.1's evaluation cache before each timed sample. This measures
      // transposition reuse within a single search, not a warmed repeated position.
      b.push(play(getStonefishV61Move,'SF61_LAST_SEARCH',makeGame,true));
    }
  }
  const v6Ms=median(a.map(x=>x.ms)),v61Ms=median(b.map(x=>x.ms));
  results.push({position:name,depthV6:median(a.map(x=>x.depth)),depthV61:median(b.map(x=>x.depth)),
    v6MedianMs:Number(v6Ms.toFixed(2)),v61MedianMs:Number(v61Ms.toFixed(2)),
    speedRatio:Number((v6Ms/Math.max(.001,v61Ms)).toFixed(3)),
    v6MedianNodes:median(a.map(x=>x.nodes)),v61MedianNodes:median(b.map(x=>x.nodes)),
    v61MedianEvalCacheHits:median(b.map(x=>x.cacheHits)),v61MedianEvalCacheMisses:median(b.map(x=>x.cacheMisses)),
    sameMoveRate:b.filter((x,i)=>x.move===a[i].move).length/b.length});
}
console.log(JSON.stringify({suite:'StoneFish v6.1 cold-evaluation-cache matched-7-ply benchmark',options,results},null,2));
if(results.some(r=>r.depthV6!==r.depthV61))process.exitCode=1;
