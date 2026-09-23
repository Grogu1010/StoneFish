// ARMX — full per-game opponent adaptation for the Stonefish v5.5 range.
//
// Full ARMX has one job: observe this opponent, keep better notes than Preview,
// and use those notes to make better decisions. It is not a second chess
// evaluator and it does not contain generic conversion or matchup heuristics.
//
// All three v5.5 range models use this exact Full ARMX. Artemis has no style
// adjustment at all. Athena and Ares differ only through numeric style profiles
// applied to objectively close finalists after the shared Full-ARMX decision.

const ARMX_FULL_NOTE_FEATURES = Object.freeze([
  'capture','trade','rookTrade','queenTrade','minorTrade','simplify',
  'check','kingAttack','pawnPush','castle','quiet','advance','retreat',
  'forcing','promotion','center','kingside','queenside','centralize',
  'development','pawnMove','knightMove','bishopMove','rookMove','queenMove','kingMove'
]);
const ARMX_FULL_CONTEXT_FEATURES = Object.freeze([
  'capture','trade','simplify','check','kingAttack','pawnPush','castle','quiet','advance','retreat'
]);

const ARMX_FULL = Object.freeze({
  name: 'ARMX',
  version: '2.0-full-notebook',
  kind: 'opponent-adaptation',
  reset: 'per-game',

  // No evidence means no free strength bump: Full ARMX begins from the current
  // v5.5 host budget/width and earns extra analysis only from opponent evidence.
  candidateLimit: 8,
  baseSearchNodes: 1200,
  maxEvidenceSearchNodes: 30000,
  maxSurpriseSearchNodes: 9000,
  maxExtraNodes: 42000,
  baseDepth: 4,
  maxEvidenceDepth: 8,
  maxExtraDepth: 4,
  baseRootWidth: 3,
  maxRootWidth: 8,
  matureOpponentMoves: 10,
  minChoiceEvidence: 2,
  minEffectEvidence: 1.25,
  fullConfidenceEvidence: 8,

  previewDecisionGain: 1.35,
  fullDecisionGain: 2.30,
  fullNoteScale: 190,
  maxNoteAdjustment: 240,
  maxHostGap: 92,
  maxDeepSacrifice: 72,

  // Compatibility fields used by benchmark assertions. Artemis is exactly zero.
  styleScale: Object.freeze({athena: 20, ares: 22, artemis: 0}),
  maxStyleAdjustment: Object.freeze({athena: 155, ares: 155, artemis: 0}),

  // Athena/Ares are the same model with different numbers. The shared style
  // function below interprets these vectors; Artemis's vector is all zero.
  styleProfiles: Object.freeze({
    artemis: Object.freeze({
      weights: Object.freeze({}),
      baseScale: 0, earlyBoost: 0, lateBoost: 0, paceTargetPlies: 1,
      aheadScale: 0, behindScale: 0, maxHostGap: 92, maxDeepSacrifice: 72,
    }),
    athena: Object.freeze({
      weights: Object.freeze({
        capture:-1.05, trade:-1.55, rookTrade:-1.20, queenTrade:-1.45,
        minorTrade:-1.05, simplify:-1.45, check:-0.62, kingAttack:-0.72,
        pawnPush:0.32, castle:1.55, quiet:1.55, advance:-0.30, retreat:0.95,
        forcing:-0.62, promotion:0.10, center:0.16, kingside:0.12,
        queenside:0.12, centralize:0.20, development:0.22, pawnMove:0.18,
        knightMove:0.12, bishopMove:0.12, rookMove:0.04, queenMove:-0.08, kingMove:0.18,
      }),
      baseScale:20, earlyBoost:2.35, lateBoost:-0.55, paceTargetPlies:260,
      aheadScale:0.30, behindScale:0.65, maxHostGap:78, maxDeepSacrifice:58,
    }),
    ares: Object.freeze({
      weights: Object.freeze({
        capture:1.55, trade:0.72, rookTrade:0.82, queenTrade:0.68,
        minorTrade:0.62, simplify:0.72, check:1.48, kingAttack:1.38,
        pawnPush:0.40, castle:-0.08, quiet:-1.08, advance:0.58, retreat:-1.28,
        forcing:1.12, promotion:1.80, center:0.20, kingside:0.34,
        queenside:0.18, centralize:0.24, development:0.16, pawnMove:0.18,
        knightMove:0.10, bishopMove:0.12, rookMove:0.18, queenMove:0.20, kingMove:-0.18,
      }),
      baseScale:22, earlyBoost:0.10, lateBoost:2.10, paceTargetPlies:42,
      aheadScale:0.72, behindScale:0.30, maxHostGap:86, maxDeepSacrifice:66,
    }),
  }),
});

