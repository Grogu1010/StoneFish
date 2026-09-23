// Diagnostic decomposition for Artemis Full ARMX.
// Compares the release Artemis path against two developer-only controls:
// A) Full policy/search + Preview finalist review.
// B) Preview policy/search + Full finalist review.

const fs=require('fs');
const vm=require('vm');

const engineFiles=[
  'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js','Stonefish_v5.js','Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js'
];
for(const optional of ['Stonefish_v5_pro_geometry_patch.js','Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js']){
  if(fs.existsSync(optional))engineFiles.push(optional);
}
engineFiles.push(
  'Stonefish_v5_5_search.js','Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js',
  'ARMX-preview.js','Stonefish_v5_5.js','ARMX.js','Stonefish_v5_5_range.js'
);
vm.runInThisContext(engineFiles.map(file=>fs.readFileSync(file,'utf8')).join('\n\n'),{
  filename:'stonefish-v55-armx-decomposition-bundle.js'
});

function seededRandom(seed){
  let x=seed>>>0;
  return function(){
    x+=0x6D2B79F5;
    let t=x;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
function withSeed(seed,fn){
  const old=Math.random;Math.random=seededRandom(seed);
  try{return fn();}finally{Math.random=old;}
}
function publicMove(game,raw){
  const move=stonefishV3PublicMove(game,raw);
  return move?{from:move.from,to:move.to,promotion:move.promotion||undefined}:null;
}
function play(game,move){
  if(!move)return null;
  if(move._raw){game._applyRaw(move._raw,true);return move;}
  return game.move({from:move.from,to:move.to,promotion:move.promotion||'q'});
}
function generateOpening(pairIndex,plies=10){
  const game=new Chess(),pick=seededRandom((0xA551000+pairIndex*977)>>>0);
  return withSeed((0xB771000+pairIndex*131)>>>0,()=>{
    const moves=[];
    for(let ply=0;ply<plies&&!game.game_over();ply++){
      const scored=stonefishV5ScoreAllMoves(game);
      if(!scored.length)break;
      const width=Math.min(4,scored.length),r=pick();
      const rank=Math.min(width-1,r<0.48?0:r<0.76?1:r<0.93?2:3);
      const move=publicMove(game,scored[rank].raw);
      if(!move||!play(game,move))break;
      moves.push(move);
    }
    return moves;
  });
}
function positionAfter(opening){
  const game=new Chess();
  for(const move of opening)if(!play(game,move))throw new Error('invalid opening');
  game.armxObservationStartPly=game.historyStack.length;
  return game;
}
function simulate(opening,white,black,seed){
  const game=positionAfter(opening);
  let played=0;
  return withSeed(seed,()=>{
    while(!game.game_over()&&played<360){
      const fn=game.side===1?white:black;
      const move=fn(game);
      if(!move||!play(game,move))throw new Error('diagnostic move failed');
      played++;
    }
    let result=0;
    if(game.in_checkmate())result=game.side===1?-1:1;
    return {result,played};
  });
}
function matchup(label,contender,opponent,games){
  const out={label,win:0,loss:0,draw:0,played:0};
  for(let i=0;i<games;i++){
    const pair=i>>1,opening=generateOpening(9000+pair,10+(pair%4)*2);
    const contenderWhite=(i&1)===0;
    const row=simulate(
      opening,
      contenderWhite?contender:opponent,
      contenderWhite?opponent:contender,
      0xDD550000+i*313
    );
    const relative=contenderWhite?row.result:-row.result;
    if(relative>0)out.win++;else if(relative<0)out.loss++;else out.draw++;
    out.played+=row.played;
  }
  out.score=(out.win+out.draw*0.5)/games;
  out.averagePlayedMoves=out.played/games;
  return out;
}

const games=Math.max(4,Number.parseInt(process.env.GAMES||'8',10)||8);
if(games%2)throw new Error('GAMES must be even');
const rows=[
  matchup('artemisFull',getStonefishV55ArtemisMove,getStonefishV55Move,games),
  matchup('fullPolicyPreviewReview',getStonefishV55DiagFullPolicyPreviewReviewMove,getStonefishV55Move,games),
  matchup('previewPolicyFullReview',getStonefishV55DiagPreviewPolicyFullReviewMove,getStonefishV55Move,games),
];
console.log('STONEFISH_V5_5_ARMX_DECOMP '+JSON.stringify({games,rows}));
