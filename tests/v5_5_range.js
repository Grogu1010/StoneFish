// Controlled benchmark for the Stonefish v5.5 Full ARMX launch range.
//
// "current" is the pre-range Stonefish v5.5 + ARMX Preview getter.
// Athena, Ares and Artemis all share Full ARMX. Only Athena/Ares add style
// priors; Artemis is the neutral Full-ARMX reference.

const fs=require('fs');
const vm=require('vm');
const crypto=require('crypto');
const {performance}=require('perf_hooks');

const engineFiles=['StonefishChess.js',...['v1.js','v2.js','v3.js','v4.js','v4_5.js','v5.js','v5_pro.js','v5_5.js'].map(file=>`models/${file}`),'ARMX/ARMX-preview.js','ARMX/ARMX.js'];
const loadedSources=engineFiles.map(file=>({file,source:fs.readFileSync(file,'utf8')}));
const sourceHashes=Object.fromEntries(
  loadedSources.map(({file,source})=>[file,crypto.createHash('sha256').update(source).digest('hex')])
);
function bundledSource(bundle,file){
  const escaped=file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=bundle.match(new RegExp('// BEGIN SOURCE: '+escaped+'\\r?\\n([\\s\\S]*?)// END SOURCE: '+escaped));
  if(!match)throw new Error('Missing bundled source segment: '+file);
  return match[1];
}
const FROZEN_CURRENT_V55_HASHES=Object.freeze({
  'ARMX/ARMX-preview.js':'15ce780a0c38c3363b27e2eee40b5ed0c32962b74a074af7d5e4ae87a3d6143f',
  'Stonefish_v5_5.js':'ce867135cdd2462c5793565d4e310fd893763809f75cee8e8bea6814d1e66b40',
});
const sourceByFile=Object.fromEntries(loadedSources.map(row=>[row.file,row.source]));
function markedModelSegment(file,name,nextName){
  const source=sourceByFile[file];
  const start=source.indexOf(`// ${name}\n`);
  const end=source.indexOf(`// ${nextName}\n`,start+1);
  if(start<0||end<0)throw new Error(`Missing model source boundary: ${name}`);
  return source.slice(start+`// ${name}\n`.length,end).trimEnd()+'\n';
}
const frozenSources={
  'ARMX/ARMX-preview.js':sourceByFile['ARMX/ARMX-preview.js'],
  'Stonefish_v5_5.js':markedModelSegment('models/v5_5.js','Stonefish_v5_5.js','Stonefish_v5_5_range.js'),
};
for(const [file,expected] of Object.entries(FROZEN_CURRENT_V55_HASHES)){
  // Git checks out text with platform-specific newlines; hash canonical LF so
  // Windows and Linux verify the same frozen source bytes.
  const canonicalSource=frozenSources[file].replace(/\r\n/g,'\n');
  const actual=crypto.createHash('sha256').update(canonicalSource).digest('hex');
  if(actual!==expected){
    throw new Error('Frozen current v5.5 source changed: '+file+' '+actual+' != '+expected);
  }
}
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
function cloneGame(source,observationStartPly=source.armxObservationStartPly||0){
  const game=new Chess();
  for(const state of source.historyStack||[])game._applyRaw({...state.move},state.trackRepetition);
  game.armxObservationStartPly=observationStartPly;
  if(game.fastPositionKey()!==source.fastPositionKey())throw new Error('Range latency replay failed');
  return game;
}
function buildOverheadPositions(count){
  const rows=[];
  for(let i=0;i<count;i++){
    const opening=generateOpening(5000+i,12+(i%8));
    const game=positionAfter(opening);
    // Treat the replayed history as real opponent evidence for component timing.
    game.armxObservationStartPly=0;
    rows.push(game);
  }
  return rows;
}

