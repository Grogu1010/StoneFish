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
  // All three are peers. Current v5.5 is a common baseline, not a ladder:
  // each Full-ARMX model must score strongly while keeping losses bounded.
  // Draws are always preferable to losses and count normally toward score.
  athenaVsCurrent:{minScore:0.75,maxLossRate:0.20},
  aresVsCurrent:{minScore:0.75,maxLossRate:0.20},
  artemisVsCurrent:{minScore:0.75,maxLossRate:0.20},

  // Sibling matchups should remain competitive. Ares is the Athena specialist;
  // Artemis has small balanced edges, but none of the trio should be a stomp.
  aresVsAthena:{minScore:0.53,maxScore:0.62,decisiveEdge:true},
  artemisVsAthena:{minScore:0.50,maxScore:0.60},
  artemisVsAres:{minScore:0.53,maxScore:0.62},

  relationships:Object.freeze({
    maxFieldScoreSpread:0.06,
    maxArtemisLead:0.05,
    maxCurrentScoreSpread:0.10,
    aresBeatsAthenaMoreOftenThanArtemis:true,
    athenaDrawsMoreThanItLosesToAres:true,
    athenaDrawsAresMoreThanArtemisDoes:true,
    athenaLosesLessToAresThanArtemisDoes:true,
    artemisScoresBetterAgainstAresThanAthenaDoes:true,
    athenaLowestSiblingLossRate:true,
    athenaHighestSiblingDrawRate:true,
    artemisTopOverall:true,
  }),

  // Personality remains visible in game duration as well as W/D/L shape.
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

function complementScore(row){return row?1-row.score:0;}
function rate(row,key){return row&&games?row[key]/games:0;}
function average(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}

const relationships=(results.athenaVsCurrent&&results.aresVsCurrent&&results.artemisVsCurrent
  &&results.aresVsAthena&&results.artemisVsAthena&&results.artemisVsAres)?(()=>{
  const aresVsAthena=results.aresVsAthena;
  const artemisVsAthena=results.artemisVsAthena;
  const artemisVsAres=results.artemisVsAres;

  const athenaVsAresScore=complementScore(aresVsAthena);
  const athenaVsArtemisScore=complementScore(artemisVsAthena);
  const aresVsArtemisScore=complementScore(artemisVsAres);

  const siblingLossRate={
    athena:average([rate(aresVsAthena,'win'),rate(artemisVsAthena,'win')]),
    ares:average([rate(aresVsAthena,'loss'),rate(artemisVsAres,'win')]),
    artemis:average([rate(artemisVsAthena,'loss'),rate(artemisVsAres,'loss')]),
  };
  const siblingDrawRate={
    athena:average([rate(aresVsAthena,'draw'),rate(artemisVsAthena,'draw')]),
    ares:average([rate(aresVsAthena,'draw'),rate(artemisVsAres,'draw')]),
    artemis:average([rate(artemisVsAthena,'draw'),rate(artemisVsAres,'draw')]),
  };

  // Overall score includes the common current-v5.5 baseline plus both siblings.
  // Artemis should lead, but only narrowly; all three remain peer-strength.
  const fieldScore={
    athena:average([results.athenaVsCurrent.score,athenaVsAresScore,athenaVsArtemisScore]),
    ares:average([results.aresVsCurrent.score,aresVsAthena.score,aresVsArtemisScore]),
    artemis:average([results.artemisVsCurrent.score,artemisVsAthena.score,artemisVsAres.score]),
  };
  const fieldValues=Object.values(fieldScore);
  const fieldScoreSpread=Math.max(...fieldValues)-Math.min(...fieldValues);
  const currentScores=[
    results.athenaVsCurrent.score,
    results.aresVsCurrent.score,
    results.artemisVsCurrent.score,
  ];
  const currentScoreSpread=Math.max(...currentScores)-Math.min(...currentScores);

  return {
    aresAthenaWinRate:rate(aresVsAthena,'win'),
    artemisAthenaWinRate:rate(artemisVsAthena,'win'),
    athenaAresDrawRate:rate(aresVsAthena,'draw'),
    athenaAresLossRate:rate(aresVsAthena,'win'),
    artemisAresDrawRate:rate(artemisVsAres,'draw'),
    artemisAresLossRate:rate(artemisVsAres,'loss'),
    athenaVsAresScore,
    artemisVsAresScore:artemisVsAres.score,
    siblingLossRate,
    siblingDrawRate,
    fieldScore,
    fieldScoreSpread,
    currentScoreSpread,
  };
})():null;

const result={
  model:'Stonefish v5.5 Full ARMX range',
  gamesPerMatchup:games,startIndex,
  sourceHashes:Object.fromEntries(loadedSources.map(({file,source})=>[file,crypto.createHash('sha256').update(source).digest('hex')])),
  armx:ARMX_FULL,range:STONEFISH_V5_5_RANGE,targets,ratios,relationships,matchups:results
};
if(process.env.RESULT_JSON)fs.writeFileSync(process.env.RESULT_JSON,JSON.stringify(result,null,2)+'\n');
console.log('\nSTONEFISH_V5_5_RANGE '+JSON.stringify(result));

