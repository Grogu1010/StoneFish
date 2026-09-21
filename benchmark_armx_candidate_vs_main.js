// Candidate-vs-main ARMX A/B. Candidate is the PR checkout; reference/ is untouched main.
const fs=require('fs'),vm=require('vm');
const {performance}=require('perf_hooks');

const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js','Stonefish_v4_5_balance_patch.js','Stonefish_v5.js','Stonefish_v5_pro.js','Stonefish_v5_pro_speed_patch.js','Stonefish_v5_pro_geometry_patch.js','Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js','Stonefish_v5_5_search.js','Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js'];
function makeEngine(dir){
 const ctx=vm.createContext({console,WebAssembly,performance,process});
 const prefix=dir?dir+'/':'';
 const src=files.filter(f=>fs.existsSync(prefix+f)).map(f=>fs.readFileSync(prefix+f,'utf8')).join('\n\n');
 vm.runInContext(src+"\nthis.__Chess=Chess;\nthis.__move=getStonefishV55Testunit1Move;\nthis.__v5=stonefishV5ScoreAllMoves;\nthis.__pub=stonefishV3PublicMove;\nthis.__setSeed=function(seed){let x=seed>>>0;Math.random=function(){x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};};\n",ctx);
 return ctx;
}
const candidate=makeEngine(''),baseline=makeEngine('reference');
function apply(ctx,g,m){return g.move({from:m.from,to:m.to,promotion:m.promotion||'q'});}
function clean(m){return m?{from:m.from,to:m.to,promotion:m.promotion||undefined}:null;}
function opening(pair){
 const g=new candidate.__Chess(),moves=[];
 candidate.__setSeed((0xB771000+pair*131)>>>0);
 let pickState=(0xA551000+pair*977)>>>0;
 const pick=()=>{pickState+=0x6D2B79F5;let t=pickState;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
 for(let ply=0;ply<10&&!g.game_over();ply++){
   const scored=candidate.__v5(g);if(!scored.length)break;
   const width=Math.min(4,scored.length),r=pick(),rank=Math.min(width-1,r<0.48?0:r<0.76?1:r<0.93?2:3);
   const m=clean(candidate.__pub(g,scored[rank].raw));if(!m||!apply(candidate,g,m))break;moves.push(m);
 }
 return moves;
}
function fresh(ctx,ops){const g=new ctx.__Chess();for(const m of ops)if(!apply(ctx,g,m))throw new Error('opening replay');g.armxObservationStartPly=g.historyStack.length;return g;}
const games=Math.max(2,parseInt(process.env.ARMX_MAIN_H2H_GAMES||'100',10)||100);
if(games%2)throw new Error('games must be even');
let win=0,loss=0,draw=0,candMoves=0,baseMoves=0,candMs=0,baseMs=0;
for(let i=0;i<games;i++){
 const pair=Math.floor(i/2),candWhite=i%2===0,ops=opening(pair),cg=fresh(candidate,ops),bg=fresh(baseline,ops);
 let plies=ops.length;
 while(!cg.game_over()&&plies<360){
   if(cg.fen()!==bg.fen())throw new Error('engine boards diverged before move');
   const candTurn=(cg.side===1)===candWhite,seed=(0xE550000+pair*977+i*17+plies*131)>>>0;
   const ctx=candTurn?candidate:baseline,g=candTurn?cg:bg;ctx.__setSeed(seed);
   const t=performance.now(),m=clean(ctx.__move(g)),dt=performance.now()-t;
   if(!m)throw new Error('null move');
   if(!apply(candidate,cg,m)||!apply(baseline,bg,m))throw new Error('illegal cross-context move '+JSON.stringify(m));
   if(candTurn){candMoves++;candMs+=dt;}else{baseMoves++;baseMs+=dt;}plies++;
 }
 let result='draw';if(cg.in_checkmate()){const winnerWhite=cg.side===-1;result=winnerWhite===candWhite?'win':'loss';}
 if(result==='win')win++;else if(result==='loss')loss++;else draw++;
 console.log('ARMX_MAIN_H2H game '+(i+1)+'/'+games+': '+(candWhite?'W':'B')+' '+result+' '+plies+' plies');
}
const out={games,win,loss,draw,score:(win+draw*0.5)/games,candidateMsPerMove:candMoves?candMs/candMoves:0,baselineMsPerMove:baseMoves?baseMs/baseMoves:0,acceptance:{minWins:40,maxLosses:40}};
console.log('ARMX_CANDIDATE_VS_MAIN '+JSON.stringify(out));
if(games>=100&&(win<40||loss>40))process.exitCode=2;
