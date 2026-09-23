// Controlled benchmark for the Stonefish v5.5 Full ARMX launch range.
//
// "current" is the pre-range Stonefish v5.5 + ARMX Preview getter.
// Athena, Ares and Artemis all share Full ARMX. Only Athena/Ares add style
// priors; Artemis is the neutral Full-ARMX reference.

const fs=require('fs');
const vm=require('vm');
const crypto=require('crypto');
const {performance}=require('perf_hooks');

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
const loadedSources=engineFiles.map(file=>({file,source:fs.readFileSync(file,'utf8')}));
vm.runInThisContext(loadedSources.map(row=>row.source).join('\n\n'),{filename:'stonefish-v55-range-bundle.js'});

function seededRandom(seed){
  let x=seed>>>0;
  return function random(){
    x+=0x6D2B79F5;
    let t=x;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
function withSeed(seed,fn){const old=Math.random;Math.random=seededRandom(seed);try{return fn();}finally{Math.random=old;}}
function clearSharedEngineCaches(){
  if(typeof STONEFISH_V5_PRO_POSITION_CACHE!=='undefined')STONEFISH_V5_PRO_POSITION_CACHE.clear();
  if(typeof STONEFISH_V5_PRO_CONTEXT_CACHE!=='undefined')STONEFISH_V5_PRO_CONTEXT_CACHE.clear();
  if(typeof STONEFISH_V5_PRO_ADAPTIVE_CACHE!=='undefined')STONEFISH_V5_PRO_ADAPTIVE_CACHE.clear();
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
  const game=new Chess();
  const pick=seededRandom((0xA551000+pairIndex*977)>>>0);
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
  for(const move of opening)if(!play(game,move))throw new Error('Invalid generated opening');
  game.armxObservationStartPly=game.historyStack.length;
  return game;
}
const STYLE_FEATURES=['capture','trade','simplify','check','kingAttack','pawnPush','castle','quiet','advance','retreat'];
function emptyStyleCounts(){return Object.fromEntries(STYLE_FEATURES.map(feature=>[feature,0]));}
function fullArmxStyleFor(fn){
  if(fn===getStonefishV55AthenaMove)return 'athena';
  if(fn===getStonefishV55AresMove)return 'ares';
  if(fn===getStonefishV55ArtemisMove)return 'artemis';
  return null;
}
function observeStyleMove(game,move,counts){
  const raw=move&&move._raw;
  if(!raw||typeof armxPreviewFeatureSet!=='function')return;
  const features=armxPreviewFeatureSet(game,raw);
  for(const feature of STYLE_FEATURES)if(features.has(feature))counts[feature]++;
}

function simulateGame(contenderIsWhite,opening,seed,contenderFn,opponentFn,maxPlies=1000){
  const game=positionAfter(opening);
  clearSharedEngineCaches();
  let plies=opening.length;
  const openingPlies=opening.length;
  let contenderThinkMs=0,opponentThinkMs=0,contenderMoves=0,opponentMoves=0;
  const contenderStyle=emptyStyleCounts(),opponentStyle=emptyStyleCounts();
  const contenderFullStyle=fullArmxStyleFor(contenderFn),opponentFullStyle=fullArmxStyleFor(opponentFn);
  const contenderArmx={moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0};
  const opponentArmx={moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0};
  return withSeed(seed,()=>{
    while(!game.game_over()&&plies<maxPlies){
      const contenderTurn=(game.side===1)===contenderIsWhite;
      const started=performance.now();
      const move=contenderTurn?contenderFn(game):opponentFn(game);
      const elapsed=performance.now()-started;
      if(move)observeStyleMove(game,move,contenderTurn?contenderStyle:opponentStyle);
      const fullStyle=contenderTurn?contenderFullStyle:opponentFullStyle;
      if(fullStyle&&typeof armxFullLast==='function'){
        const last=armxFullLast(fullStyle);
        if(last){
          const bucket=contenderTurn?contenderArmx:opponentArmx;
          bucket.moves++;
          bucket.rootWidthTotal+=Number(last.rootWidth)||3;
          bucket.rootWidthMax=Math.max(bucket.rootWidthMax,Number(last.rootWidth)||3);
          if(last.changedMove)bucket.changedMoves++;
        }
      }
      if(!move||!play(game,move)){
        if(!move&&game.game_over())break;
        throw new Error('Illegal/null engine move at ply '+plies);
      }
      if(contenderTurn){contenderThinkMs+=elapsed;contenderMoves++;}
      else{opponentThinkMs+=elapsed;opponentMoves++;}
      plies++;
    }
    let result='draw',reason='max-plies';
    if(game.in_checkmate()){
      const winnerIsWhite=game.side===-1;
      result=winnerIsWhite===contenderIsWhite?'win':'loss';
      reason='checkmate';
    }else if(game.game_over())reason='draw-rule';
    return {
      result,reason,plies,totalMoves:plies/2,
      playedPlies:plies-openingPlies,
      playedMoves:(plies-openingPlies)/2,
      contenderThinkMs,opponentThinkMs,contenderMoves,opponentMoves,
      contenderStyle,opponentStyle,contenderArmx,opponentArmx
    };
  });
}
function matchup(games,label,contenderFn,opponentFn,startIndex=0){
  const out={label,win:0,loss:0,draw:0,plies:0,playedPlies:0,records:[],contenderThinkMs:0,opponentThinkMs:0,contenderMoves:0,opponentMoves:0,contenderStyle:emptyStyleCounts(),opponentStyle:emptyStyleCounts(),contenderArmx:{moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0},opponentArmx:{moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0}};
  for(let local=0;local<games;local++){
    const i=startIndex+local,pair=Math.floor(i/2);
    const opening=generateOpening(pair,10);
    const contenderIsWhite=i%2===0;
    const row=simulateGame(contenderIsWhite,opening,(0xC550000+pair*977+i)>>>0,contenderFn,opponentFn);
    out[row.result]++;
    out.plies+=row.plies;out.playedPlies+=row.playedPlies;
    out.contenderThinkMs+=row.contenderThinkMs;out.opponentThinkMs+=row.opponentThinkMs;
    out.contenderMoves+=row.contenderMoves;out.opponentMoves+=row.opponentMoves;
    for(const feature of STYLE_FEATURES){
      out.contenderStyle[feature]+=row.contenderStyle[feature]||0;
      out.opponentStyle[feature]+=row.opponentStyle[feature]||0;
    }
    for(const key of ['moves','rootWidthTotal','changedMoves']){
      out.contenderArmx[key]+=row.contenderArmx[key]||0;
      out.opponentArmx[key]+=row.opponentArmx[key]||0;
    }
    out.contenderArmx.rootWidthMax=Math.max(out.contenderArmx.rootWidthMax,row.contenderArmx.rootWidthMax||0);
    out.opponentArmx.rootWidthMax=Math.max(out.opponentArmx.rootWidthMax,row.opponentArmx.rootWidthMax||0);
    out.records.push({index:i,pair,contenderIsWhite,...row});
    console.log(label+' '+(local+1)+'/'+games+': '+row.result+' '+row.reason+' '+row.playedPlies+' played plies');
  }
  out.averagePlies=games?out.plies/games:0;
  out.averagePlayedPlies=games?out.playedPlies/games:0;
  out.averageMoves=out.averagePlies/2;
  out.averagePlayedMoves=out.averagePlayedPlies/2;
  out.score=games?(out.win+out.draw*0.5)/games:0;
  out.contenderAverageMs=out.contenderMoves?out.contenderThinkMs/out.contenderMoves:0;
  out.opponentAverageMs=out.opponentMoves?out.opponentThinkMs/out.opponentMoves:0;
  out.contenderStyleRates=Object.fromEntries(STYLE_FEATURES.map(feature=>[feature,out.contenderMoves?out.contenderStyle[feature]/out.contenderMoves:0]));
  out.opponentStyleRates=Object.fromEntries(STYLE_FEATURES.map(feature=>[feature,out.opponentMoves?out.opponentStyle[feature]/out.opponentMoves:0]));
  out.contenderArmx.averageRootWidth=out.contenderArmx.moves?out.contenderArmx.rootWidthTotal/out.contenderArmx.moves:0;
  out.contenderArmx.changedMoveRate=out.contenderArmx.moves?out.contenderArmx.changedMoves/out.contenderArmx.moves:0;
  out.opponentArmx.averageRootWidth=out.opponentArmx.moves?out.opponentArmx.rootWidthTotal/out.opponentArmx.moves:0;
  out.opponentArmx.changedMoveRate=out.opponentArmx.moves?out.opponentArmx.changedMoves/out.opponentArmx.moves:0;
  return out;
}

if(ARMX_FULL.kind!=='opponent-adaptation'||ARMX_FULL.reset!=='per-game')throw new Error('Full ARMX contract broken');
if(STONEFISH_V5_5_RANGE.models.artemis.style!=='artemis')throw new Error('Artemis must be neutral Full ARMX');
if(ARMX_FULL.styleScale.artemis!==0||ARMX_FULL.maxStyleAdjustment.artemis!==0)throw new Error('Artemis may not have a style prior');

const definitions={
  athenaVsCurrent:['Athena-vs-current-v5.5',getStonefishV55AthenaMove,getStonefishV55Move],
  aresVsCurrent:['Ares-vs-current-v5.5',getStonefishV55AresMove,getStonefishV55Move],
  artemisVsCurrent:['Artemis-vs-current-v5.5',getStonefishV55ArtemisMove,getStonefishV55Move],
  aresVsAthena:['Ares-vs-Athena',getStonefishV55AresMove,getStonefishV55AthenaMove],
  artemisVsAthena:['Artemis-vs-Athena',getStonefishV55ArtemisMove,getStonefishV55AthenaMove],
  artemisVsAres:['Artemis-vs-Ares',getStonefishV55ArtemisMove,getStonefishV55AresMove],
};
const targets={
  athenaVsCurrent:{wins:80,losses:20,draws:0},
  aresVsCurrent:{wins:70,losses:30,draws:0},
  artemisVsCurrent:{wins:85,losses:15,draws:0},
  aresVsAthena:{wins:58,losses:35,draws:7},
  artemisVsAthena:{wins:60,losses:35,draws:5},
  artemisVsAres:{wins:60,losses:35,draws:5},
  athenaPlayedMoveRatioToArtemisCurrent:3,
  aresPlayedMoveRatioToArtemisCurrent:0.5,
  moveRatioTolerance:0.10,
};
const games=Math.max(0,Number.parseInt(process.env.GAMES||'12',10)||0);
const startIndex=Math.max(0,Number.parseInt(process.env.START_INDEX||'0',10)||0);
const only=process.env.MATCHUP||'';
if(only&&!definitions[only])throw new Error('Unknown MATCHUP '+only);
if(process.env.RELEASE_GATE==='1'&&(games<100||games%2!==0||only))throw new Error('Range release proof requires all six matchups with at least 100 color-balanced games each');

const results={};
for(const [key,args] of Object.entries(definitions)){
  if(only&&key!==only)continue;
  results[key]=matchup(games,...args,startIndex);
}
const ratios=results.athenaVsCurrent&&results.aresVsCurrent&&results.artemisVsCurrent?{
  athenaToArtemis:results.athenaVsCurrent.averagePlayedMoves/results.artemisVsCurrent.averagePlayedMoves,
  aresToArtemis:results.aresVsCurrent.averagePlayedMoves/results.artemisVsCurrent.averagePlayedMoves,
}:null;

const result={
  model:'Stonefish v5.5 Full ARMX range',
  gamesPerMatchup:games,startIndex,
  sourceHashes:Object.fromEntries(loadedSources.map(({file,source})=>[file,crypto.createHash('sha256').update(source).digest('hex')])),
  armx:ARMX_FULL,range:STONEFISH_V5_5_RANGE,targets,ratios,matchups:results
};
if(process.env.RESULT_JSON)fs.writeFileSync(process.env.RESULT_JSON,JSON.stringify(result,null,2)+'\n');
console.log('\nSTONEFISH_V5_5_RANGE '+JSON.stringify(result));

function scaledMinimum(value){return Math.ceil(games*value/100);}
function scaledMaximum(value){return Math.floor(games*value/100);}
if(process.env.RELEASE_GATE==='1'){
  for(const [key,target] of Object.entries(targets)){
    if(!target||typeof target!=='object'||!('wins' in target))continue;
    const row=results[key];
    const minWins=scaledMinimum(target.wins),maxLosses=scaledMaximum(target.losses),maxDraws=scaledMaximum(target.draws);
    if(row.win<minWins||row.loss>maxLosses||row.draw>maxDraws){
      throw new Error(key+' failed: '+row.win+'W-'+row.loss+'L-'+row.draw+'D; need >='+minWins+'W <='+maxLosses+'L <='+maxDraws+'D');
    }
  }
  const tol=targets.moveRatioTolerance;
  const athenaLow=targets.athenaPlayedMoveRatioToArtemisCurrent*(1-tol);
  const athenaHigh=targets.athenaPlayedMoveRatioToArtemisCurrent*(1+tol);
  const aresLow=targets.aresPlayedMoveRatioToArtemisCurrent*(1-tol);
  const aresHigh=targets.aresPlayedMoveRatioToArtemisCurrent*(1+tol);
  if(!ratios||ratios.athenaToArtemis<athenaLow||ratios.athenaToArtemis>athenaHigh){
    throw new Error('Athena round-length identity failed: '+(ratios&&ratios.athenaToArtemis)+'x; target ~3x');
  }
  if(ratios.aresToArtemis<aresLow||ratios.aresToArtemis>aresHigh){
    throw new Error('Ares round-length identity failed: '+ratios.aresToArtemis+'x; target ~0.5x');
  }
}
