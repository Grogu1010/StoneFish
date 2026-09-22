const fs=require('fs'),vm=require('vm'),{performance}=require('perf_hooks');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js','Stonefish_v4_5_balance_patch.js','Stonefish_v5.js','Stonefish_v5_pro.js','Stonefish_v5_pro_speed_patch.js'];
for(const x of ['Stonefish_v5_pro_geometry_patch.js','Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js'])if(fs.existsSync(x))files.push(x);
files.push('Stonefish_v5_5_search.js','Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js');
const src=files.map(file=>({file,source:fs.readFileSync(file,'utf8')}));
vm.runInThisContext(src.map(x=>x.source).join('\n\n'),{filename:'armx75.js'});
const src100=src.map(x=>x.file==='ARMX-preview.js'?x.source.replace('maxExtraSearchNodes: 2700','maxExtraSearchNodes: 3600').replace('evidenceSearchNodes: 3600','evidenceSearchNodes: 4800'):x.source);
if(src100.join('').includes('maxExtraSearchNodes: 2700'))throw Error('failed to restore 100% budget');
const ctx=vm.createContext({console,performance,Math});
vm.runInContext(src100.join('\n\n'),ctx,{filename:'armx100.js'});
const move100=vm.runInContext('getStonefishV55Testunit1Move',ctx);
const clear100=vm.runInContext(`()=>{for(const n of ['STONEFISH_V5_PRO_POSITION_CACHE','STONEFISH_V5_PRO_CONTEXT_CACHE','STONEFISH_V5_PRO_ADAPTIVE_CACHE']){const x=globalThis[n];if(x&&x.clear)x.clear();}}`,ctx);
function rng(seed){let x=seed>>>0;return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
function seeded(seed,fn){const old=Math.random;Math.random=rng(seed);try{return fn()}finally{Math.random=old}}
function clear(){for(const n of ['STONEFISH_V5_PRO_POSITION_CACHE','STONEFISH_V5_PRO_CONTEXT_CACHE','STONEFISH_V5_PRO_ADAPTIVE_CACHE']){const x=globalThis[n];if(x&&x.clear)x.clear()}clear100()}
function play(g,m){return m?g.move({from:m.from,to:m.to,promotion:m.promotion||'q'}):null}
function clean(g,raw){const m=stonefishV3PublicMove(g,raw);return m?{from:m.from,to:m.to,promotion:m.promotion||undefined}:null}
function opening(pair,plies=10){const g=new Chess(),pick=rng((0xA551000+pair*977)>>>0);return seeded((0xB771000+pair*131)>>>0,()=>{const out=[];for(let p=0;p<plies&&!g.game_over();p++){const s=stonefishV5ScoreAllMoves(g);if(!s.length)break;const w=Math.min(4,s.length),r=pick(),rank=Math.min(w-1,r<.48?0:r<.76?1:r<.93?2:3),m=clean(g,s[rank].raw);if(!m||!play(g,m))break;out.push(m)}return out})}
function start(open){const g=new Chess();for(const m of open)if(!play(g,m))throw Error('opening');g.armxObservationStartPly=g.historyStack.length;return g}
function perf(m,ms){return{moves:m,thinkMs:ms,averageTimePerMoveMs:m?ms/m:0}}
const games=Math.max(2,+process.env.GAMES||200);if(games%2)throw Error('GAMES must be even');
const t={win:0,loss:0,draw:0,m75:0,m100:0,ms75:0,ms100:0};
for(let i=0;i<games;i++){const pair=i>>1,is75White=!(i&1),g=start(opening(pair));clear();let plies=g.historyStack.length,m75=0,m100=0,ms75=0,ms100=0;
 const result=seeded((0xC750100+pair*977+i)>>>0,()=>{while(!g.game_over()&&plies<360){const use75=(g.side===1)===is75White,st=performance.now(),m=use75?getStonefishV55Testunit1Move(g):move100(g),dt=performance.now()-st;if(!play(g,m))throw Error('illegal at '+plies);if(use75){m75++;ms75+=dt}else{m100++;ms100+=dt}plies++}if(g.in_checkmate()){const w=g.side===-1;return w===is75White?'win':'loss'}return'draw'});
 t[result]++;t.m75+=m75;t.m100+=m100;t.ms75+=ms75;t.ms100+=ms100;console.log(`ARMX_75_VS_100 game ${i+1}/${games}: 75% ${is75White?'W':'B'} ${result} ${plies} plies`)}
const result={games,win:t.win,loss:t.loss,draw:t.draw,score:(t.win+t.draw*.5)/games,seventyFive:perf(t.m75,t.ms75),hundred:perf(t.m100,t.ms100),seventyFiveVsHundredTimeRatio:(t.ms75/t.m75)/(t.ms100/t.m100)};
console.log('ARMX_75_VS_100 '+JSON.stringify(result));