// Full-only outcome notes measure the opponent's move or response directly.
// The value of our initiating move must not leak into the recorded response.
{
  const game=new Chess();
  game.armxObservationStartPly=0;
  armxFullSyncNotebook(game,1);
  const ourMove=game.fastMoves().find(move=>move.from===game._sq('e2')&&move.to===game._sq('e4'));
  if(!ourMove)throw new Error('Missing Full ARMX attribution fixture move e2e4');
  game.fastApply(ourMove);
  armxFullSyncNotebook(game,1);
  const afterOurMove=armxPreviewStateSnapshot(game,1).score;
  const reply=game.fastMoves().find(move=>move.from===game._sq('e7')&&move.to===game._sq('e5'));
  if(!reply)throw new Error('Missing Full ARMX attribution fixture reply e7e5');
  game.fastApply(reply);
  const afterReply=armxPreviewStateSnapshot(game,1).score;
  const expectedImpact=armxFullClamp(
    (afterReply-afterOurMove)/(Number(ARMX_PREVIEW.effectScale)||360),-1,1
  );
  const book=armxFullSyncNotebook(game,1);
  const opponentMoveEffect=book.extendedEffects.pawnMove;
  if(!opponentMoveEffect||opponentMoveEffect.weight!==1
    ||Math.abs(opponentMoveEffect.impact/opponentMoveEffect.weight-expectedImpact)>1e-12){
    throw new Error('Full ARMX opponent notes must attribute only the opponent move');
  }
  const ownReplyEffects=Object.entries(book.ourContextEffects)
    .filter(([key])=>key.endsWith('>pawnMove')).map(([,row])=>row);
  if(!ownReplyEffects.length||ownReplyEffects.some(row=>row.weight!==1
    ||Math.abs(row.impact/row.weight-expectedImpact)>1e-12)){
    throw new Error('Full ARMX context notes must attribute only the opponent reply');
  }
  const responseEffects=Object.values(book.responseEffects);
  if(!responseEffects.length||responseEffects.some(row=>row.weight!==1
    ||Math.abs(row.impact/row.weight-expectedImpact)>1e-12)){
    throw new Error('Full ARMX response notes must attribute only the opponent reply');
  }
}

