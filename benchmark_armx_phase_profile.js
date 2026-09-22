const fs=require('node:fs'),vm=require('node:vm');
const {performance}=require('node:perf_hooks');

const files=[
  'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js','Stonefish_v4_5_balance_patch.js',
  'Stonefish_v5.js','Stonefish_v5_pro.js','Stonefish_v5_pro_speed_patch.js','Stonefish_v5_pro_geometry_patch.js',
  'Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js','Stonefish_v5_5_search.js',
  'Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js'
];
for(const file of files) vm.runInThisContext(fs.readFileSync(file,'utf8'),{filename:file});

const phase={policyMs:0,hostMs:0,reviewMs:0,totalMs:0,moves:0,compiledMoves:0,fallbackMoves:0};
let profileActive=false;
function wrapTimed(name,key){
  const original=globalThis[name];
  if(typeof original!=='function')throw new Error(name+' not available');
  globalThis[name]=function(...args){
    if(!profileActive)return original.apply(this,args);
    const start=performance.now();
    try{return original.apply(this,args);}
    finally{phase[key]+=performance.now()-start;}
  };
}
wrapTimed('armxPreviewOpponentPolicy','policyMs');
wrapTimed('sf55cHost','hostMs');
wrapTimed('armxPreviewReview','reviewMs');

function seededRandom(seed){let x=seed>>>0;return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function withSeed(seed,fn){const old=Math.random;Math.random=seededRandom(seed);try{return fn();}finally{Math.random=old;}}
function cleanMove(game,raw){const move=stonefishV3PublicMove(game,raw);return move?{from:move.from,to:move.to,promotion:move.promotion||undefined}:null;}
function play(game,move){
  if(move&&move._raw){game._applyRaw(move._raw,true);return true;}
  return !!(move&&game.move({from:move.from,to:move.to,promotion:move.promotion||'q'}));
}
function opening(pair,plies=10){
  const game=new Chess(),pick=seededRandom((0xA551000+pair*977)>>>0),moves=[];
  withSeed((0xB771000+pair*131)>>>0,()=>{
    for(let ply=0;ply<plies&&!game.game_over();ply++){
      const scored=stonefishV5ScoreAllMoves(game);if(!scored.length)break;
      const width=Math.min(4,scored.length),r=pick(),rank=Math.min(width-1,r<0.48?0:r<0.76?1:r<0.93?2:3);
      const move=cleanMove(game,scored[rank].raw);if(!move||!play(game,move))break;moves.push(move);
    }
  });
  return moves;
}
function start(open){
  const game=new Chess();
  for(const move of open)if(!play(game,move))throw new Error('invalid opening');
  game.armxObservationStartPly=game.historyStack.length;
  return game;
}
function cheapDraw(game){
  if(game.halfmove>=100||game._insufficientMaterial())return true;
  return (game.positionCounts.get(game.fastPositionKey())||0)>=3;
}

const games=Math.max(2,Number.parseInt(process.env.GAMES||'20',10)||20);
for(let i=0;i<games;i++){
  const pair=i>>1,armxWhite=!(i&1),game=start(opening(pair));
  let plies=game.historyStack.length;
  withSeed((0xD550000+pair*977+i)>>>0,()=>{
    while(plies<260&&!game.game_over()&&!cheapDraw(game)){
      const isArmx=(game.side===1)===armxWhite;
      let move;
      if(isArmx){
        profileActive=true;
        const started=performance.now();
        try{move=getStonefishV55Testunit1Move(game);}
        finally{
          phase.totalMs+=performance.now()-started;
          phase.moves++;
          const compiled=!!(globalThis.SF55C_LAST&&globalThis.SF55C_LAST.refutationGuard&&globalThis.SF55C_LAST.refutationGuard.compiledSearch);
          if(compiled)phase.compiledMoves++;else phase.fallbackMoves++;
          profileActive=false;
        }
      }else move=getStonefishV55Testunit1NoARMXMove(game);
      if(!move||!play(game,move))break;
      plies++;
    }
  });
}
const accounted=phase.policyMs+phase.hostMs+phase.reviewMs;
const result={
  games,
  moves:phase.moves,
  compiledMoves:phase.compiledMoves,
  fallbackMoves:phase.fallbackMoves,
  averageTotalMs:phase.totalMs/phase.moves,
  averagePolicyMs:phase.policyMs/phase.moves,
  averageHostMs:phase.hostMs/phase.moves,
  averageReviewMs:phase.reviewMs/phase.moves,
  averageOtherMs:(phase.totalMs-accounted)/phase.moves,
  shares:{
    policy:phase.policyMs/phase.totalMs,
    host:phase.hostMs/phase.totalMs,
    review:phase.reviewMs/phase.totalMs,
    other:(phase.totalMs-accounted)/phase.totalMs
  }
};
console.log('ARMX_PHASE_PROFILE '+JSON.stringify(result));