function requireGate(ok,message){if(!ok)throw new Error(message);}
function matchupGate(key,target){
  const row=results[key];
  if(!row)return;
  if(Number.isFinite(target.minWinRate)){
    requireGate(rate(row,'win')+1e-12>=target.minWinRate,
      key+' failed win floor: '+row.win+'W-'+row.loss+'L-'+row.draw+'D; need win rate >='+(target.minWinRate*100)+'%');
  }
  if(Number.isFinite(target.maxLossRate)){
    requireGate(rate(row,'loss')-1e-12<=target.maxLossRate,
      key+' failed loss ceiling: '+row.win+'W-'+row.loss+'L-'+row.draw+'D; need loss rate <='+(target.maxLossRate*100)+'%');
  }
  if(Number.isFinite(target.minScore)){
    requireGate(row.score+1e-12>=target.minScore,
      key+' failed score floor: '+row.win+'W-'+row.loss+'L-'+row.draw+'D; need score >='+(target.minScore*100)+'%');
  }
  if(Number.isFinite(target.maxScore)){
    requireGate(row.score-1e-12<=target.maxScore,
      key+' failed peer-strength ceiling: '+row.win+'W-'+row.loss+'L-'+row.draw+'D; need score <='+(target.maxScore*100)+'%');
  }
  if(target.decisiveEdge){
    requireGate(row.win>row.loss,
      key+' failed decisive edge: '+row.win+'W-'+row.loss+'L-'+row.draw+'D; wins must exceed losses');
  }
}
if(process.env.RELEASE_GATE==='1'){
  for(const [key,target] of Object.entries(targets)){
    if(!target||typeof target!=='object'||Array.isArray(target)||key==='relationships')continue;
    if(results[key])matchupGate(key,target);
  }

  requireGate(relationships,'Relational range metrics unavailable');
  requireGate(relationships.aresAthenaWinRate>relationships.artemisAthenaWinRate,
    'Ares must beat Athena more often than Artemis does: Ares '+relationships.aresAthenaWinRate+', Artemis '+relationships.artemisAthenaWinRate);
  requireGate(relationships.athenaAresDrawRate>relationships.athenaAresLossRate,
    'Athena defensive identity failed vs Ares: draw rate '+relationships.athenaAresDrawRate+' must exceed loss rate '+relationships.athenaAresLossRate);
  requireGate(relationships.athenaAresDrawRate>relationships.artemisAresDrawRate,
    'Athena must force more draws against Ares than Artemis does: Athena '+relationships.athenaAresDrawRate+', Artemis '+relationships.artemisAresDrawRate);
  requireGate(relationships.athenaAresLossRate<relationships.artemisAresLossRate,
    'Athena must lose less often to Ares than Artemis does: Athena '+relationships.athenaAresLossRate+', Artemis '+relationships.artemisAresLossRate);
  requireGate(relationships.artemisVsAresScore>relationships.athenaVsAresScore,
    'Artemis must score better against Ares than Athena does');

  requireGate(relationships.siblingLossRate.athena<relationships.siblingLossRate.ares
      && relationships.siblingLossRate.athena<relationships.siblingLossRate.artemis,
    'Athena must have the lowest sibling loss rate: '+JSON.stringify(relationships.siblingLossRate));
  requireGate(relationships.siblingDrawRate.athena>relationships.siblingDrawRate.ares
      && relationships.siblingDrawRate.athena>relationships.siblingDrawRate.artemis,
    'Athena must have the highest sibling draw rate: '+JSON.stringify(relationships.siblingDrawRate));

  requireGate(relationships.fieldScore.artemis>relationships.fieldScore.athena
      && relationships.fieldScore.artemis>relationships.fieldScore.ares,
    'Artemis must narrowly lead overall field score: '+JSON.stringify(relationships.fieldScore));
  requireGate(relationships.fieldScoreSpread<=targets.relationships.maxFieldScoreSpread,
    'The three Full-ARMX models must remain peer-strength; field spread '+relationships.fieldScoreSpread
      +' exceeds '+targets.relationships.maxFieldScoreSpread);
  requireGate(relationships.fieldScore.artemis-relationships.fieldScore.athena<=targets.relationships.maxArtemisLead
      && relationships.fieldScore.artemis-relationships.fieldScore.ares<=targets.relationships.maxArtemisLead,
    'Artemis overall lead is too large: '+JSON.stringify(relationships.fieldScore));
  requireGate(relationships.currentScoreSpread<=targets.relationships.maxCurrentScoreSpread,
    'Common-baseline strength spread is too large: '+relationships.currentScoreSpread);

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