function timeComponent(fn){
  const started=performance.now();
  const value=fn();
  return {value,ms:performance.now()-started};
}
function median(values){
  if(!values.length)return 0;
  const sorted=values.slice().sort((a,b)=>a-b);
  const mid=sorted.length>>1;
  return sorted.length&1?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
function armxAttributedOverheadBenchmark(sampleCount){
  const positions=buildOverheadPositions(sampleCount);
  const styles=['athena','ares','artemis'];
  const rows={preview:[],athena:[],ares:[],artemis:[]};

  // Compare each policy against the same compiled v5.5 path. The historical
  // null-policy fallback is JavaScript and is not a valid compiled baseline.
  const neutralPolicy=()=>({
    searchBudget:SF55C.nodes,maxDepth:SF55C.maxDepth,
    weights:Object.create(null),priority:()=>0,isLowPriority:()=>false,
  });
  // Warm all paths once outside timing.
  if(positions.length){
    const source=positions[0];
    {
      const game=cloneGame(source,0);
      const policy=armxPreviewOpponentPolicy(game,game.side);
      const host=stonefishV55HostSearch(game,policy);
      armxPreviewReview(game,host.finished.slice(0,Math.max(1,ARMX_PREVIEW.candidateLimit)),game.side);
    }
    for(const style of styles){
      const game=cloneGame(source,0);
      const policy=armxFullOpponentPolicy(game,game.side,style);
      const host=stonefishV55HostSearch(game,policy);
      armxFullReview(game,host.finished,style,game.side);
    }
    stonefishV55HostSearch(cloneGame(source,0),neutralPolicy());
  }

  for(let i=0;i<positions.length;i++){
    const source=positions[i];

    // Measure the neutral compiled search for this exact position.
    const baseGame=cloneGame(source,0);
    clearSharedEngineCaches();
    const baseStart=performance.now();
    stonefishV55HostSearch(baseGame,neutralPolicy());
    const baseHostMs=performance.now()-baseStart;

    {
      const game=cloneGame(source,0);
      clearSharedEngineCaches();
      const policyTimed=timeComponent(()=>armxPreviewOpponentPolicy(game,game.side));
      const hostStart=performance.now();
      const host=stonefishV55HostSearch(game,policyTimed.value);
      const hostMs=performance.now()-hostStart;
      const reviewTimed=timeComponent(()=>armxPreviewReview(
        game,host.finished.slice(0,Math.max(1,ARMX_PREVIEW.candidateLimit)),game.side
      ));
      const directMs=policyTimed.ms+reviewTimed.ms;
      const extraHostMs=hostMs-baseHostMs;
      rows.preview.push({directMs,extraHostMs,attributedMs:directMs+extraHostMs});
    }

    for(const style of styles){
      const game=cloneGame(source,0);
      clearSharedEngineCaches();
      const policyTimed=timeComponent(()=>armxFullOpponentPolicy(game,game.side,style));
      const hostStart=performance.now();
      const host=stonefishV55HostSearch(game,policyTimed.value);
      const hostMs=performance.now()-hostStart;
      const reviewTimed=timeComponent(()=>armxFullReview(game,host.finished,style,game.side));
      const directMs=policyTimed.ms+reviewTimed.ms;
      const extraHostMs=hostMs-baseHostMs;
      rows[style].push({directMs,extraHostMs,attributedMs:directMs+extraHostMs});
    }
  }

  const summarize=list=>({
    directAverageMs:average(list.map(row=>row.directMs)),
    extraHostAverageMs:average(list.map(row=>row.extraHostMs)),
    attributedAverageMs:average(list.map(row=>row.attributedMs)),
    attributedMedianMs:median(list.map(row=>row.attributedMs)),
  });
  const preview=summarize(rows.preview);
  const full=Object.fromEntries(styles.map(style=>[style,summarize(rows[style])]));
  const ratio=Object.fromEntries(styles.map(style=>[
    style,
    preview.attributedAverageMs>0
      ?full[style].attributedAverageMs/preview.attributedAverageMs
      :Infinity,
  ]));
  return {samples:sampleCount,preview,full,ratio};
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
  const contenderArmx={moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0,maturityTotal:0,noteBreadthTotal:0,searchBudgetTotal:0,depthLimitTotal:0,noteUsefulnessTotal:0,learnedStrengthTotal:0,surpriseTotal:0,fullNoteAllowed:0,styleAllowed:0,previewAllowed:0,winnerFullNoteAllowed:0,winnerStyleAllowed:0,winnerPreviewAllowed:0,challengers:0,noteAllowedChallengers:0,positiveNoteLeadChallengers:0,noteLeadTotal:0,absoluteNoteLeadTotal:0,absoluteLearnedSignalTotal:0,maxNoteLead:0,maxAbsoluteLearnedSignal:0,patientTotal:0,activatedPatientTotal:0,patientSamples:0};
  const opponentArmx={moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0,maturityTotal:0,noteBreadthTotal:0,searchBudgetTotal:0,depthLimitTotal:0,noteUsefulnessTotal:0,learnedStrengthTotal:0,surpriseTotal:0,fullNoteAllowed:0,styleAllowed:0,previewAllowed:0,winnerFullNoteAllowed:0,winnerStyleAllowed:0,winnerPreviewAllowed:0,challengers:0,noteAllowedChallengers:0,positiveNoteLeadChallengers:0,noteLeadTotal:0,absoluteNoteLeadTotal:0,absoluteLearnedSignalTotal:0,maxNoteLead:0,maxAbsoluteLearnedSignal:0,patientTotal:0,activatedPatientTotal:0,patientSamples:0};
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
          bucket.maturityTotal+=Number(last.maturity)||0;
          bucket.noteBreadthTotal+=Array.isArray(last.notes)?last.notes.length:0;
          bucket.searchBudgetTotal+=Number(last.searchBudget)||0;
          bucket.depthLimitTotal+=Number(last.depthLimit)||0;
          bucket.noteUsefulnessTotal+=Number(last.noteUsefulness)||0;
          bucket.learnedStrengthTotal+=Number(last.learnedStrength)||0;
          bucket.surpriseTotal+=Number(last.predictionSurprise)||0;
          const reports=Array.isArray(last.reports)?last.reports:[];
          for(const report of reports){
            if(report&&report.fullNoteGate&&report.fullNoteGate.allowed)bucket.fullNoteAllowed++;
            if(report&&report.styleGate&&report.styleGate.allowed)bucket.styleAllowed++;
            if(report&&report.previewGate&&report.previewGate.allowed)bucket.previewAllowed++;
            const isProvisional=report&&last.provisionalRaw
              &&stonefishV5SameMove(report.raw,last.provisionalRaw);
            if(report&&!isProvisional){
              bucket.challengers++;
              if(report.fullNoteGate&&report.fullNoteGate.allowed)bucket.noteAllowedChallengers++;
              const noteLead=Number(report.noteLead)||0;
              const learnedSignal=Number(report.learnedSignal)||0;
              if(noteLead>0)bucket.positiveNoteLeadChallengers++;
              bucket.noteLeadTotal+=noteLead;
              bucket.absoluteNoteLeadTotal+=Math.abs(noteLead);
              bucket.absoluteLearnedSignalTotal+=Math.abs(learnedSignal);
              bucket.maxNoteLead=Math.max(bucket.maxNoteLead,noteLead);
              bucket.maxAbsoluteLearnedSignal=Math.max(
                bucket.maxAbsoluteLearnedSignal,Math.abs(learnedSignal)
              );
            }
          }
          const winnerReport=reports.find(report=>report&&last.recommendedRaw
            &&stonefishV5SameMove(report.raw,last.recommendedRaw));
          const tendencyReport=winnerReport||reports[0];
          if(tendencyReport&&tendencyReport.styleTendencies){
            bucket.patientTotal+=Number(tendencyReport.styleTendencies.patient)||0;
            bucket.activatedPatientTotal+=Number(tendencyReport.styleActivatedPatient)||0;
            bucket.patientSamples++;
          }
          if(winnerReport){
            if(winnerReport.fullNoteGate&&winnerReport.fullNoteGate.allowed)bucket.winnerFullNoteAllowed++;
            if(winnerReport.styleGate&&winnerReport.styleGate.allowed)bucket.winnerStyleAllowed++;
            if(winnerReport.previewGate&&winnerReport.previewGate.allowed)bucket.winnerPreviewAllowed++;
          }
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
  const out={label,win:0,loss:0,draw:0,plies:0,playedPlies:0,records:[],contenderThinkMs:0,opponentThinkMs:0,contenderMoves:0,opponentMoves:0,contenderStyle:emptyStyleCounts(),opponentStyle:emptyStyleCounts(),contenderArmx:{moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0,maturityTotal:0,noteBreadthTotal:0,searchBudgetTotal:0,depthLimitTotal:0,noteUsefulnessTotal:0,learnedStrengthTotal:0,surpriseTotal:0,fullNoteAllowed:0,styleAllowed:0,previewAllowed:0,winnerFullNoteAllowed:0,winnerStyleAllowed:0,winnerPreviewAllowed:0,challengers:0,noteAllowedChallengers:0,positiveNoteLeadChallengers:0,noteLeadTotal:0,absoluteNoteLeadTotal:0,absoluteLearnedSignalTotal:0,maxNoteLead:0,maxAbsoluteLearnedSignal:0,patientTotal:0,activatedPatientTotal:0,patientSamples:0},opponentArmx:{moves:0,rootWidthTotal:0,rootWidthMax:0,changedMoves:0,maturityTotal:0,noteBreadthTotal:0,searchBudgetTotal:0,depthLimitTotal:0,noteUsefulnessTotal:0,learnedStrengthTotal:0,surpriseTotal:0,fullNoteAllowed:0,styleAllowed:0,previewAllowed:0,winnerFullNoteAllowed:0,winnerStyleAllowed:0,winnerPreviewAllowed:0,challengers:0,noteAllowedChallengers:0,positiveNoteLeadChallengers:0,noteLeadTotal:0,absoluteNoteLeadTotal:0,absoluteLearnedSignalTotal:0,maxNoteLead:0,maxAbsoluteLearnedSignal:0,patientTotal:0,activatedPatientTotal:0,patientSamples:0}};
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
    for(const key of ['moves','rootWidthTotal','changedMoves','maturityTotal','noteBreadthTotal','searchBudgetTotal','depthLimitTotal','noteUsefulnessTotal','learnedStrengthTotal','surpriseTotal','fullNoteAllowed','styleAllowed','previewAllowed','winnerFullNoteAllowed','winnerStyleAllowed','winnerPreviewAllowed','challengers','noteAllowedChallengers','positiveNoteLeadChallengers','noteLeadTotal','absoluteNoteLeadTotal','absoluteLearnedSignalTotal','patientTotal','activatedPatientTotal','patientSamples']){
      out.contenderArmx[key]+=row.contenderArmx[key]||0;
      out.opponentArmx[key]+=row.opponentArmx[key]||0;
    }
    out.contenderArmx.rootWidthMax=Math.max(out.contenderArmx.rootWidthMax,row.contenderArmx.rootWidthMax||0);
    out.opponentArmx.rootWidthMax=Math.max(out.opponentArmx.rootWidthMax,row.opponentArmx.rootWidthMax||0);
    out.contenderArmx.maxNoteLead=Math.max(out.contenderArmx.maxNoteLead,row.contenderArmx.maxNoteLead||0);
    out.opponentArmx.maxNoteLead=Math.max(out.opponentArmx.maxNoteLead,row.opponentArmx.maxNoteLead||0);
    out.contenderArmx.maxAbsoluteLearnedSignal=Math.max(out.contenderArmx.maxAbsoluteLearnedSignal,row.contenderArmx.maxAbsoluteLearnedSignal||0);
    out.opponentArmx.maxAbsoluteLearnedSignal=Math.max(out.opponentArmx.maxAbsoluteLearnedSignal,row.opponentArmx.maxAbsoluteLearnedSignal||0);
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
  out.contenderArmx.averageMaturity=out.contenderArmx.moves?out.contenderArmx.maturityTotal/out.contenderArmx.moves:0;
  out.contenderArmx.averageNoteBreadth=out.contenderArmx.moves?out.contenderArmx.noteBreadthTotal/out.contenderArmx.moves:0;
  out.contenderArmx.averageSearchBudget=out.contenderArmx.moves?out.contenderArmx.searchBudgetTotal/out.contenderArmx.moves:0;
  out.contenderArmx.averageDepthLimit=out.contenderArmx.moves?out.contenderArmx.depthLimitTotal/out.contenderArmx.moves:0;
  out.contenderArmx.averageNoteUsefulness=out.contenderArmx.moves?out.contenderArmx.noteUsefulnessTotal/out.contenderArmx.moves:0;
  out.contenderArmx.averageLearnedStrength=out.contenderArmx.moves?out.contenderArmx.learnedStrengthTotal/out.contenderArmx.moves:0;
  out.contenderArmx.averagePredictionSurprise=out.contenderArmx.moves?out.contenderArmx.surpriseTotal/out.contenderArmx.moves:0;
  out.contenderArmx.fullNoteWinnerRate=out.contenderArmx.moves?out.contenderArmx.winnerFullNoteAllowed/out.contenderArmx.moves:0;
  out.contenderArmx.styleWinnerRate=out.contenderArmx.moves?out.contenderArmx.winnerStyleAllowed/out.contenderArmx.moves:0;
  out.contenderArmx.previewWinnerRate=out.contenderArmx.moves?out.contenderArmx.winnerPreviewAllowed/out.contenderArmx.moves:0;
  out.contenderArmx.noteAllowedChallengerRate=out.contenderArmx.challengers?out.contenderArmx.noteAllowedChallengers/out.contenderArmx.challengers:0;
  out.contenderArmx.positiveNoteLeadRate=out.contenderArmx.challengers?out.contenderArmx.positiveNoteLeadChallengers/out.contenderArmx.challengers:0;
  out.contenderArmx.averageNoteLead=out.contenderArmx.challengers?out.contenderArmx.noteLeadTotal/out.contenderArmx.challengers:0;
  out.contenderArmx.averageAbsoluteNoteLead=out.contenderArmx.challengers?out.contenderArmx.absoluteNoteLeadTotal/out.contenderArmx.challengers:0;
  out.contenderArmx.averageAbsoluteLearnedSignal=out.contenderArmx.challengers?out.contenderArmx.absoluteLearnedSignalTotal/out.contenderArmx.challengers:0;
  out.contenderArmx.averagePatientTendency=out.contenderArmx.patientSamples?out.contenderArmx.patientTotal/out.contenderArmx.patientSamples:0;
  out.contenderArmx.averageActivatedPatient=out.contenderArmx.patientSamples?out.contenderArmx.activatedPatientTotal/out.contenderArmx.patientSamples:0;
  out.opponentArmx.averageRootWidth=out.opponentArmx.moves?out.opponentArmx.rootWidthTotal/out.opponentArmx.moves:0;
  out.opponentArmx.changedMoveRate=out.opponentArmx.moves?out.opponentArmx.changedMoves/out.opponentArmx.moves:0;
  out.opponentArmx.averageMaturity=out.opponentArmx.moves?out.opponentArmx.maturityTotal/out.opponentArmx.moves:0;
  out.opponentArmx.averageNoteBreadth=out.opponentArmx.moves?out.opponentArmx.noteBreadthTotal/out.opponentArmx.moves:0;
  out.opponentArmx.averageSearchBudget=out.opponentArmx.moves?out.opponentArmx.searchBudgetTotal/out.opponentArmx.moves:0;
  out.opponentArmx.averageDepthLimit=out.opponentArmx.moves?out.opponentArmx.depthLimitTotal/out.opponentArmx.moves:0;
  out.opponentArmx.averageNoteUsefulness=out.opponentArmx.moves?out.opponentArmx.noteUsefulnessTotal/out.opponentArmx.moves:0;
  out.opponentArmx.averageLearnedStrength=out.opponentArmx.moves?out.opponentArmx.learnedStrengthTotal/out.opponentArmx.moves:0;
  out.opponentArmx.averagePredictionSurprise=out.opponentArmx.moves?out.opponentArmx.surpriseTotal/out.opponentArmx.moves:0;
  out.opponentArmx.fullNoteWinnerRate=out.opponentArmx.moves?out.opponentArmx.winnerFullNoteAllowed/out.opponentArmx.moves:0;
  out.opponentArmx.styleWinnerRate=out.opponentArmx.moves?out.opponentArmx.winnerStyleAllowed/out.opponentArmx.moves:0;
  out.opponentArmx.previewWinnerRate=out.opponentArmx.moves?out.opponentArmx.winnerPreviewAllowed/out.opponentArmx.moves:0;
  out.opponentArmx.noteAllowedChallengerRate=out.opponentArmx.challengers?out.opponentArmx.noteAllowedChallengers/out.opponentArmx.challengers:0;
  out.opponentArmx.positiveNoteLeadRate=out.opponentArmx.challengers?out.opponentArmx.positiveNoteLeadChallengers/out.opponentArmx.challengers:0;
  out.opponentArmx.averageNoteLead=out.opponentArmx.challengers?out.opponentArmx.noteLeadTotal/out.opponentArmx.challengers:0;
  out.opponentArmx.averageAbsoluteNoteLead=out.opponentArmx.challengers?out.opponentArmx.absoluteNoteLeadTotal/out.opponentArmx.challengers:0;
  out.opponentArmx.averageAbsoluteLearnedSignal=out.opponentArmx.challengers?out.opponentArmx.absoluteLearnedSignalTotal/out.opponentArmx.challengers:0;
  out.opponentArmx.averagePatientTendency=out.opponentArmx.patientSamples?out.opponentArmx.patientTotal/out.opponentArmx.patientSamples:0;
  out.opponentArmx.averageActivatedPatient=out.opponentArmx.patientSamples?out.opponentArmx.activatedPatientTotal/out.opponentArmx.patientSamples:0;
  return out;
}

if(ARMX_FULL.kind!=='opponent-adaptation'||ARMX_FULL.reset!=='per-game')throw new Error('Full ARMX contract broken');
if(STONEFISH_V5_5_RANGE.models.artemis.style!=='artemis')throw new Error('Artemis must be neutral Full ARMX');
if(ARMX_FULL.styleScale.artemis!==0||ARMX_FULL.maxStyleAdjustment.artemis!==0)throw new Error('Artemis may not have a style prior');
if(ARMX_FULL.styleProfiles.artemis.baseScale!==0
  ||Object.values(ARMX_FULL.styleProfiles.artemis.weights).some(value=>Number(value)!==0)){
  throw new Error('Artemis numeric style profile must be exactly neutral');
}
if(ARMX_FULL.baseSearchNodes!==SF55C.nodes||ARMX_FULL.baseDepth!==SF55C.maxDepth
  ||ARMX_FULL.baseRootWidth!==SF55C.multiPV){
  throw new Error('Full ARMX may not receive a free base-engine strength bump');
}

// The opponent-adaptation policy itself is shared. Styles are allowed only in
// the common finalist-style layer after this policy/search has run.
{
  const project=policy=>({
    observations:policy.observations,
    voluntaryObservations:policy.voluntaryObservations,
    maturity:policy.maturity,
    noteUsefulness:policy.noteUsefulness,
    learnedStrength:policy.learnedStrength,
    searchBudget:policy.searchBudget,
    maxDepth:policy.maxDepth,
    maxExtraNodes:policy.maxExtraNodes,
    maxExtraDepth:policy.maxExtraDepth,
    rootWidth:policy.rootWidth,
    predictionSurprise:policy.predictionSurprise,
    weights:Array.from(policy.weights||[]),
  });
  for(const [pair,plies] of [[0x55AA,10],[0x55AB,14],[0x55AC,18],[0x55AD,22]]){
    const probe=positionAfter(generateOpening(pair,plies));
    probe.armxObservationStartPly=0;
    const paths={};
    for(const style of ['athena','ares','artemis']){
      const game=cloneGame(probe,0);
      const previewPolicy=armxPreviewOpponentPolicy(game,game.side);
      const policy=armxFullOpponentPolicy(game,game.side,style);
      const minimumPreviewBudget=previewPolicy&&Number.isFinite(previewPolicy.searchBudget)
        ?previewPolicy.searchBudget:SF55C.nodes;
      if(policy.searchBudget<minimumPreviewBudget){
        throw new Error(style+' Full ARMX must preserve Preview earned search budget');
      }
      const replies=game.fastMoves();
      const host=stonefishV55HostSearch(game,policy);
      if(host.searchBudget<policy.searchBudget){
        throw new Error(style+' Full ARMX host must honor its earned node budget');
      }
      if(host.rootWidth!==ARMX_FULL.baseRootWidth){
        throw new Error(style+' Full ARMX telemetry must report actual root width');
      }
      paths[style]={
        policy:project(policy),
        priorities:replies.map(move=>policy.priority(move)),
        reductions:replies.map(move=>policy.isLowPriority(move)),
        search:{
          nodes:host.nodes,depth:host.depth,
          finished:host.finished.map(entry=>({
            move:stonefishV45RawUci(game,entry.raw),
            score:entry.score,exact:entry.exact,
          })),
        },
      };
    }
    const baseline=JSON.stringify(paths.artemis);
    for(const style of ['athena','ares']){
      if(JSON.stringify(paths[style])!==baseline){
        throw new Error('Full ARMX policy/search must be style-independent: '
          +style+' differs from Artemis after '+plies+' plies');
      }
    }
  }
}

const definitions={
  athenaVsCurrent:['Athena-vs-current-v5.5',getStonefishV55AthenaMove,getStonefishV55Move],
  aresVsCurrent:['Ares-vs-current-v5.5',getStonefishV55AresMove,getStonefishV55Move],
  artemisVsCurrent:['Artemis-vs-current-v5.5',getStonefishV55ArtemisMove,getStonefishV55Move],
  aresVsAthena:['Ares-vs-Athena',getStonefishV55AresMove,getStonefishV55AthenaMove],
  artemisVsAthena:['Artemis-vs-Athena',getStonefishV55ArtemisMove,getStonefishV55AthenaMove],
  artemisVsAres:['Artemis-vs-Ares',getStonefishV55ArtemisMove,getStonefishV55AresMove],
};
const targets={
  // All three are peers. Every Full-ARMX model must score above 85% across
  // its 100-game current-v5.5 pairing; draws count as half a point.
  athenaVsCurrent:{minScore:0.85,scoreFloorExclusive:true,maxScore:1.0,maxLossRate:0.20},
  aresVsCurrent:{minScore:0.85,scoreFloorExclusive:true,maxScore:1.0,maxLossRate:0.20},
  artemisVsCurrent:{minScore:0.85,scoreFloorExclusive:true,maxScore:1.0,maxLossRate:0.20},

  // Sibling matchups are intentionally close. These are hard relationship
  // bounds, not quotas: each intended winner must clear 50%, but a large edge
  // is a failure because the three models are meant to be peers.
  aresVsAthena:{minScore:0.505,maxScore:0.58,decisiveEdge:true},
  artemisVsAthena:{minScore:0.505,maxScore:0.58,decisiveEdge:true},
  artemisVsAres:{minScore:0.505,maxScore:0.58,decisiveEdge:true},

  // Preferred 100-game tuning centres. These are reported for guidance only;
  // release depends on the relational gates below, not exact W/L/D quotas.
  preferredSiblingWLD:Object.freeze({
    aresVsAthena:Object.freeze({win:27,loss:22,draw:51}),
    artemisVsAthena:Object.freeze({win:25,loss:23,draw:52}),
    artemisVsAres:Object.freeze({win:33,loss:29,draw:38}),
  }),
  // Soft centres only: Artemis should be the best default, but not by much.
  preferredCurrentScore:Object.freeze({
    athena:0.86,
    ares:0.86,
    artemis:0.88,
  }),

  relationships:Object.freeze({
    maxFieldScoreSpread:0.06,
    maxArtemisLead:0.05,
    maxCurrentScoreSpread:0.06,
    maxArtemisCurrentLead:0.05,
    maxFullArmxAttributedOverheadToPreviewOverheadRatio:2.0,
    artemisBestAgainstCurrent:true,
    aresBeatsAthenaMoreOftenThanArtemis:true,
    athenaDrawsMoreThanItLosesToAres:true,
    athenaDrawsAresMoreThanArtemisDoes:true,
    athenaLosesLessToAresThanArtemisDoes:true,
    artemisScoresBetterAgainstAresThanAthenaDoes:true,
    athenaHighestSiblingDrawRate:true,
    artemisTopOverall:true,
  }),

  // Personality remains visible in game duration as well as W/D/L shape.
  athenaPlayedMoveRatioToArtemisCurrent:3.0,
  aresPlayedMoveRatioToArtemisCurrent:0.5,
  moveRatioTolerance:0.25,
};
function scoreFloorSatisfied(score,target){
  return target.scoreFloorExclusive
    ?score>target.minScore:score+1e-12>=target.minScore;
}
for(const key of ['athenaVsCurrent','aresVsCurrent','artemisVsCurrent']){
  const target=targets[key];
  if(target.minScore!==0.85||target.scoreFloorExclusive!==true||target.maxScore!==1.0){
    throw new Error(key+' must require a score strictly above 85% against current v5.5');
  }
  if(scoreFloorSatisfied(0.85,target)||!scoreFloorSatisfied(0.855,target)){
    throw new Error(key+' must reject exactly 85% and accept scores above 85%');
  }
}
const games=Math.max(0,Number.parseInt(process.env.GAMES||'12',10)||0);
const armxTimingSamples=Math.max(12,Number.parseInt(process.env.ARMX_TIMING_SAMPLES||'40',10)||40);
const startIndex=Math.max(0,Number.parseInt(process.env.START_INDEX||'0',10)||0);
const only=process.env.MATCHUP||'';
if(only&&!definitions[only])throw new Error('Unknown MATCHUP '+only);
if(process.env.RELEASE_GATE==='1'&&(games<100||games%2!==0||only))throw new Error('Range release proof requires all six matchups with at least 100 color-balanced games each');

const results={};
for(const [key,args] of Object.entries(definitions)){
  if(only&&key!==only)continue;
  results[key]=matchup(games,...args,startIndex);
}

// Developer-only Artemis decomposition. It runs only in the Artemis/current
// diagnostic job and never participates in release gates.
let artemisDecomposition=null;
if(only==='artemisVsCurrent'&&games>0){
  const diagnosticGames=Math.max(2,Math.min(6,games-(games%2)));
  artemisDecomposition={
    games:diagnosticGames,
    fullPolicyPreviewReview:matchup(
      diagnosticGames,'diag-FullPolicy-PreviewReview',
      getStonefishV55DiagFullPolicyPreviewReviewMove,getStonefishV55Move,startIndex
    ),
    previewPolicyFullReview:matchup(
      diagnosticGames,'diag-PreviewPolicy-FullReview',
      getStonefishV55DiagPreviewPolicyFullReviewMove,getStonefishV55Move,startIndex
    ),
  };
}
const ratios=results.athenaVsCurrent&&results.aresVsCurrent&&results.artemisVsCurrent?{
  athenaToArtemis:results.athenaVsCurrent.averagePlayedMoves/results.artemisVsCurrent.averagePlayedMoves,
  aresToArtemis:results.aresVsCurrent.averagePlayedMoves/results.artemisVsCurrent.averagePlayedMoves,
}:null;

function complementScore(row){return row?1-row.score:0;}
function rate(row,key){return row&&games?row[key]/games:0;}
function average(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
function preferredDistance(row,target){
  if(!row||!target||!games)return null;
  const scale=100/games;
  return Math.abs(row.win*scale-target.win)
    +Math.abs(row.loss*scale-target.loss)
    +Math.abs(row.draw*scale-target.draw);
}

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

const preferredWLDDeviation=Object.fromEntries(
  Object.entries(targets.preferredSiblingWLD).map(([key,target])=>[
    key,
    results[key]?preferredDistance(results[key],target):null,
  ])
);

const armxAttributedOverhead=armxAttributedOverheadBenchmark(armxTimingSamples);

const result={
  model:'Stonefish v5.5 Full ARMX range',
  gamesPerMatchup:games,startIndex,
  sourceHashes,
  armx:ARMX_FULL,range:STONEFISH_V5_5_RANGE,targets,ratios,relationships,
  armxAttributedOverhead,artemisDecomposition,preferredWLDDeviation,matchups:results
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
    const passesScoreFloor=scoreFloorSatisfied(row.score,target);
    const comparator=target.scoreFloorExclusive?'>':'>=';
    requireGate(passesScoreFloor,
      key+' failed score floor: '+row.win+'W-'+row.loss+'L-'+row.draw+'D; need score '+comparator+(target.minScore*100)+'%');
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
    if(!target||typeof target!=='object'||Array.isArray(target)||key==='relationships'||key==='preferredSiblingWLD')continue;
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
  requireGate(results.artemisVsCurrent.score>results.athenaVsCurrent.score
      && results.artemisVsCurrent.score>results.aresVsCurrent.score,
    'Artemis must be the best default against current v5.5: Artemis '
      +results.artemisVsCurrent.score+', Athena '+results.athenaVsCurrent.score
      +', Ares '+results.aresVsCurrent.score);
  requireGate(results.artemisVsCurrent.score-results.athenaVsCurrent.score
      <=targets.relationships.maxArtemisCurrentLead
      && results.artemisVsCurrent.score-results.aresVsCurrent.score
      <=targets.relationships.maxArtemisCurrentLead,
    'Artemis current-v5.5 lead must stay modest');

  requireGate(armxAttributedOverhead.preview.attributedAverageMs>0,
    'ARMX Preview attributed overhead timing must be positive');
  for(const [style,overheadRatio] of Object.entries(armxAttributedOverhead.ratio)){
    requireGate(Number.isFinite(overheadRatio)
        &&overheadRatio<=targets.relationships.maxFullArmxAttributedOverheadToPreviewOverheadRatio,
      style+' Full ARMX overhead is too slow: '+overheadRatio
        +'x ARMX Preview overhead; need <='
        +targets.relationships.maxFullArmxAttributedOverheadToPreviewOverheadRatio+'x. '
        +'Preview attributed '+armxAttributedOverhead.preview.attributedAverageMs+' ms, Full '
        +armxAttributedOverhead.full[style].attributedAverageMs+' ms');
  }

  const tol=targets.moveRatioTolerance;
  const athenaLow=targets.athenaPlayedMoveRatioToArtemisCurrent*(1-tol);
  const athenaHigh=targets.athenaPlayedMoveRatioToArtemisCurrent*(1+tol);
  const aresLow=targets.aresPlayedMoveRatioToArtemisCurrent*(1-tol);
  const aresHigh=targets.aresPlayedMoveRatioToArtemisCurrent*(1+tol);
  requireGate(ratios&&ratios.athenaToArtemis>=athenaLow&&ratios.athenaToArtemis<=athenaHigh,
    'Athena survival-length identity failed: '+(ratios&&ratios.athenaToArtemis)+'x; rough target '
      +targets.athenaPlayedMoveRatioToArtemisCurrent+'x');
  requireGate(ratios&&ratios.aresToArtemis>=aresLow&&ratios.aresToArtemis<=aresHigh,
    'Ares speed identity failed: '+(ratios&&ratios.aresToArtemis)+'x; rough target '
      +targets.aresPlayedMoveRatioToArtemisCurrent+'x');
}