const ARMX_FULL_GAME_NOTES = new WeakMap();
const ARMX_FULL_LAST = Object.create(null);

function armxFullClamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
function armxFullAverage(values) {
  return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
}
function armxFullFreshCounts() {
  return Object.fromEntries(ARMX_FULL_NOTE_FEATURES.map(feature=>[feature,0]));
}
function armxFullFreshEffects() {
  return Object.fromEntries(ARMX_FULL_NOTE_FEATURES.map(feature=>[
    feature,{weight:0,impact:0,observations:new Set()}
  ]));
}
function armxFullPieceFeature(piece) {
  return piece===1?'pawnMove':piece===2?'knightMove':piece===3?'bishopMove'
    :piece===4?'rookMove':piece===5?'queenMove':piece===6?'kingMove':null;
}
function armxFullSquareCenterDistance(square) {
  const file=square&7, rank=square>>3;
  return Math.abs(file-3.5)+Math.abs(rank-3.5);
}
function armxFullMoveFeatures(game, move) {
  const features = new Set(armxPreviewFeatureSet(game, move));
  if (!move) return features;
  const piece = move.piece || Math.abs(game.boardState[move.from] || 0);
  const pieceFeature = armxFullPieceFeature(piece);
  if (pieceFeature) features.add(pieceFeature);
  if (piece===1) features.add('pawnMove');
  if (move.promotion) features.add('promotion');
  if (features.has('capture') || features.has('check') || move.promotion) features.add('forcing');

  const file=move.to&7, rank=move.to>>3;
  if (file>=2&&file<=5&&rank>=2&&rank<=5) features.add('center');
  if (file>=4) features.add('kingside');
  else features.add('queenside');
  if (armxFullSquareCenterDistance(move.to)+0.25<armxFullSquareCenterDistance(move.from)) {
    features.add('centralize');
  }
  const side=game.side;
  const fromRank=side===1?(move.from>>3):7-(move.from>>3);
  if ((piece===2||piece===3) && fromRank===0) features.add('development');
  return features;
}
function armxFullCheapMoveFeatures(move, side) {
  const features = new Set(armxPreviewCheapFeatureSet(move));
  if (!move) return features;
  const piece=move.piece||0;
  const pieceFeature=armxFullPieceFeature(piece);
  if(pieceFeature)features.add(pieceFeature);
  if(piece===1){features.add('pawnPush');features.add('pawnMove');}
  if(move.promotion){features.add('promotion');features.add('forcing');}
  if(move.captured)features.add('forcing');
  if(move.flags&(4|8))features.add('castle');

  const fromRank=side===1?(move.from>>3):7-(move.from>>3);
  const toRank=side===1?(move.to>>3):7-(move.to>>3);
  if(toRank>fromRank)features.add('advance');
  if(toRank<fromRank)features.add('retreat');
  const file=move.to&7, rank=move.to>>3;
  if(file>=2&&file<=5&&rank>=2&&rank<=5)features.add('center');
  if(file>=4)features.add('kingside');else features.add('queenside');
  if(armxFullSquareCenterDistance(move.to)+0.25<armxFullSquareCenterDistance(move.from))features.add('centralize');
  if((piece===2||piece===3)&&fromRank===0)features.add('development');
  return features;
}
function armxFullEffectValue(row) {
  if (!row || row.weight < ARMX_FULL.minEffectEvidence) return {value:0,evidence:row?row.weight:0};
  return {value:row.impact/row.weight,evidence:row.weight};
}
function armxFullRecordEffect(bucket, features, impact, weight, observationId) {
  const normalized=armxFullClamp(impact/360,-1,1);
  for(const feature of features){
    const row=bucket[feature];
    if(!row)continue;
    row.weight+=weight;
    row.impact+=normalized*weight;
    row.observations.add(observationId);
  }
}
function armxFullResponseKey(contextFeature, replyFeature) {
  return contextFeature+'>'+replyFeature;
}
function armxFullResponseRow(book,key) {
  let row=book.responseEffects[key];
  if(!row)row=book.responseEffects[key]={weight:0,impact:0,observations:new Set()};
  return row;
}
function armxFullRecordResponseEffect(book, pairKeys, impact, weight, observationId) {
  const normalized=armxFullClamp(impact/360,-1,1);
  for(const key of pairKeys){
    const row=armxFullResponseRow(book,key);
    row.weight+=weight;
    row.impact+=normalized*weight;
    row.observations.add(observationId);
  }
}
function armxFullNewNotebook(perspective, game, observationStartPly) {
  const seed=armxPreviewNewProfile(perspective, game, observationStartPly);
  return {
    perspective,
    observationStartPly,
    processedPlies:0,
    lastHistoryState:null,
    initialPositionKey:seed.initialPositionKey,
    replay:seed.replay,
    currentSnapshot:seed.currentSnapshot,
    opponentMoves:0,
    opportunities:armxFullFreshCounts(),
    choices:armxFullFreshCounts(),
    opportunityPlies:Object.fromEntries(ARMX_FULL_NOTE_FEATURES.map(feature=>[feature,new Set()])),
    ourEffects:armxFullFreshEffects(),
    opponentEffects:armxFullFreshEffects(),
    responseOpportunities:Object.create(null),
    responseChoices:Object.create(null),
    responseEffects:Object.create(null),
    pending:[],
    lastOurFeatures:new Set(),
    surpriseSum:0,
    surpriseWeight:0,
  };
}
function armxFullResolvePending(book,currentPly,currentSnapshot=book.currentSnapshot){
  if(!book.pending.length)return;
  const now=(currentSnapshot||book.currentSnapshot).score;
  const keep=[];
  for(const event of book.pending){
    if(currentPly<event.resolveAt){keep.push(event);continue;}
    const impact=now-event.before;
    armxFullRecordEffect(
      event.actor===book.perspective?book.ourEffects:book.opponentEffects,
      event.features,impact,event.weight,event.observationId
    );
    if(event.pairKeys&&event.pairKeys.length){
      armxFullRecordResponseEffect(book,event.pairKeys,impact,event.weight,event.observationId);
    }
  }
  book.pending=keep;
}
function armxFullChoiceRate(book,feature){
  const opportunities=book.opportunities[feature]||0;
  if(!opportunities)return {rate:0.5,evidence:0};
  return {
    rate:((book.choices[feature]||0)+1)/(opportunities+2),
    evidence:opportunities,
  };
}
function armxFullConditionalRate(book,contextFeature,replyFeature){
  const key=armxFullResponseKey(contextFeature,replyFeature);
  const opportunities=book.responseOpportunities[key]||0;
  if(!opportunities)return {rate:0.5,evidence:0};
  return {
    rate:((book.responseChoices[key]||0)+1)/(opportunities+2),
    evidence:opportunities,
  };
}
function armxFullResponseEffect(book,contextFeature,replyFeature){
  return armxFullEffectValue(book.responseEffects[armxFullResponseKey(contextFeature,replyFeature)]);
}
function armxFullObserveOpponent(book,game,chosenMove,index){
  const legal=game.fastMoves();
  const availableByFeature=new Set();
  for(const move of legal){
    const features=armxFullMoveFeatures(game,move);
    for(const feature of features)availableByFeature.add(feature);
  }
  const chosen=armxFullMoveFeatures(game,chosenMove);

  // Surprise is measured before learning this move. It is used only to decide
  // how much extra verification the notes deserve, never as a chess heuristic.
  if(book.opponentMoves>=2){
    const probabilities=[];
    for(const feature of chosen){
      const row=armxFullChoiceRate(book,feature);
      if(row.evidence>=ARMX_FULL.minChoiceEvidence)probabilities.push(row.rate);
    }
    if(probabilities.length){
      const p=armxFullClamp(armxFullAverage(probabilities),0.05,0.95);
      book.surpriseSum+=-Math.log(p);
      book.surpriseWeight+=1;
    }
  }

  book.opponentMoves++;
  for(const feature of availableByFeature){
    book.opportunities[feature]=(book.opportunities[feature]||0)+1;
    book.opportunityPlies[feature].add(index);
    if(chosen.has(feature))book.choices[feature]=(book.choices[feature]||0)+1;
  }

  const pairKeys=[];
  for(const contextFeature of book.lastOurFeatures){
    if(!ARMX_FULL_CONTEXT_FEATURES.includes(contextFeature))continue;
    for(const replyFeature of availableByFeature){
      const key=armxFullResponseKey(contextFeature,replyFeature);
      book.responseOpportunities[key]=(book.responseOpportunities[key]||0)+1;
      if(chosen.has(replyFeature))book.responseChoices[key]=(book.responseChoices[key]||0)+1;
    }
    for(const replyFeature of chosen){
      pairKeys.push(armxFullResponseKey(contextFeature,replyFeature));
    }
  }
  return {chosen,pairKeys};
}
function armxFullSyncNotebook(game,perspective=game.side){
  let books=ARMX_FULL_GAME_NOTES.get(game);
  if(!books){books=new Map();ARMX_FULL_GAME_NOTES.set(game,books);}
  const history=game.historyStack||[];
  const observationStartPly=Math.max(0,Math.trunc(Number(game.armxObservationStartPly)||0));
  let book=books.get(perspective);
  const changedHistory=book&&book.processedPlies>0
    &&history[book.processedPlies-1]!==book.lastHistoryState;
  const changedEmptyPosition=book&&!history.length
    &&game.fastPositionKey()!==book.initialPositionKey;
  if(!book||history.length<book.processedPlies||changedHistory||changedEmptyPosition
    ||book.observationStartPly!==observationStartPly){
    book=armxFullNewNotebook(perspective,game,observationStartPly);
    books.set(perspective,book);
  }

  while(book.processedPlies<history.length){
    const index=book.processedPlies;
    const state=history[index], move=state&&state.move;
    if(!move)break;
    if(index<observationStartPly){
      book.replay.fastApply(move);
      book.currentSnapshot=armxPreviewStateSnapshot(book.replay,perspective);
      book.processedPlies++;
      book.lastHistoryState=state;
      continue;
    }

    const actor=book.replay.side;
    const before=book.currentSnapshot.score;
    const features=armxFullMoveFeatures(book.replay,move);
    let pairKeys=[];
    if(actor===-perspective){
      const observed=armxFullObserveOpponent(book,book.replay,move,index);
      pairKeys=observed.pairKeys;
    }

    book.pending.push({actor,features,before,observationId:index,resolveAt:index+2,weight:0.65,pairKeys});
    book.pending.push({actor,features,before,observationId:index,resolveAt:index+4,weight:0.35,pairKeys});

    book.replay.fastApply(move);
    book.currentSnapshot=armxPreviewStateSnapshot(book.replay,perspective);
    book.processedPlies++;
    book.lastHistoryState=state;
    armxFullResolvePending(book,book.processedPlies,book.currentSnapshot);

    if(actor===perspective)book.lastOurFeatures=new Set(features);
  }
  armxFullResolvePending(book,book.processedPlies,book.currentSnapshot);
  return book;
}
function armxFullNotebookMaturity(book){
  const moveMaturity=armxFullClamp(book.opponentMoves/ARMX_FULL.matureOpponentMoves,0,1);
  let informed=0;
  for(const feature of ARMX_FULL_NOTE_FEATURES){
    if((book.opportunities[feature]||0)>=ARMX_FULL.minChoiceEvidence)informed++;
    const effect=book.opponentEffects[feature];
    if(effect&&effect.weight>=ARMX_FULL.minEffectEvidence)informed+=0.5;
  }
  const breadth=armxFullClamp(informed/12,0,1);
  return armxFullClamp(moveMaturity*0.65+breadth*0.35,0,1);
}
function armxFullNotebookSummary(book){
  const rows=[];
  for(const feature of ARMX_FULL_NOTE_FEATURES){
    const choice=armxFullChoiceRate(book,feature);
    const effect=armxFullEffectValue(book.opponentEffects[feature]);
    const importance=Math.abs(choice.rate-0.5)*Math.min(1,choice.evidence/6)
      +Math.abs(effect.value)*Math.min(1,effect.evidence/4);
    if(importance>0.10)rows.push({feature,choiceRate:choice.rate,choiceEvidence:choice.evidence,
      effect:effect.value,effectEvidence:effect.evidence,importance});
  }
  rows.sort((a,b)=>b.importance-a.importance);
  return rows.slice(0,10);
}
function armxFullPolicyFeatureScore(book,features){
  let score=0,evidence=0;
  for(const feature of features){
    const row=armxFullChoiceRate(book,feature);
    if(row.evidence<ARMX_FULL.minChoiceEvidence)continue;
    const confidence=armxFullClamp(row.evidence/8,0,1);
    score+=(row.rate-0.5)*confidence;
    evidence+=confidence;
  }
  return evidence?score/Math.sqrt(evidence):0;
}
function armxFullOpponentPolicy(game,perspective=game.side,_style='artemis'){
  // style is deliberately ignored: all three models receive the same Full ARMX.
  const previewProfile=armxPreviewSyncProfile(game,perspective);
  const book=armxFullSyncNotebook(game,perspective);
  const maturity=armxFullNotebookMaturity(book);
  const surprise=book.surpriseWeight
    ?armxFullClamp((book.surpriseSum/book.surpriseWeight-0.35)/1.2,0,1):0;

  const searchBudget=Math.round(
    ARMX_FULL.baseSearchNodes
    +ARMX_FULL.maxEvidenceSearchNodes*maturity
    +ARMX_FULL.maxSurpriseSearchNodes*surprise*maturity
  );
  const rootWidth=ARMX_FULL.baseRootWidth
    +Math.round((ARMX_FULL.maxRootWidth-ARMX_FULL.baseRootWidth)*maturity);
  const maxDepth=Math.round(
    ARMX_FULL.baseDepth+(ARMX_FULL.maxEvidenceDepth-ARMX_FULL.baseDepth)*maturity
  );

  const preview=armxPreviewOpponentPolicy(game,perspective);
  const previewWeights=preview&&preview.weights?new Float64Array(preview.weights):new Float64Array(13);
  const cache=new Map();
  const side=-perspective;
  const notePriority=move=>{
    const key=move.from|(move.to<<6)|((move.piece||0)<<12)|((move.promotion||0)<<15)|((move.flags||0)<<18);
    if(cache.has(key))return cache.get(key);
    const value=Math.round(520*armxFullPolicyFeatureScore(book,armxFullCheapMoveFeatures(move,side)));
    cache.set(key,value);
    return value;
  };
  const previewPriority=preview&&typeof preview.priority==='function'?preview.priority:()=>0;

  return {
    model:ARMX_FULL.name,
    version:ARMX_FULL.version,
    observations:book.opponentMoves,
    maturity,
    noteBreadth:armxFullNotebookSummary(book).length,
    searchBudget,
    maxDepth,
    maxExtraNodes:ARMX_FULL.maxExtraNodes,
    maxExtraDepth:ARMX_FULL.maxExtraDepth,
    rootWidth,
    predictionSurprise:surprise,
    weights:previewWeights,
    priority:move=>previewPriority(move)+notePriority(move),
    isLowPriority:move=>{
      const previewLow=preview&&typeof preview.isLowPriority==='function'&&preview.isLowPriority(move);
      return previewLow||notePriority(move)<-80;
    },
  };
}
function armxFullCandidateResponseReport(game,entry,book){
  const historyDepth=game.historyStack.length;
  const contextFeatures=armxFullMoveFeatures(game,entry.raw);
  let expectedOutcome=0,preferenceSignal=0,evidence=0,replyCount=0;
  try{
    game.fastApply(entry.raw);
    const replies=game.fastMoves();
    const rows=[];
    for(const reply of replies){
      const features=armxFullMoveFeatures(game,reply);
      let preference=0,preferenceEvidence=0,outcome=0,outcomeEvidence=0;
      for(const feature of features){
        const choice=armxFullChoiceRate(book,feature);
        if(choice.evidence>=ARMX_FULL.minChoiceEvidence){
          const confidence=armxFullClamp(choice.evidence/8,0,1);
          preference+=(choice.rate-0.5)*confidence;
          preferenceEvidence+=confidence;
        }
        const effect=armxFullEffectValue(book.opponentEffects[feature]);
        if(effect.evidence>=ARMX_FULL.minEffectEvidence){
          const confidence=armxFullClamp(effect.evidence/6,0,1);
          outcome+=effect.value*confidence;
          outcomeEvidence+=confidence;
        }
        for(const contextFeature of contextFeatures){
          if(!ARMX_FULL_CONTEXT_FEATURES.includes(contextFeature))continue;
          const conditional=armxFullConditionalRate(book,contextFeature,feature);
          if(conditional.evidence>=ARMX_FULL.minChoiceEvidence){
            const confidence=armxFullClamp(conditional.evidence/6,0,1);
            preference+=(conditional.rate-0.5)*0.85*confidence;
            preferenceEvidence+=0.85*confidence;
          }
          const pairEffect=armxFullResponseEffect(book,contextFeature,feature);
          if(pairEffect.evidence>=ARMX_FULL.minEffectEvidence){
            const confidence=armxFullClamp(pairEffect.evidence/5,0,1);
            outcome+=pairEffect.value*0.85*confidence;
            outcomeEvidence+=0.85*confidence;
          }
        }
      }
      if(preferenceEvidence)preference/=Math.sqrt(preferenceEvidence);
      if(outcomeEvidence)outcome/=Math.sqrt(outcomeEvidence);
      rows.push({preference,outcome,evidence:preferenceEvidence+outcomeEvidence});
    }
    if(rows.length){
      const maxPreference=Math.max(...rows.map(row=>row.preference*1.4));
      let sum=0;
      for(const row of rows){
        const weight=Math.exp(row.preference*1.4-maxPreference);
        sum+=weight;
        expectedOutcome+=weight*row.outcome;
        preferenceSignal+=weight*row.preference;
        evidence+=weight*row.evidence;
      }
      if(sum){
        expectedOutcome/=sum;
        preferenceSignal/=sum;
        evidence/=sum;
      }
      replyCount=rows.length;
    }
  }finally{
    while(game.historyStack.length>historyDepth)game.fastUndo();
  }

  // Also remember whether our own comparable moves have historically worked.
  let ownOutcome=0,ownEvidence=0;
  for(const feature of contextFeatures){
    const effect=armxFullEffectValue(book.ourEffects[feature]);
    if(effect.evidence<ARMX_FULL.minEffectEvidence)continue;
    const confidence=armxFullClamp(effect.evidence/6,0,1);
    ownOutcome+=effect.value*confidence;
    ownEvidence+=confidence;
  }
  if(ownEvidence)ownOutcome/=Math.sqrt(ownEvidence);

  return {
    contextFeatures:Array.from(contextFeatures),
    expectedOpponentOutcome:expectedOutcome,
    opponentPreferenceSignal:preferenceSignal,
    ownOutcome,
    evidence:evidence+ownEvidence,
    replyCount,
  };
}
function armxFullStyleAdjustment(game,entry,features,style,hostBest){
  const profile=ARMX_FULL.styleProfiles[style]||ARMX_FULL.styleProfiles.artemis;
  if(!profile.baseScale)return {signal:0,scale:0,adjustment:0};
  let signal=0;
  for(const feature of features)signal+=(profile.weights[feature]||0);

  const observedPlies=Math.max(0,(game.historyStack?game.historyStack.length:0)
    -Math.max(0,Math.trunc(Number(game.armxObservationStartPly)||0)));
  const target=Math.max(1,profile.paceTargetPlies);
  const phase=observedPlies/target;
  const paceMultiplier=1
    +profile.earlyBoost*Math.max(0,1-phase)
    +profile.lateBoost*Math.max(0,phase-1);

  const hostScore=Number(hostBest&&hostBest.score)||0;
  const ahead=armxFullClamp(hostScore/700,0,1);
  const behind=armxFullClamp(-hostScore/700,0,1);
  const positionMultiplier=1+profile.aheadScale*ahead+profile.behindScale*behind;
  const scale=profile.baseScale*Math.max(0.15,paceMultiplier)*positionMultiplier;
  const max=ARMX_FULL.maxStyleAdjustment[style]||0;
  return {signal,scale,adjustment:armxFullClamp(signal*scale,-max,max)};
}
function armxFullMateScale(entry){
  if(!entry)return false;
  const mate=typeof STONEFISH_V5_PRO_MATE==='number'?STONEFISH_V5_PRO_MATE
    :(typeof STONEFISH_V5_MATE==='number'?STONEFISH_V5_MATE:20000000);
  return (Number.isFinite(entry.deep)&&Math.abs(entry.deep)>=mate*0.9)
    ||(Number.isFinite(entry.score)&&Math.abs(entry.score)>=mate*0.9);
}
function armxFullReview(game,finished,style='artemis',perspective=game.side){
  const previewProfile=armxPreviewSyncProfile(game,perspective);
  const book=armxFullSyncNotebook(game,perspective);
  const maturity=armxFullNotebookMaturity(book);
  const candidates=(finished||[]).filter(entry=>entry&&Number.isFinite(entry.score))
    .slice(0,ARMX_FULL.candidateLimit);
  if(!candidates.length)return {reports:[],winner:null,book,maturity};

  const hostBest=candidates[0];
  const reports=candidates.map(entry=>{
    const previewReport=armxPreviewCandidateReport(game,entry,previewProfile);
    const response=armxFullCandidateResponseReport(game,entry,book);

    // Every universal adjustment below is derived from observations of this
    // opponent. With zero evidence, Artemis returns the host move unchanged.
    const previewAdjustment=(Number(previewReport.adjustment)||0)
      *ARMX_FULL.previewDecisionGain*maturity;
    const noteConfidence=armxFullClamp(response.evidence/ARMX_FULL.fullConfidenceEvidence,0,1);
    const learnedSignal=response.ownOutcome+response.expectedOpponentOutcome
      +0.22*response.opponentPreferenceSignal;
    const noteAdjustment=armxFullClamp(
      learnedSignal*ARMX_FULL.fullNoteScale*noteConfidence*maturity,
      -ARMX_FULL.maxNoteAdjustment,ARMX_FULL.maxNoteAdjustment
    );
    const adaptiveAdjustment=previewAdjustment+noteAdjustment;

    const styleResult=armxFullStyleAdjustment(
      game,entry,response.contextFeatures,style,hostBest
    );
    const hostGap=hostBest.score-entry.score;
    const deepSacrifice=Number.isFinite(hostBest.deep)&&Number.isFinite(entry.deep)
      ?hostBest.deep-entry.deep:hostGap;
    const styleProfile=ARMX_FULL.styleProfiles[style]||ARMX_FULL.styleProfiles.artemis;
    const allowedHostGap=style==='artemis'
      ?ARMX_FULL.maxHostGap
      :styleProfile.maxHostGap;
    const allowedDeepSacrifice=style==='artemis'
      ?ARMX_FULL.maxDeepSacrifice
      :styleProfile.maxDeepSacrifice;
    const protectedTruth=armxFullMateScale(hostBest)||armxFullMateScale(entry);
    const eligible=entry===hostBest||(!protectedTruth
      &&hostGap<=allowedHostGap&&deepSacrifice<=allowedDeepSacrifice);
    const fullScore=eligible
      ?entry.score+adaptiveAdjustment+styleResult.adjustment
      :-Infinity;
    return {
      ...previewReport,
      entry,style,
      notebookResponse:response,
      maturity,
      previewAdjustment,
      noteAdjustment,
      adaptiveAdjustment,
      styleSignal:styleResult.signal,
      styleScale:styleResult.scale,
      styleAdjustment:styleResult.adjustment,
      hostGap,deepSacrifice,allowedHostGap,allowedDeepSacrifice,eligible,fullScore,
    };
  });
  reports.sort((a,b)=>b.fullScore-a.fullScore
    ||b.hostScore-a.hostScore
    ||String(a.entry.uci).localeCompare(String(b.entry.uci)));

  return {
    model:ARMX_FULL.name,
    version:ARMX_FULL.version,
    style,
    reset:ARMX_FULL.reset,
    opponentMoves:book.opponentMoves,
    maturity,
    notes:armxFullNotebookSummary(book),
    reports,
    winner:reports.length?reports[0].entry:hostBest,
  };
}
function armxFullRankHost(game,host,style='artemis'){
  const finished=host&&Array.isArray(host.finished)?host.finished:[];
  if(!finished.length){ARMX_FULL_LAST[style]=null;return finished;}
  const original=finished[0];
  const review=armxFullReview(game,finished,style,game.side);
  const winner=review.winner||original;
  const index=finished.indexOf(winner);
  if(index>0){finished.splice(index,1);finished.unshift(winner);}
  ARMX_FULL_LAST[style]={
    ...review,
    searchBudget:host.searchBudget,
    searchDepth:host.depth,
    depthLimit:host.depthLimit,
    rootWidth:host.rootWidth||ARMX_FULL.baseRootWidth,
    changedMove:Boolean(original&&winner&&!stonefishV5SameMove(original.raw,winner.raw)),
    provisionalRaw:original&&original.raw,
    recommendedRaw:winner&&winner.raw,
  };
  return finished;
}
function armxFullLast(style='artemis'){
  return ARMX_FULL_LAST[style]||null;
}

if(typeof globalThis!=='undefined'){
  globalThis.ARMX_FULL=ARMX_FULL;
  globalThis.armxFullSyncNotebook=armxFullSyncNotebook;
  globalThis.armxFullOpponentPolicy=armxFullOpponentPolicy;
  globalThis.armxFullReview=armxFullReview;
  globalThis.armxFullRankHost=armxFullRankHost;
  globalThis.armxFullLast=armxFullLast;
}
