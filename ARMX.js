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
  candidateLimit: 3,
  baseSearchNodes: 1200,
  maxEvidenceSearchNodes: 2400,
  maxSurpriseSearchNodes: 600,
  maxExtraNodes: 3600,
  baseDepth: 4,
  maxEvidenceDepth: 6,
  maxExtraDepth: 2,
  baseRootWidth: 3,
  maxRootWidth: 4,
  matureOpponentMoves: 10,
  minChoiceEvidence: 2,
  minEffectEvidence: 1.25,
  fullConfidenceEvidence: 14,
  predictedReplyLimit: 10,
  fullNoteMinEvidence: 7,
  fullNoteMinConfidence: 0.72,
  fullNoteMinDecisionLead: 2,
  fullNoteMinPositiveSignal: 0.05,
  fullNoteStrongAvoidSignal: -0.18,
  fullNoteEarlyPlies: 20,
  fullNoteEarlyEvidence: 10,
  fullNoteEarlyConfidence: 0.90,

  // Full ARMX is its own notebook rather than Preview plus another layer.
  // These retained fields are telemetry/compatibility only.
  previewDecisionGain: 0,
  fullDecisionGain: 1.00,
  fullNoteScale: 135,
  maxNoteAdjustment: 120,
  maxHostGap: 40,
  maxDeepSacrifice: 32,

  // Compatibility fields used by benchmark assertions. Artemis is exactly zero.
  styleScale: Object.freeze({athena: 20, ares: 23, artemis: 0}),
  maxStyleAdjustment: Object.freeze({athena: 380, ares: 280, artemis: 0}),

  // Athena/Ares are the same model with different numbers. The shared style
  // function below interprets these vectors; Artemis's vector is all zero.
  styleProfiles: Object.freeze({
    artemis: Object.freeze({
      weights: Object.freeze({}),
      aheadWeights: Object.freeze({}), behindWeights: Object.freeze({}),
      baseScale:0, earlyBoost:0, lateBoost:0, paceTargetPlies:1,
      aheadScale:0, behindScale:0, replyCompressionWeight:0, capturedValueWeight:0,
      repetitionWeight:0, aheadRepetitionWeight:0, behindRepetitionWeight:0,
      advantageDelayWeight:0, pawnClockResetWeight:0, aheadCandidateFloor:-1000000000,
      patientOpponentScale:0, aggressiveOpponentScale:0,
      aheadHostGapBonus:0, aheadDeepGapBonus:0, behindHostGapBonus:0,
      maxHostGap:40, maxDeepSacrifice:32,
    }),
    athena: Object.freeze({
      weights: Object.freeze({
        capture:-1.80, trade:-2.60, rookTrade:-2.10, queenTrade:-2.45,
        minorTrade:-1.90, simplify:-2.50, check:-1.00, kingAttack:-1.20,
        pawnPush:0.68, castle:1.85, quiet:2.45, advance:-0.46, retreat:1.55,
        forcing:-1.05, promotion:0.10, center:0.18, kingside:0.12,
        queenside:0.12, centralize:0.22, development:0.25, pawnMove:0.42,
        knightMove:0.12, bishopMove:0.12, rookMove:0.04, queenMove:-0.08, kingMove:0.24,
      }),
      aheadWeights:Object.freeze({
        capture:-0.35,trade:-0.55,simplify:-0.60,queenTrade:-0.50,
        quiet:0.35,retreat:0.25,pawnPush:0.18,
      }),
      // When the host says Athena is worse, defensive play means converting
      // danger into a drawable ending rather than blindly preserving material.
      behindWeights:Object.freeze({
        capture:1.05,trade:1.65,rookTrade:1.20,queenTrade:1.85,minorTrade:1.00,
        simplify:1.70,check:0.18,kingAttack:0.10,quiet:-0.48,retreat:0.35,castle:0.48,
      }),
      baseScale:20, earlyBoost:5.00, lateBoost:-0.76, paceTargetPlies:260,
      aheadScale:1.55, behindScale:0.78, replyCompressionWeight:-2.20, capturedValueWeight:-1.55,
      repetitionWeight:0.10, aheadRepetitionWeight:-1.00, behindRepetitionWeight:5.00,
      advantageDelayWeight:5.00, pawnClockResetWeight:3.20, aheadCandidateFloor:70,
      patientOpponentScale:0.04, aggressiveOpponentScale:0.65,
      aheadHostGapBonus:400, aheadDeepGapBonus:280, behindHostGapBonus:16,
      maxHostGap:60, maxDeepSacrifice:45,
    }),
    ares: Object.freeze({
      weights: Object.freeze({
        capture:3.00, trade:2.00, rookTrade:2.05, queenTrade:1.90,
        minorTrade:1.70, simplify:2.45, check:0.55, kingAttack:0.88,
        pawnPush:0.52, castle:-0.14, quiet:-1.85, advance:0.72, retreat:-1.95,
        forcing:1.30, promotion:2.50, center:0.24, kingside:0.38,
        queenside:0.18, centralize:0.26, development:0.18, pawnMove:0.18,
        knightMove:0.12, bishopMove:0.14, rookMove:0.20, queenMove:0.22, kingMove:-0.20,
      }),
      aheadWeights:Object.freeze({
        capture:2.05,trade:1.95,rookTrade:1.55,queenTrade:1.45,minorTrade:1.30,
        simplify:2.35,check:0.18,kingAttack:0.28,quiet:-0.65,retreat:-0.65,
      }),
      behindWeights:Object.freeze({
        capture:0.20,trade:-0.45,simplify:-0.55,check:1.15,kingAttack:1.25,
        forcing:0.90,advance:0.50,quiet:-0.55,retreat:-0.75,
      }),
      baseScale:23, earlyBoost:0.60, lateBoost:3.90, paceTargetPlies:42,
      aheadScale:1.85, behindScale:0.30, replyCompressionWeight:3.10, capturedValueWeight:3.00,
      repetitionWeight:-5.00, aheadRepetitionWeight:-3.00, behindRepetitionWeight:-1.20,
      advantageDelayWeight:0, pawnClockResetWeight:0, aheadCandidateFloor:35,
      patientOpponentScale:1.05, aggressiveOpponentScale:0.02,
      aheadHostGapBonus:220, aheadDeepGapBonus:155, behindHostGapBonus:0,
      maxHostGap:60, maxDeepSacrifice:46,
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
    feature,{weight:0,impact:0,impactSq:0,observations:new Set()}
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
function armxFullPredictiveMoveFeatures(game,move){
  const features=armxFullCheapMoveFeatures(move,game.side);
  if(!move)return features;
  const piece=move.piece||Math.abs(game.boardState[move.from]||0);
  const enemyKing=game.kingSq[-game.side];
  if(piece!==6&&armxPreviewSquareDistance(move.to,enemyKing)<=2){
    features.add('kingAttack');
    features.add('forcing');
  }
  if(!move.captured&&!move.promotion&&!(move.flags&(4|8))
      &&!features.has('kingAttack'))features.add('quiet');
  return features;
}
function armxFullHistoricalMoveFeatures(state,move){
  const side=state&&state.side||1;
  const features=armxFullCheapMoveFeatures(move,side);
  if(!move)return features;
  const piece=move.piece||0;
  const enemyKing=side===1?(state&&state.kingB):state&&state.kingW;
  if(Number.isFinite(enemyKing)&&piece!==6&&armxPreviewSquareDistance(move.to,enemyKing)<=2){
    features.add('kingAttack');
    features.add('forcing');
  }
  if(!move.captured&&!move.promotion&&!(move.flags&(4|8))&&!features.has('kingAttack')){
    features.add('quiet');
  }
  return features;
}
function armxFullNewNotebook(perspective,game,observationStartPly,previewProfile){
  return {
    perspective,
    observationStartPly,
    processedPlies:0,
    lastHistoryState:null,
    initialPositionKey:game.fastPositionKey(),
    opponentMoves:0,
    choices:armxFullFreshCounts(),
    responseContexts:Object.create(null),
    responseChoices:Object.create(null),
    lastOurFeatures:new Set(),
    surpriseSum:0,
    surpriseWeight:0,
    previewProfile:previewProfile||null,
  };
}
function armxFullChoiceRate(book,feature){
  const evidence=book.opponentMoves||0;
  if(!evidence)return {rate:0.5,evidence:0};
  return {rate:((book.choices[feature]||0)+1)/(evidence+2),evidence};
}
function armxFullConditionalRate(book,contextFeature,replyFeature){
  const evidence=book.responseContexts[contextFeature]||0;
  if(!evidence)return {rate:0.5,evidence:0};
  const key=armxFullResponseKey(contextFeature,replyFeature);
  return {rate:((book.responseChoices[key]||0)+1)/(evidence+2),evidence};
}
function armxFullPreviewEffect(book,bucketName,feature){
  const profile=book&&book.previewProfile;
  const bucket=profile&&profile[bucketName];
  if(!bucket||!bucket[feature])return {value:0,evidence:0,consistency:0};
  const effect=armxPreviewEffect(bucket,feature);
  return {value:Number(effect.value)||0,evidence:Number(effect.evidence)||0,consistency:1};
}
function armxFullObserveHistoricalOpponent(book,features,index){
  if(book.opponentMoves>=2){
    const probabilities=[];
    for(const feature of features){
      const row=armxFullChoiceRate(book,feature);
      if(row.evidence>=ARMX_FULL.minChoiceEvidence)probabilities.push(row.rate);
    }
    if(probabilities.length){
      const p=armxFullClamp(armxFullAverage(probabilities),0.05,0.95);
      book.surpriseSum+=-Math.log(p);
      book.surpriseWeight++;
    }
  }

  book.opponentMoves++;
  for(const feature of features)book.choices[feature]=(book.choices[feature]||0)+1;

  for(const contextFeature of book.lastOurFeatures){
    if(!ARMX_FULL_CONTEXT_FEATURES.includes(contextFeature))continue;
    book.responseContexts[contextFeature]=(book.responseContexts[contextFeature]||0)+1;
    for(const replyFeature of features){
      const key=armxFullResponseKey(contextFeature,replyFeature);
      book.responseChoices[key]=(book.responseChoices[key]||0)+1;
    }
  }
}
function armxFullSyncNotebook(game,perspective=game.side,previewProfile=null){
  let books=ARMX_FULL_GAME_NOTES.get(game);
  if(!books){books=new Map();ARMX_FULL_GAME_NOTES.set(game,books);}
  const history=game.historyStack||[];
  const observationStartPly=Math.max(0,Math.trunc(Number(game.armxObservationStartPly)||0));
  let book=books.get(perspective);
  const changedHistory=book&&book.processedPlies>0
    &&history[book.processedPlies-1]!==book.lastHistoryState;
  const changedEmptyPosition=book&&!history.length&&game.fastPositionKey()!==book.initialPositionKey;
  if(!book||history.length<book.processedPlies||changedHistory||changedEmptyPosition
    ||book.observationStartPly!==observationStartPly){
    book=armxFullNewNotebook(perspective,game,observationStartPly,previewProfile);
    books.set(perspective,book);
  }
  book.previewProfile=previewProfile||book.previewProfile;

  while(book.processedPlies<history.length){
    const index=book.processedPlies;
    const state=history[index],move=state&&state.move;
    if(!move)break;
    if(index>=observationStartPly){
      const actor=state.side;
      const features=armxFullHistoricalMoveFeatures(state,move);
      if(actor===-perspective)armxFullObserveHistoricalOpponent(book,features,index);
      else if(actor===perspective)book.lastOurFeatures=new Set(features);
    }
    book.processedPlies++;
    book.lastHistoryState=state;
  }
  return book;
}
function armxFullNotebookMaturity(book){
  const moveMaturity=armxFullClamp(book.opponentMoves/ARMX_FULL.matureOpponentMoves,0,1);
  let broadFeatures=0;
  for(const feature of ARMX_FULL_NOTE_FEATURES){
    if((book.choices[feature]||0)>=2)broadFeatures++;
  }
  const breadth=armxFullClamp(broadFeatures/10,0,1);
  return armxFullClamp(moveMaturity*0.72+breadth*0.28,0,1);
}
function armxFullNotebookSummary(book){
  const rows=[];
  for(const feature of ARMX_FULL_NOTE_FEATURES){
    const choice=armxFullChoiceRate(book,feature);
    const effect=armxFullPreviewEffect(book,'opponentEffects',feature);
    const frequencyEvidence=Math.min(1,choice.evidence/8);
    const importance=frequencyEvidence*Math.min(0.75,choice.rate)
      +Math.abs(effect.value)*Math.min(1,effect.evidence/4);
    if((book.choices[feature]||0)>=2||Math.abs(effect.value)>=0.10){
      rows.push({
        feature,choiceRate:choice.rate,choiceEvidence:choice.evidence,
        effect:effect.value,effectEvidence:effect.evidence,
        effectConsistency:effect.consistency||0,importance,
      });
    }
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
function armxFullLearnedWeightDelta(book,feature,scale=1){
  const row=armxFullChoiceRate(book,feature);
  if(row.evidence<ARMX_FULL.minChoiceEvidence)return 0;
  const confidence=armxFullClamp(row.evidence/8,0,1);
  return (row.rate-0.5)*2*confidence*scale;
}
function armxFullCompiledPolicyWeights(previewWeights,book){
  const weights=new Float64Array(previewWeights||13);
  const add=(index,value)=>{weights[index]=armxFullClamp((weights[index]||0)+value,-6,6);};
  add(0,armxFullLearnedWeightDelta(book,'pawnMove',1.35));
  add(1,armxFullLearnedWeightDelta(book,'knightMove',1.35));
  add(2,armxFullLearnedWeightDelta(book,'bishopMove',1.35));
  add(3,armxFullLearnedWeightDelta(book,'rookMove',1.20));
  add(4,armxFullLearnedWeightDelta(book,'queenMove',1.20));
  add(5,armxFullLearnedWeightDelta(book,'kingMove',1.10));
  add(6,armxFullLearnedWeightDelta(book,'centralize',1.15));
  add(8,armxFullLearnedWeightDelta(book,'advance',1.45)-armxFullLearnedWeightDelta(book,'retreat',0.85));
  add(9,armxFullLearnedWeightDelta(book,'castle',1.55));
  add(10,armxFullLearnedWeightDelta(book,'development',1.45));
  add(11,armxFullLearnedWeightDelta(book,'center',1.35));
  add(12,armxFullLearnedWeightDelta(book,'pawnPush',1.10)+armxFullLearnedWeightDelta(book,'advance',0.55));
  return weights;
}
function armxFullOpponentPolicy(game,perspective=game.side,_style='artemis'){
  // style is deliberately ignored: all three models receive the same Full ARMX.
  const book=armxFullSyncNotebook(game,perspective);
  const maturity=armxFullNotebookMaturity(book);
  const noteSummary=armxFullNotebookSummary(book);
  const noteUsefulness=armxFullClamp(
    noteSummary.reduce((sum,row)=>sum+row.importance,0)/2.5,0,1
  );
  const learnedStrength=maturity*noteUsefulness;
  const surprise=book.surpriseWeight
    ?armxFullClamp((book.surpriseSum/book.surpriseWeight-0.35)/1.2,0,1):0;

  const searchBudget=Math.round(
    ARMX_FULL.baseSearchNodes
    +ARMX_FULL.maxEvidenceSearchNodes*learnedStrength
    +ARMX_FULL.maxSurpriseSearchNodes*surprise*learnedStrength
  );
  const breadthStrength=learnedStrength*learnedStrength;
  const rootWidth=ARMX_FULL.baseRootWidth
    +Math.round((ARMX_FULL.maxRootWidth-ARMX_FULL.baseRootWidth)*breadthStrength);
  const maxDepth=Math.round(
    ARMX_FULL.baseDepth+(ARMX_FULL.maxEvidenceDepth-ARMX_FULL.baseDepth)*learnedStrength
  );

  const compiledWeights=armxFullCompiledPolicyWeights(new Float64Array(13),book);
  const cache=new Map();
  const side=-perspective;
  const notePriority=move=>{
    const key=move.from|(move.to<<6)|((move.piece||0)<<12)|((move.promotion||0)<<15)|((move.flags||0)<<18);
    if(cache.has(key))return cache.get(key);
    const value=Math.round(520*armxFullPolicyFeatureScore(book,armxFullCheapMoveFeatures(move,side)));
    cache.set(key,value);
    return value;
  };
  return {
    model:ARMX_FULL.name,
    version:ARMX_FULL.version,
    observations:book.opponentMoves,
    maturity,
    noteUsefulness,
    learnedStrength,
    noteBreadth:noteSummary.length,
    searchBudget,
    maxDepth,
    maxExtraNodes:ARMX_FULL.maxExtraNodes,
    maxExtraDepth:ARMX_FULL.maxExtraDepth,
    rootWidth,
    predictionSurprise:surprise,
    weights:compiledWeights,
    priority:move=>notePriority(move),
    isLowPriority:move=>notePriority(move)<-80,
  };
}
function armxFullCandidateResponseReport(game,entry,book){
  const historyDepth=game.historyStack.length;
  const contextFeatures=armxFullMoveFeatures(game,entry.raw);
  let expectedOutcome=0,preferenceSignal=0,evidence=0,replyCount=0,repetitionPressure=0;
  try{
    game.fastApply(entry.raw);
    const resultingKey=game.fastPositionKey();
    const resultingCount=game.positionCounts&&game.positionCounts.get(resultingKey)||0;
    repetitionPressure=armxFullClamp(Math.max(0,resultingCount-1)/2,0,1);
    const replies=game.fastMoves();
    // Full ARMX models the opponent, so detailed conditional work belongs on
    // replies this opponent is actually likely to choose. Score every legal
    // reply cheaply, then deeply model only the most likely subset.
    const predictedReplies=replies.map(reply=>{
      const features=armxFullPredictiveMoveFeatures(game,reply);
      return {reply,features,quickPreference:armxFullPolicyFeatureScore(book,features)};
    });
    predictedReplies.sort((a,b)=>b.quickPreference-a.quickPreference);
    const rows=[];
    const detailedReplies=predictedReplies.slice(0,Math.max(1,ARMX_FULL.predictedReplyLimit));
    for(const predicted of detailedReplies){
      const features=predicted.features;
      let preference=predicted.quickPreference,preferenceEvidence=1,outcome=0,outcomeEvidence=0;
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
      replyCount=replies.length;
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
    repetitionPressure,
  };
}
function armxFullOpponentTendencies(book){
  const tendency=feature=>{
    const row=armxFullChoiceRate(book,feature);
    if(row.evidence<ARMX_FULL.minChoiceEvidence)return 0;
    return (row.rate-0.5)*2*armxFullClamp(row.evidence/8,0,1);
  };
  const patient=armxFullClamp(
    (tendency('quiet')+tendency('retreat')+tendency('castle'))/3
      -(tendency('check')+tendency('kingAttack')+tendency('capture'))/3,
    -1,1
  );
  return {patient,aggressive:-patient};
}
function armxFullStyleAdjustment(game,entry,response,style,hostBest,book){
  const profile=ARMX_FULL.styleProfiles[style]||ARMX_FULL.styleProfiles.artemis;
  if(!profile.baseScale)return {signal:0,scale:0,adjustment:0};
  const features=response.contextFeatures||[];
  const hostScore=Number(hostBest&&hostBest.score)||0;
  // Style-specific conversion/survival behavior should only intensify once the
  // shared host sees a real advantage/disadvantage, not around equality.
  const ahead=armxFullClamp((hostScore-120)/580,0,1);
  const behind=armxFullClamp((-hostScore-120)/580,0,1);

  let signal=0;
  for(const feature of features){
    signal+=(profile.weights[feature]||0)
      +ahead*(profile.aheadWeights[feature]||0)
      +behind*(profile.behindWeights[feature]||0);
  }

  const replyCount=Number(response.replyCount)||0;
  const compression=replyCount?armxFullClamp((24-replyCount)/18,-1,1):0;
  signal+=profile.replyCompressionWeight*compression;
  const captured=entry&&entry.raw?(ARMX_PREVIEW_PIECE_VALUES[entry.raw.captured||0]||0)/500:0;
  signal+=profile.capturedValueWeight*captured;
  const repetitionPressure=Number(response.repetitionPressure)||0;
  signal+=repetitionPressure*(profile.repetitionWeight
    +ahead*profile.aheadRepetitionWeight+behind*profile.behindRepetitionWeight);
  const halfmovePressure=armxFullClamp(((Number(game.halfmove)||0)-18)/62,0,1);
  if(features.includes('pawnMove')){
    signal+=halfmovePressure*(profile.pawnClockResetWeight||0);
  }
  const entryScore=entry&&Number.isFinite(entry.score)?entry.score:hostScore;
  const candidateHostGap=Math.max(0,hostScore-entryScore);
  signal+=ahead*(profile.advantageDelayWeight||0)*armxFullClamp(candidateHostGap/180,0,1);

  const observedPlies=Math.max(0,(game.historyStack?game.historyStack.length:0)
    -Math.max(0,Math.trunc(Number(game.armxObservationStartPly)||0)));
  const target=Math.max(1,profile.paceTargetPlies);
  const phase=observedPlies/target;
  const paceMultiplier=1
    +profile.earlyBoost*Math.max(0,1-phase)
    +profile.lateBoost*Math.max(0,phase-1);

  const tendencies=armxFullOpponentTendencies(book);
  const opponentMultiplier=1
    +profile.patientOpponentScale*Math.max(0,tendencies.patient)
    +profile.aggressiveOpponentScale*Math.max(0,tendencies.aggressive);
  const positionMultiplier=1+profile.aheadScale*ahead+profile.behindScale*behind;
  const scale=profile.baseScale*Math.max(0.15,paceMultiplier)*positionMultiplier*opponentMultiplier;
  const max=ARMX_FULL.maxStyleAdjustment[style]||0;
  return {signal,scale,adjustment:armxFullClamp(signal*scale,-max,max),tendencies,compression,repetitionPressure};
}
function armxFullMateScale(entry){
  if(!entry)return false;
  const mate=typeof STONEFISH_V5_PRO_MATE==='number'?STONEFISH_V5_PRO_MATE
    :(typeof STONEFISH_V5_MATE==='number'?STONEFISH_V5_MATE:20000000);
  return (Number.isFinite(entry.deep)&&Math.abs(entry.deep)>=mate*0.9)
    ||(Number.isFinite(entry.score)&&Math.abs(entry.score)>=mate*0.9);
}
function armxFullReview(game,finished,style='artemis',perspective=game.side){
  const book=armxFullSyncNotebook(game,perspective);
  const maturity=armxFullNotebookMaturity(book);
  const candidates=(finished||[]).filter(entry=>entry&&Number.isFinite(entry.score))
    .slice(0,ARMX_FULL.candidateLimit);
  if(!candidates.length)return {reports:[],winner:null,book,maturity};

  const hostBest=candidates[0];
  const reports=candidates.map(entry=>{
    const response=armxFullCandidateResponseReport(game,entry,book);

    // Full ARMX is self-contained: every adaptive vote comes from this richer
    // per-game notebook. With zero evidence, Artemis returns the native host move.
    const noteConfidence=armxFullClamp(response.evidence/ARMX_FULL.fullConfidenceEvidence,0,1);
    const learnedSignal=response.ownOutcome+response.expectedOpponentOutcome;
    const noteAdjustment=armxFullClamp(
      learnedSignal*ARMX_FULL.fullNoteScale*noteConfidence*maturity,
      -ARMX_FULL.maxNoteAdjustment,ARMX_FULL.maxNoteAdjustment
    );
    const adaptiveAdjustment=noteAdjustment;

    const styleResult=armxFullStyleAdjustment(
      game,entry,response,style,hostBest,book
    );
    const hostGap=hostBest.score-entry.score;
    const deepSacrifice=Number.isFinite(hostBest.deep)&&Number.isFinite(entry.deep)
      ?hostBest.deep-entry.deep:hostGap;
    const styleProfile=ARMX_FULL.styleProfiles[style]||ARMX_FULL.styleProfiles.artemis;
    const hostScore=Number(hostBest&&hostBest.score)||0;
    const ahead=armxFullClamp((hostScore-120)/580,0,1);
    const behind=armxFullClamp((-hostScore-120)/580,0,1);
    const allowedHostGap=styleProfile.maxHostGap
      +ahead*(styleProfile.aheadHostGapBonus||0)
      +behind*(styleProfile.behindHostGapBonus||0);
    const allowedDeepSacrifice=styleProfile.maxDeepSacrifice
      +ahead*(styleProfile.aheadDeepGapBonus||0);
    const protectedTruth=armxFullMateScale(hostBest)||armxFullMateScale(entry);
    const aheadSafetyFloor=Number.isFinite(styleProfile.aheadCandidateFloor)
      ?styleProfile.aheadCandidateFloor:-Infinity;
    const keepsWinningMargin=!ahead||Number(entry.score)>=aheadSafetyFloor;
    const objectiveEligible=entry===hostBest||(!protectedTruth&&keepsWinningMargin
      &&hostGap<=allowedHostGap&&deepSacrifice<=allowedDeepSacrifice);
    const fullScore=objectiveEligible
      ?entry.score+adaptiveAdjustment+styleResult.adjustment
      :-Infinity;
    return {
      raw:entry.raw,
      hostScore:entry.score,
      hostDeep:entry.deep,
      adjustment:noteAdjustment,
      signal:learnedSignal,
      confidence:noteConfidence,
      evidence:response.evidence,
      entry,style,
      notebookResponse:response,
      maturity,
      previewAdjustment:0,
      noteAdjustment,
      noteConfidence,
      learnedSignal,
      adaptiveAdjustment,
      styleSignal:styleResult.signal,
      styleScale:styleResult.scale,
      styleAdjustment:styleResult.adjustment,
      styleTendencies:styleResult.tendencies||null,
      styleCompression:styleResult.compression||0,
      styleRepetitionPressure:styleResult.repetitionPressure||0,
      hostGap,deepSacrifice,allowedHostGap,allowedDeepSacrifice,
      objectiveEligible,eligible:objectiveEligible,fullScore,
    };
  });

  // Full ARMX learns continuously, but only strong, repeatable notes get to
  // overturn the native host choice. Specialist styles may choose a different
  // objectively-close finalist independently of the adaptive notebook gate.
  const provisionalReport=reports.find(report=>report.entry===hostBest)||reports[0];
  const observedPlies=Math.max(0,(game.historyStack?game.historyStack.length:0)
    -Math.max(0,Math.trunc(Number(game.armxObservationStartPly)||0)));
  for(const report of reports){
    if(report===provisionalReport){
      report.eligible=true;
      report.fullNoteGate={allowed:true,reason:'provisional'};
      report.styleGate={allowed:true,reason:'provisional'};
      report.fullScore=report.entry.score+(Number(report.noteAdjustment)||0)
        +(Number(report.styleAdjustment)||0);
      continue;
    }

    const responseEvidence=Number(report.notebookResponse&&report.notebookResponse.evidence)||0;
    const noteConfidence=Number(report.noteConfidence)||0;
    const notebookDecisionLead=(Number(report.entry.score)||0)+(Number(report.noteAdjustment)||0)
      -((Number(provisionalReport.entry.score)||0)+(Number(provisionalReport.noteAdjustment)||0));
    const signalQuality=(Number(report.learnedSignal)||0)>=ARMX_FULL.fullNoteMinPositiveSignal
      ||(Number(provisionalReport.learnedSignal)||0)<=ARMX_FULL.fullNoteStrongAvoidSignal;
    const matureEvidence=responseEvidence>=ARMX_FULL.fullNoteMinEvidence
      &&noteConfidence>=ARMX_FULL.fullNoteMinConfidence;
    const earlyEvidence=observedPlies>=ARMX_FULL.fullNoteEarlyPlies
      ||(responseEvidence>=ARMX_FULL.fullNoteEarlyEvidence
        &&noteConfidence>=ARMX_FULL.fullNoteEarlyConfidence);
    const fullNoteAllowed=matureEvidence&&earlyEvidence&&signalQuality
      &&notebookDecisionLead>=ARMX_FULL.fullNoteMinDecisionLead;

    const styleLead=(Number(report.styleAdjustment)||0)
      -(Number(provisionalReport.styleAdjustment)||0);
    const styleAllowed=style!=='artemis'&&styleLead>0;
    report.fullNoteGate={
      allowed:fullNoteAllowed,
      responseEvidence,noteConfidence,notebookDecisionLead,signalQuality,earlyEvidence,
    };
    report.styleGate={allowed:styleAllowed,styleLead};
    report.eligible=Boolean(report.objectiveEligible&&(fullNoteAllowed||styleAllowed));
    report.fullScore=report.eligible
      ?report.entry.score+(Number(report.noteAdjustment)||0)
        +(Number(report.styleAdjustment)||0)
      :-Infinity;
  }

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
