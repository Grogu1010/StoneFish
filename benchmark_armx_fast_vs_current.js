// Direct quality/speed comparison: fast-effort ARMX candidate vs current ARMX.
// Both sides use the same current model and per-game learning; only the candidate
// enables ARMX_FAST_SCREEN while choosing its move.
const fs = require('fs');
const vm = require('vm');
const { performance } = require('perf_hooks');

const engineFiles = [
  'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js','Stonefish_v5.js','Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js'
];
if (fs.existsSync('Stonefish_v5_pro_geometry_patch.js')) engineFiles.push('Stonefish_v5_pro_geometry_patch.js');
if (fs.existsSync('Stonefish_runtime_speed_patch.js')) engineFiles.push('Stonefish_runtime_speed_patch.js');
if (fs.existsSync('Stonefish_fast_moves_experiment.js')) engineFiles.push('Stonefish_fast_moves_experiment.js');
engineFiles.push('Stonefish_v5_5_search.js','Stonefish_v5_5_refutation_guard.js',
  'Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js');
vm.runInThisContext(engineFiles.map(file => fs.readFileSync(file,'utf8')).join('\n\n'), {filename:'armx-fast-vs-current.js'});

function seededRandom(seed){let x=seed>>>0;return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function withSeed(seed,fn){const old=Math.random;Math.random=seededRandom(seed);try{return fn();}finally{Math.random=old;}}
function clearCaches(){
  if(typeof STONEFISH_V5_PRO_POSITION_CACHE!=='undefined')STONEFISH_V5_PRO_POSITION_CACHE.clear();
  if(typeof STONEFISH_V5_PRO_CONTEXT_CACHE!=='undefined')STONEFISH_V5_PRO_CONTEXT_CACHE.clear();
  if(typeof STONEFISH_V5_PRO_ADAPTIVE_CACHE!=='undefined')STONEFISH_V5_PRO_ADAPTIVE_CACHE.clear();
}
function play(game,move){return move?game.move({from:move.from,to:move.to,promotion:move.promotion||'q'}):null;}
function cleanMove(game,raw){const move=stonefishV3PublicMove(game,raw);return move?{from:move.from,to:move.to,promotion:move.promotion||undefined}:null;}
function generateOpening(pairIndex,plies=10){
  const game=new Chess(),pick=seededRandom((0xA551000+pairIndex*977)>>>0);
  return withSeed((0xB771000+pairIndex*131)>>>0,()=>{
    const moves=[];
    for(let ply=0;ply<plies&&!game.game_over();ply++){
      const scored=stonefishV5ScoreAllMoves(game);if(!scored.length)break;
      const width=Math.min(4,scored.length),r=pick(),rank=Math.min(width-1,r<0.48?0:r<0.76?1:r<0.93?2:3);
      const move=cleanMove(game,scored[rank].raw);if(!move||!play(game,move))break;moves.push(move);
    }
    return moves;
  });
}
function positionAfter(opening){const game=new Chess();for(const move of opening)if(!play(game,move))throw new Error('Invalid opening');game.armxObservationStartPly=game.historyStack.length;return game;}
function withFastMode(enabled,fn){
  const persistentCandidate=process.env.ARMX_CANDIDATE_PERSISTENT==='1';
  const hadFast=Object.prototype.hasOwnProperty.call(process.env,'ARMX_FAST_SCREEN'),oldFast=process.env.ARMX_FAST_SCREEN;
  const hadPersistent=Object.prototype.hasOwnProperty.call(process.env,'ARMX_PERSISTENT_TT'),oldPersistent=process.env.ARMX_PERSISTENT_TT;
  if(persistentCandidate){
    delete process.env.ARMX_FAST_SCREEN;
    if(enabled)process.env.ARMX_PERSISTENT_TT='1';else delete process.env.ARMX_PERSISTENT_TT;
  }else{
    if(enabled)process.env.ARMX_FAST_SCREEN='1';else delete process.env.ARMX_FAST_SCREEN;
  }
  try{return fn();}finally{
    if(hadFast)process.env.ARMX_FAST_SCREEN=oldFast;else delete process.env.ARMX_FAST_SCREEN;
    if(hadPersistent)process.env.ARMX_PERSISTENT_TT=oldPersistent;else delete process.env.ARMX_PERSISTENT_TT;
  }
}
const selectiveStats={cheapCalls:0,fullVerifications:0,gapTriggers:0,rejectionTriggers:0};
function fastMove(game){
  selectiveStats.cheapCalls++;
  const cheap=withFastMode(true,()=>getStonefishV55Testunit1Move(game));
  const review=stonefishV55Testunit1LastARMX();
  const gapLimit=Number.parseInt(process.env.ARMX_SELECTIVE_GAP||'-1',10);
  const gapTrigger=Boolean(review&&review.searchGuidanceActive&&Number.isFinite(review.hostScoreGap)&&gapLimit>=0&&review.hostScoreGap<=gapLimit);
  const rejectionTrigger=Boolean(process.env.ARMX_SELECTIVE_REJECT==='1'&&review&&review.searchGuidanceActive&&review.adaptationRejected);
  if(!gapTrigger&&!rejectionTrigger)return cheap;
  if(gapTrigger)selectiveStats.gapTriggers++;
  if(rejectionTrigger)selectiveStats.rejectionTriggers++;
  selectiveStats.fullVerifications++;
  return withFastMode(false,()=>getStonefishV55Testunit1Move(game));
}
function currentMove(game){return withFastMode(false,()=>getStonefishV55Testunit1Move(game));}
function perfSummary(moves,ms){return{moves,thinkMs:ms,averageTimePerMoveMs:moves?ms/moves:0};}
function simulate(index){
  const pair=Math.floor(index/2),fastIsWhite=index%2===0,game=positionAfter(generateOpening(pair,10));
  clearCaches();let plies=game.historyStack.length,fastMoves=0,currentMoves=0,fastMs=0,currentMs=0;
  return withSeed((0xD550000+pair*1103+index)>>>0,()=>{
    while(!game.game_over()&&plies<360){
      const fastTurn=(game.side===1)===fastIsWhite,start=performance.now();
      const move=fastTurn?fastMove(game):currentMove(game),elapsed=performance.now()-start;
      if(!play(game,move))throw new Error('Invalid move at ply '+plies);
      if(fastTurn){fastMoves++;fastMs+=elapsed;}else{currentMoves++;currentMs+=elapsed;}plies++;
    }
    let result='draw',reason=game.game_over()?'draw-rule':'max-plies';
    if(game.in_checkmate()){const winnerIsWhite=game.side===-1;result=winnerIsWhite===fastIsWhite?'win':'loss';reason='checkmate';}
    return{index,pair,fastIsWhite,result,reason,plies,fast:perfSummary(fastMoves,fastMs),current:perfSummary(currentMoves,currentMs)};
  });
}
const games=Math.max(2,Number.parseInt(process.env.ARMX_H2H_GAMES||'100',10)||100);
if(games%2)throw new Error('ARMX_H2H_GAMES must be even');
const totals={win:0,loss:0,draw:0,fastMoves:0,currentMoves:0,fastMs:0,currentMs:0},records=[];
for(let i=0;i<games;i++){
  const r=simulate(i);records.push(r);totals[r.result]++;totals.fastMoves+=r.fast.moves;totals.currentMoves+=r.current.moves;totals.fastMs+=r.fast.thinkMs;totals.currentMs+=r.current.thinkMs;
  console.log(`ARMX_FAST_H2H game ${i+1}/${games}: ${r.fastIsWhite?'W':'B'} ${r.result} ${r.reason} ${r.plies} plies`);
}
const result={games,win:totals.win,loss:totals.loss,draw:totals.draw,score:(totals.win+totals.draw*0.5)/games,
  fast:perfSummary(totals.fastMoves,totals.fastMs),current:perfSummary(totals.currentMoves,totals.currentMs),
  fastVsCurrentTimeRatio:totals.currentMoves&&totals.fastMoves?(totals.fastMs/totals.fastMoves)/(totals.currentMs/totals.currentMoves):0,
  acceptance:{minWins:40,maxLosses:40},selectiveStats,records};
console.log('ARMX_FAST_VS_CURRENT '+JSON.stringify(result));
if(games>=100&&(result.win<40||result.loss>40))process.exitCode=2;
