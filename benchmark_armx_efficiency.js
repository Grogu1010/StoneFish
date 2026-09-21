// Focused ARMX efficiency/strength comparison.
// Candidate = the ARMX policy in ARMX-preview.js on this branch.
// Current = the pre-efficiency evidence-effort policy (3,600 surprise nodes,
// 4,800 evidence nodes, depth +2), using the same learning/review code.
const fs=require('node:fs'),vm=require('node:vm');
const {performance}=require('node:perf_hooks');

const files=[
  'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js','Stonefish_v5.js','Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js','Stonefish_v5_pro_geometry_patch.js',
  'Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js',
  'Stonefish_v5_5_search.js','Stonefish_v5_5_refutation_guard.js',
  'Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js'
];
vm.runInThisContext(files.map(f=>fs.readFileSync(f,'utf8')).join('\n\n'),{filename:'armx-efficiency-bundle.js'});

function seededRandom(seed){
  let x=seed>>>0;
  return function(){
    x+=0x6D2B79F5;let t=x;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
function withSeed(seed,fn){const old=Math.random;Math.random=seededRandom(seed);try{return fn();}finally{Math.random=old;}}
function play(game,move){return move?game.move({from:move.from,to:move.to,promotion:move.promotion||'q'}):null;}
function cleanMove(game,raw){const move=stonefishV3PublicMove(game,raw);return move?{from:move.from,to:move.to,promotion:move.promotion||undefined}:null;}
function generateOpening(pair,plies=10){
  const game=new Chess(),pick=seededRandom((0xA551000+pair*977)>>>0);
  return withSeed((0xB771000+pair*131)>>>0,()=>{
    const out=[];
    for(let ply=0;ply<plies&&!game.game_over();ply++){
      const scored=stonefishV5ScoreAllMoves(game);if(!scored.length)break;
      const width=Math.min(4,scored.length),r=pick();
      const rank=Math.min(width-1,r<0.48?0:r<0.76?1:r<0.93?2:3);
      const move=cleanMove(game,scored[rank].raw);
      if(!move||!play(game,move))break;out.push(move);
    }
    return out;
  });
}
function positionAfter(opening){
  const game=new Chess();
  for(const move of opening)if(!play(game,move))throw Error('invalid opening');
  game.armxObservationStartPly=game.historyStack.length;
  return game;
}

// Exact policy used by main before the efficiency candidate. Only effort differs.
function currentEvidenceEffortPolicy(game,perspective=game.side){
  const profile=armxPreviewSyncProfile(game,perspective),model=profile.quietPolicy;
  if(!model||model.count<4)return null;
  const weights=new Float64Array(model.weights),cache=new Map();
  const score=move=>{
    const key=move.from|(move.to<<6)|(move.piece<<12)
      |((move.promotion||0)<<15)|((move.flags||0)<<18);
    let value=cache.get(key);
    if(value===undefined){
      value=armxPreviewQuietLogit(armxPreviewQuietFeatures(move,-perspective),weights);
      cache.set(key,value);
    }
    return value;
  };
  const uncertainty=armxPreviewClamp(
    -(model.qualityWeight?model.qualitySum/model.qualityWeight:0)/0.3,0,1);
  return {
    observations:model.count,
    searchBudget:SF55C.nodes+Math.round(3600*uncertainty)
      +Math.round(4800*Math.min(1,model.count/8)),
    maxDepth:SF55C.maxDepth+2,
    priority:move=>Math.round(300*score(move)),
    isLowPriority:move=>score(move)<0,
  };
}

const candidatePolicy=armxPreviewOpponentPolicy;
function moveWithPolicy(game,policy){
  const saved=armxPreviewOpponentPolicy;
  armxPreviewOpponentPolicy=policy;
  globalThis.armxPreviewOpponentPolicy=policy;
  try{return getStonefishV55Testunit1Move(game);}
  finally{
    armxPreviewOpponentPolicy=saved;
    globalThis.armxPreviewOpponentPolicy=saved;
  }
}
const candidateMove=game=>moveWithPolicy(game,candidatePolicy);
const currentMove=game=>moveWithPolicy(game,currentEvidenceEffortPolicy);
const noArmxMove=game=>getStonefishV55Testunit1NoARMXMove(game);

function simulate(contenderIsWhite,opening,seed,contender,opponent,maxPlies=360){
  const game=positionAfter(opening);
  let plies=opening.length;
  const perf={contender:{moves:0,ms:0},opponent:{moves:0,ms:0}};
  return withSeed(seed,()=>{
    while(!game.game_over()&&plies<maxPlies){
      const contenderTurn=(game.side===1)===contenderIsWhite;
      const start=performance.now();
      const move=contenderTurn?contender(game):opponent(game);
      const elapsed=performance.now()-start;
      if(!play(game,move))throw Error('invalid engine move at ply '+plies);
      const bucket=contenderTurn?perf.contender:perf.opponent;
      bucket.moves++;bucket.ms+=elapsed;plies++;
    }
    let result='draw';
    if(game.in_checkmate()){
      const winnerIsWhite=game.side===-1;
      result=winnerIsWhite===contenderIsWhite?'win':'loss';
    }
    return {result,plies,perf};
  });
}
function matchup(games,label,contender,opponent,seedBase){
  const totals={win:0,loss:0,draw:0,contenderMoves:0,contenderMs:0,opponentMoves:0,opponentMs:0};
  for(let i=0;i<games;i++){
    const pair=Math.floor(i/2),opening=generateOpening(pair,10),white=i%2===0;
    const row=simulate(white,opening,(seedBase+pair*977+i)>>>0,contender,opponent);
    totals[row.result]++;
    totals.contenderMoves+=row.perf.contender.moves;totals.contenderMs+=row.perf.contender.ms;
    totals.opponentMoves+=row.perf.opponent.moves;totals.opponentMs+=row.perf.opponent.ms;
    console.log(label+' game '+(i+1)+'/'+games+': '+row.result+' '+row.plies+' plies');
  }
  const contenderMsPerMove=totals.contenderMoves?totals.contenderMs/totals.contenderMoves:0;
  const opponentMsPerMove=totals.opponentMoves?totals.opponentMs/totals.opponentMoves:0;
  return {...totals,contenderMsPerMove,opponentMsPerMove,
    contenderToOpponentTimeRatio:opponentMsPerMove?contenderMsPerMove/opponentMsPerMove:0};
}

const games=Math.max(2,Number.parseInt(process.env.ARMX_EFF_GAMES||'20',10)||20);
if(games%2)throw Error('ARMX_EFF_GAMES must be even');
const candidateVsCurrent=matchup(games,'candidate-vs-current',candidateMove,currentMove,0xD550000);
const candidateVsNoARMX=matchup(games,'candidate-vs-noarmx',candidateMove,noArmxMove,0xE550000);
const scaledForty=Math.ceil(games*0.40);
const result={
  games,
  candidateEffort:{
    maxExtraSearchNodes:ARMX_PREVIEW.maxExtraSearchNodes,
    evidenceSearchNodes:ARMX_PREVIEW.evidenceSearchNodes,
    maxExtraSearchDepth:ARMX_PREVIEW.maxExtraSearchDepth,
  },
  candidateVsCurrent,
  candidateVsNoARMX,
  target:{
    maxTimeRatioVsNoARMX:1.4,
    candidateWinsFloor:scaledForty,
    candidateLossesCeiling:Math.floor(games*0.40),
  },
  gates:{
    speed:candidateVsNoARMX.contenderToOpponentTimeRatio<=1.4,
    wins:candidateVsCurrent.win>=scaledForty,
    losses:candidateVsCurrent.loss<=Math.floor(games*0.40),
  }
};
console.log('\nARMX_EFFICIENCY '+JSON.stringify(result));
