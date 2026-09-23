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
const ARMX_FULL_STATE_CONTEXTS = Object.freeze([
  'queensOn','queenless','materialHigh','materialMid','materialLow',
  'opponentAhead','opponentBehind','roughlyEqual'
]);
const ARMX_FULL_CONTEXT_FEATURES = Object.freeze([
  'capture','trade','simplify','check','kingAttack','pawnPush','castle','quiet','advance','retreat',
  ...ARMX_FULL_STATE_CONTEXTS
]);
// Preview already reasons about capture/trade reply opportunities. Full ARMX
// extends candidate-time prediction only to broader behaviors its notebook has
// actually observed with opportunity evidence.
const ARMX_FULL_EXTENDED_REPLY_FEATURES = Object.freeze([
  'minorTrade','kingAttack','pawnPush','castle','quiet','advance','retreat'
]);

const ARMX_FULL = Object.freeze({
  name: 'ARMX',
  version: '2.0-full-notebook',
  kind: 'opponent-adaptation',
  reset: 'per-game',

  // No evidence means no free strength bump: Full ARMX begins from the current
  // v5.5 host budget/width and earns extra analysis only from opponent evidence.
  candidateLimit: 4,
  baseSearchNodes: 1200,
  maxEvidenceSearchNodes: 8000,
  maxSurpriseSearchNodes: 1500,
  maxExtraNodes: 10000,
  baseDepth: 4,
  maxEvidenceDepth: 6,
  maxExtraDepth: 2,
  baseRootWidth: 3,
  maxRootWidth: 4,
  matureOpponentMoves: 6,
  opportunityScanStride: 2,
  rootBreadthEvidenceThreshold: 0.80,
  stateContextMinEvidence: 5,
  stateContextScale: 0.55,
  pieceBaselinePrior: 0.22,
  pieceBaselinePriorWeight: 8,
  extendedReplyOutcomeScale: 0.82,
  minChoiceEvidence: 2,
  minEffectEvidence: 1.25,
  fullConfidenceEvidence: 12,
  predictedReplyLimit: 10,
  fullNoteMinEvidence: 5.5,
  fullNoteMinConfidence: 0.65,
  fullNoteMinDecisionLead: 1.5,
  fullNoteMinPositiveSignal: 0.035,
  fullNoteStrongAvoidSignal: -0.15,
  fullNoteEarlyPlies: 20,
  fullNoteEarlyEvidence: 8.5,
  fullNoteEarlyConfidence: 0.90,

  // Preview's proven opponent model is the strict subset of Full ARMX. Full
  // ARMX reuses that evidence and adds broader/contextual notes; it does not
  // pay to relearn the same history a second time.
  previewDecisionGain: 1.25,
  fullDecisionGain: 1.00,
  fullNoteScale: 155,
  maxNoteAdjustment: 140,
  maxHostGap: 40,
  maxDeepSacrifice: 32,

  // Compatibility fields used by benchmark assertions. Artemis is exactly zero.
  styleScale: Object.freeze({athena: 18, ares: 20, artemis: 0}),
  maxStyleAdjustment: Object.freeze({athena: 155, ares: 130, artemis: 0}),

  // Athena/Ares are the same model with different numbers. The shared style
  // function below interprets these vectors; Artemis's vector is all zero.
  styleProfiles: Object.freeze({
    artemis: Object.freeze({
      weights: Object.freeze({}),
      aheadWeights: Object.freeze({}), behindWeights: Object.freeze({}),
      baseScale:0, earlyBoost:0, lateBoost:0, paceTargetPlies:1,
      aheadThreshold:120, behindThreshold:120, advantageRange:580, minStyleLead:Infinity,
      aheadScale:0, behindScale:0, replyCompressionWeight:0, capturedValueWeight:0,
      repetitionWeight:0, aheadRepetitionWeight:0, behindRepetitionWeight:0,
      advantageDelayWeight:0, pawnClockResetWeight:0, aheadCandidateFloor:-1000000000,
      patientOpponentScale:0, aggressiveOpponentScale:0,
      patientPressureWeight:0, aggressiveDefenseWeight:0,
      opponentForcingReplyWeight:0, behindForcingReplyWeight:0,
      opponentKingAttackReplyWeight:0, behindKingAttackReplyWeight:0,
      opponentCaptureReplyWeight:0, behindCaptureReplyWeight:0,
      aheadHostGapBonus:0, aheadDeepGapBonus:0, behindHostGapBonus:0, behindDeepGapBonus:0,
      maxHostGap:40, maxDeepSacrifice:32,
    }),
    athena: Object.freeze({
      weights: Object.freeze({
        capture:-0.38, trade:-0.55, rookTrade:-0.48, queenTrade:-0.52,
        minorTrade:-0.44, simplify:-0.52, check:-0.28, kingAttack:-0.34,
        pawnPush:0.24, castle:0.78, quiet:0.72, advance:-0.12, retreat:0.46,
        forcing:-0.26, promotion:0.08, center:0.12, kingside:0.08,
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
        capture:2.20,trade:3.80,rookTrade:2.75,queenTrade:4.25,minorTrade:2.20,
        simplify:4.00,check:0.42,kingAttack:0.28,quiet:-1.35,retreat:1.15,castle:1.45,
      }),
      baseScale:10, earlyBoost:2.40, lateBoost:-0.35, paceTargetPlies:260,
      aheadThreshold:120, behindThreshold:15, advantageRange:360, minStyleLead:10,
      aheadScale:0.25, behindScale:4.20, replyCompressionWeight:-1.25, capturedValueWeight:-0.38,
      repetitionWeight:0.10, aheadRepetitionWeight:-0.25, behindRepetitionWeight:8.60,
      advantageDelayWeight:0.45, pawnClockResetWeight:1.40, aheadCandidateFloor:170,
      patientOpponentScale:0.00, aggressiveOpponentScale:1.55,
      patientPressureWeight:0, aggressiveDefenseWeight:3.30,
      opponentForcingReplyWeight:-0.15, behindForcingReplyWeight:-3.10,
      opponentKingAttackReplyWeight:-0.10, behindKingAttackReplyWeight:-2.45,
      opponentCaptureReplyWeight:-0.05, behindCaptureReplyWeight:-1.10,
      aheadHostGapBonus:28, aheadDeepGapBonus:18, behindHostGapBonus:72, behindDeepGapBonus:38,
      maxHostGap:18, maxDeepSacrifice:18,
    }),
    ares: Object.freeze({
      weights: Object.freeze({
        capture:0.42, trade:0.18, rookTrade:0.22, queenTrade:0.20,
        minorTrade:0.18, simplify:0.26, check:0.32, kingAttack:0.42,
        pawnPush:0.12, castle:-0.03, quiet:-0.26, advance:0.18, retreat:-0.30,
        forcing:0.34, promotion:0.62, center:0.10, kingside:0.16,
        queenside:0.18, centralize:0.26, development:0.18, pawnMove:0.18,
        knightMove:0.12, bishopMove:0.14, rookMove:0.20, queenMove:0.22, kingMove:-0.20,
      }),
      aheadWeights:Object.freeze({
        capture:3.45,trade:3.30,rookTrade:2.55,queenTrade:2.40,minorTrade:2.18,
        simplify:3.85,check:0.92,kingAttack:1.14,quiet:-1.28,retreat:-1.18,
      }),
      behindWeights:Object.freeze({
        capture:0.15,trade:-0.55,simplify:-0.65,check:1.55,kingAttack:1.70,
        forcing:1.35,advance:0.62,quiet:-0.72,retreat:-0.95,
      }),
      baseScale:8, earlyBoost:0.10, lateBoost:6.20, paceTargetPlies:42,
      aheadThreshold:10, behindThreshold:100, advantageRange:420, minStyleLead:8,
      aheadScale:4.10, behindScale:0.20, replyCompressionWeight:1.10, capturedValueWeight:1.05,
      repetitionWeight:-0.85, aheadRepetitionWeight:-6.20, behindRepetitionWeight:-0.35,
      advantageDelayWeight:0, pawnClockResetWeight:0, aheadCandidateFloor:105,
      patientOpponentScale:1.20, aggressiveOpponentScale:0.00,
      patientPressureWeight:3.60, aggressiveDefenseWeight:0,
      opponentForcingReplyWeight:0, behindForcingReplyWeight:0,
      opponentKingAttackReplyWeight:0, behindKingAttackReplyWeight:0,
      opponentCaptureReplyWeight:0, behindCaptureReplyWeight:0,
      aheadHostGapBonus:118, aheadDeepGapBonus:82, behindHostGapBonus:0, behindDeepGapBonus:0,
      maxHostGap:18, maxDeepSacrifice:18,
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
  if(move.captured&&(piece===2||piece===3)&&(move.captured===2||move.captured===3)){
    features.add('minorTrade');
  }
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
function armxFullStateContextFromTotals(totalMaterial,perspectiveScore,queenCount){
  const contexts=new Set();
  contexts.add(queenCount>0?'queensOn':'queenless');
  contexts.add(totalMaterial>=5200?'materialHigh':totalMaterial<=2800?'materialLow':'materialMid');
  if(perspectiveScore>=150)contexts.add('opponentBehind');
  else if(perspectiveScore<=-150)contexts.add('opponentAhead');
  else contexts.add('roughlyEqual');
  return contexts;
}
function armxFullStateContexts(game,perspective){
  let totalMaterial=0,perspectiveScore=0,queenCount=0;
  for(const piece of game.boardState){
    if(!piece)continue;
    const type=Math.abs(piece);
    if(type===6)continue;
    const value=ARMX_PREVIEW_PIECE_VALUES[type]||0;
    totalMaterial+=value;
    perspectiveScore+=(piece>0?1:-1)===perspective?value:-value;
    if(type===5)queenCount++;
  }
  return armxFullStateContextFromTotals(totalMaterial,perspectiveScore,queenCount);
}
function armxFullStateContextsAfterMove(game,move,perspective){
  let totalMaterial=0,perspectiveScore=0,queenCount=0;
  for(const piece of game.boardState){
    if(!piece)continue;
    const type=Math.abs(piece);
    if(type===6)continue;
    const value=ARMX_PREVIEW_PIECE_VALUES[type]||0;
    totalMaterial+=value;
    perspectiveScore+=(piece>0?1:-1)===perspective?value:-value;
    if(type===5)queenCount++;
  }
  const mover=game.side;
  const captured=move&&move.captured||0;
  if(captured){
    const value=ARMX_PREVIEW_PIECE_VALUES[captured]||0;
    totalMaterial-=value;
    // Captured material belonged to the other side.
    perspectiveScore+=(mover===perspective?1:-1)*value;
    if(captured===5)queenCount=Math.max(0,queenCount-1);
  }
  if(move&&move.promotion){
    const delta=(ARMX_PREVIEW_PIECE_VALUES[move.promotion]||0)
      -(ARMX_PREVIEW_PIECE_VALUES[1]||0);
    totalMaterial+=delta;
    perspectiveScore+=(mover===perspective?1:-1)*delta;
    if(move.promotion===5)queenCount++;
  }
  return armxFullStateContextFromTotals(totalMaterial,perspectiveScore,queenCount);
}
function armxFullResponseKey(contextFeature,replyFeature){
  return contextFeature+'>'+replyFeature;
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
function armxFullReplayFromGameStart(game){
  const replay=new Chess();
  replay.boardState=new Int8Array(game.boardState);
  replay.side=game.side;
  replay.castling=game.castling;
  replay.ep=game.ep;
  replay.halfmove=game.halfmove;
  replay.fullmove=game.fullmove;
  replay.kingSq={1:game.kingSq[1],'-1':game.kingSq[-1]};
  replay.historyStack=(game.historyStack||[]).slice();
  replay.positionCounts=new Map(game.positionCounts);
  replay._stonefishRuntimePositionKey=null;
  while(replay.historyStack.length)replay.fastUndo();
  return replay;
}
function armxFullNewNotebook(perspective,game,observationStartPly,previewProfile){
  const replay=armxFullReplayFromGameStart(game);
  return {
    perspective,
    observationStartPly,
    processedPlies:0,
    lastHistoryState:null,
    initialPositionKey:replay.fastPositionKey(),
    replay,
    opponentMoves:0,
    voluntaryOpponentMoves:0,
    opportunities:armxFullFreshCounts(),
    choices:armxFullFreshCounts(),
    responseOpportunities:Object.create(null),
    responseChoices:Object.create(null),
    lastOurFeatures:new Set(),
    surpriseSum:0,
    surpriseWeight:0,
    previewProfile:previewProfile||null,
  };
}
function armxFullChoiceRate(book,feature){
  const evidence=book.opportunities[feature]||0;
  if(!evidence)return {rate:0.5,evidence:0};
  return {rate:((book.choices[feature]||0)+1)/(evidence+2),evidence};
}
function armxFullConditionalRate(book,contextFeature,replyFeature){
  const key=armxFullResponseKey(contextFeature,replyFeature);
  const evidence=book.responseOpportunities[key]||0;
  if(!evidence)return {rate:0.5,evidence:0};
  return {rate:((book.responseChoices[key]||0)+1)/(evidence+2),evidence};
}
function armxFullPreviewEffect(book,bucketName,feature){
  const profile=book&&book.previewProfile;
  const bucket=profile&&profile[bucketName];
  if(!bucket||!bucket[feature])return {value:0,evidence:0,consistency:0};
  const effect=armxPreviewEffect(bucket,feature);
  return {value:Number(effect.value)||0,evidence:Number(effect.evidence)||0,consistency:1};
}
function armxFullObserveHistoricalOpponent(book,features,available,legalCount,index,stateContexts=new Set()){
  book.opponentMoves++;
  // A forced move says nothing about preference. Keep it out of the tendency
  // notebook while still counting it as an observed opponent move.
  if(legalCount<=1)return;

  if(book.voluntaryOpponentMoves>=2){
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

  book.voluntaryOpponentMoves++;
  for(const feature of available){
    if(!Object.prototype.hasOwnProperty.call(book.opportunities,feature))continue;
    book.opportunities[feature]=(book.opportunities[feature]||0)+1;
    if(features.has(feature))book.choices[feature]=(book.choices[feature]||0)+1;
  }

  const responseContexts=new Set([...book.lastOurFeatures,...stateContexts]);
  for(const contextFeature of responseContexts){
    if(!ARMX_FULL_CONTEXT_FEATURES.includes(contextFeature))continue;
    for(const replyFeature of available){
      if(!ARMX_FULL_NOTE_FEATURES.includes(replyFeature))continue;
      const key=armxFullResponseKey(contextFeature,replyFeature);
      book.responseOpportunities[key]=(book.responseOpportunities[key]||0)+1;
      if(features.has(replyFeature)){
        book.responseChoices[key]=(book.responseChoices[key]||0)+1;
      }
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

    const actor=book.replay.side;
    if(index>=observationStartPly){
      const features=armxFullMoveFeatures(book.replay,move);
      if(actor===-perspective){
        const stride=Math.max(1,ARMX_FULL.opportunityScanStride||1);
        const sampleOpportunity=(book.opponentMoves%stride)===0;
        if(sampleOpportunity){
          const legal=book.replay.fastMoves();
          const available=new Set(features);
          for(const option of legal){
            for(const feature of armxFullPredictiveMoveFeatures(book.replay,option)){
              available.add(feature);
            }
          }
          const stateContexts=armxFullStateContexts(book.replay,perspective);
          armxFullObserveHistoricalOpponent(
            book,features,available,legal.length,index,stateContexts
          );
        }else{
          // Preview still observes its proven subset every move. Full ARMX samples
          // the broader legal-option set to stay lightweight without inventing
          // preference evidence on unsampled turns.
          book.opponentMoves++;
        }
      }else if(actor===perspective){
        book.lastOurFeatures=new Set(features);
      }
    }

    book.replay.fastApply(move);
    book.processedPlies++;
    book.lastHistoryState=state;
  }
  return book;
}
function armxFullNotebookMaturity(book){
  const moveMaturity=armxFullClamp(book.voluntaryOpponentMoves/ARMX_FULL.matureOpponentMoves,0,1);
  let broadFeatures=0;
  for(const feature of ARMX_FULL_NOTE_FEATURES){
    if((book.opportunities[feature]||0)>=ARMX_FULL.minChoiceEvidence)broadFeatures++;
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
    if(choice.evidence>=ARMX_FULL.minChoiceEvidence||Math.abs(effect.value)>=0.10){
      rows.push({
        feature,
        choices:book.choices[feature]||0,
        opportunities:book.opportunities[feature]||0,
        choiceRate:choice.rate,choiceEvidence:choice.evidence,
        effect:effect.value,effectEvidence:effect.evidence,
        effectConsistency:effect.consistency||0,importance,
      });
    }
  }
  rows.sort((a,b)=>b.importance-a.importance);
  return rows.slice(0,10);
}
function armxFullRawFrequency(book,feature){
  const opportunities=book&&book.opportunities&&book.opportunities[feature]||0;
  return opportunities?(book.choices[feature]||0)/opportunities:0;
}
function armxFullFeaturePreference(book,feature){
  const row=armxFullChoiceRate(book,feature);
  if(row.evidence<ARMX_FULL.minChoiceEvidence)return 0;
  const confidence=armxFullClamp(row.evidence/10,0,1);
  const rate=armxFullRawFrequency(book,feature);
  const pieceFeatures=['pawnMove','knightMove','bishopMove','rookMove','queenMove','kingMove'];
  if(pieceFeatures.includes(feature)){
    let weightedRate=0,totalWeight=0;
    for(const name of pieceFeatures){
      const observed=armxFullChoiceRate(book,name);
      if(observed.evidence<ARMX_FULL.minChoiceEvidence)continue;
      const weight=Math.min(12,observed.evidence);
      weightedRate+=observed.rate*weight;
      totalWeight+=weight;
    }
    const priorWeight=ARMX_FULL.pieceBaselinePriorWeight;
    const opponentBaseline=totalWeight
      ?(ARMX_FULL.pieceBaselinePrior*priorWeight+weightedRate)/(priorWeight+totalWeight)
      :ARMX_FULL.pieceBaselinePrior;
    return armxFullClamp((rate-opponentBaseline)*1.8,-1,1)*confidence;
  }
  if(feature==='advance'||feature==='retreat'){
    const other=armxFullRawFrequency(book,feature==='advance'?'retreat':'advance');
    return armxFullClamp((rate-other)*1.35,-1,1)*confidence;
  }
  if(feature==='kingside'||feature==='queenside'){
    const other=armxFullRawFrequency(book,feature==='kingside'?'queenside':'kingside');
    return armxFullClamp((rate-other)*1.15,-1,1)*confidence;
  }
  // The useful note is conditional: when this behavior was actually available,
  // how often did this opponent choose it?
  return armxFullClamp((row.rate-0.5)*2,-1,1)*confidence;
}
function armxFullPolicyFeatureScore(book,features){
  let score=0,evidence=0;
  for(const feature of features){
    if(!ARMX_FULL_NOTE_FEATURES.includes(feature))continue;
    const preference=armxFullFeaturePreference(book,feature);
    if(!preference)continue;
    score+=preference;
    evidence+=Math.min(1,(book.opportunities[feature]||0)/8);
  }
  return evidence?score/Math.sqrt(evidence):0;
}
function armxFullLearnedWeightDelta(book,feature,scale=1){
  return armxFullFeaturePreference(book,feature)*scale;
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
function armxFullPreviewPolicyFromSyncedProfile(profile,perspective){
  const model=profile&&profile.quietPolicy;
  if(!model||model.count<ARMX_PREVIEW.quietChoiceMinObservations)return null;
  const weights=new Float64Array(model.weights);
  let cache=null;
  const score=move=>{
    if(!cache)cache=new Map();
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
    -(model.qualityWeight?model.qualitySum/model.qualityWeight:0)
      /ARMX_PREVIEW.predictionSurpriseScale,0,1
  );
  const searchBudget=SF55C.nodes+Math.round(ARMX_PREVIEW.maxExtraSearchNodes*uncertainty)
    +Math.round(ARMX_PREVIEW.evidenceSearchNodes
      *Math.min(1,model.count/ARMX_PREVIEW.fullSearchEvidence));
  return {
    observations:model.count,
    searchBudget,
    maxDepth:SF55C.maxDepth+ARMX_PREVIEW.maxExtraSearchDepth,
    weights,
    priority:move=>Math.round(300*score(move)),
    isLowPriority:move=>score(move)<0,
  };
}
function armxFullOpponentPolicy(game,perspective=game.side,_style='artemis'){
  // Style is deliberately ignored: all three models receive the same Full ARMX.
  const previewProfile=armxPreviewSyncProfile(game,perspective);
  // Reuse the already-synced frozen Preview profile inside Full ARMX. This
  // reproduces Preview's policy math without a second profile sync.
  const preview=armxFullPreviewPolicyFromSyncedProfile(previewProfile,perspective);
  const book=armxFullSyncNotebook(game,perspective,previewProfile);
  const maturity=armxFullNotebookMaturity(book);
  const noteSummary=armxFullNotebookSummary(book);
  const noteUsefulness=armxFullClamp(
    noteSummary.reduce((sum,row)=>sum+row.importance,0)/3.5,0,1
  );
  const learnedStrength=maturity*noteUsefulness;
  const surprise=book.surpriseWeight
    ?armxFullClamp((book.surpriseSum/book.surpriseWeight-0.45)/1.4,0,1):0;

  const fullEvidenceBudget=Math.round(
    ARMX_FULL.baseSearchNodes
    +ARMX_FULL.maxEvidenceSearchNodes*learnedStrength
    +ARMX_FULL.maxSurpriseSearchNodes*surprise*learnedStrength
  );
  const previewSearchBudget=preview&&Number.isFinite(preview.searchBudget)
    ?preview.searchBudget:ARMX_FULL.baseSearchNodes;
  const searchBudget=Math.max(previewSearchBudget,fullEvidenceBudget);
  // Extra root breadth is expensive and can dilute depth. Unlock the fourth
  // finalist only when the opponent notebook is genuinely mature/useful.
  const breadthEvidence=learnedStrength*(0.85+0.15*surprise);
  const rootWidth=ARMX_FULL.baseRootWidth
    +(breadthEvidence>=ARMX_FULL.rootBreadthEvidenceThreshold
      ?Math.min(1,ARMX_FULL.maxRootWidth-ARMX_FULL.baseRootWidth):0);
  const fullEvidenceDepth=Math.round(
    ARMX_FULL.baseDepth+(ARMX_FULL.maxEvidenceDepth-ARMX_FULL.baseDepth)*learnedStrength
  );
  const previewDepth=preview&&Number.isFinite(preview.maxDepth)
    ?preview.maxDepth:ARMX_FULL.baseDepth;
  const maxDepth=Math.max(previewDepth,fullEvidenceDepth);

  const previewWeights=preview&&preview.weights?preview.weights:new Float64Array(13);
  const compiledWeights=armxFullCompiledPolicyWeights(previewWeights,book);
  const cache=new Map();
  const side=-perspective;
  const notePriority=move=>{
    const key=move.from|(move.to<<6)|((move.piece||0)<<12)|((move.promotion||0)<<15)|((move.flags||0)<<18);
    if(cache.has(key))return cache.get(key);
    const value=Math.round(180*armxFullPolicyFeatureScore(book,armxFullCheapMoveFeatures(move,side)));
    cache.set(key,value);
    return value;
  };
  const previewPriority=preview&&typeof preview.priority==='function'?preview.priority:()=>0;
  book.lastPolicyTelemetry={
    maturity,noteUsefulness,learnedStrength,surprise,searchBudget,maxDepth,rootWidth,
    voluntaryObservations:book.voluntaryOpponentMoves,
  };

  return {
    model:ARMX_FULL.name,
    version:ARMX_FULL.version,
    observations:book.opponentMoves,
    voluntaryObservations:book.voluntaryOpponentMoves,
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
    priority:move=>previewPriority(move)+notePriority(move),
    isLowPriority:move=>{
      const previewLow=preview&&typeof preview.isLowPriority==='function'&&preview.isLowPriority(move);
      return previewLow||notePriority(move)<-90;
    },
  };
}
function armxFullCandidateResponseReport(game,entry,book,previewReport,style='artemis'){
  const contextFeatures=new Set(previewReport&&previewReport.features||[]);
  for(const feature of armxFullPredictiveMoveFeatures(game,entry.raw))contextFeatures.add(feature);
  for(const context of armxFullStateContextsAfterMove(game,entry.raw,book.perspective)){
    contextFeatures.add(context);
  }

  const previewReplyFeatures=new Set(ARMX_PREVIEW_REPLY_FEATURES||[]);
  const knownPreviewAvailable=new Set(previewReport&&previewReport.replyFeaturesAvailable||[]);
  const styleProfile=ARMX_FULL.styleProfiles[style]||ARMX_FULL.styleProfiles.artemis;

  const extendedOutcomeFeatures=ARMX_FULL_EXTENDED_REPLY_FEATURES.filter(feature=>{
    if((book.opportunities[feature]||0)<ARMX_FULL.minChoiceEvidence)return false;
    const effect=armxFullPreviewEffect(book,'opponentEffects',feature);
    return effect.evidence>=ARMX_FULL.minEffectEvidence;
  });
  const needsCoreReplyScan=extendedOutcomeFeatures.length>0;
  const needsReplyCount=style!=='artemis'&&Boolean(styleProfile.replyCompressionWeight);
  const needsReplySafety=style!=='artemis'&&Boolean(
    styleProfile.opponentForcingReplyWeight||styleProfile.behindForcingReplyWeight
      ||styleProfile.opponentKingAttackReplyWeight||styleProfile.behindKingAttackReplyWeight
      ||styleProfile.opponentCaptureReplyWeight||styleProfile.behindCaptureReplyWeight
  );
  const needsRepetition=style!=='artemis'&&(
    styleProfile.repetitionWeight||styleProfile.aheadRepetitionWeight||styleProfile.behindRepetitionWeight
  );

  let repetitionPressure=0,replyCount=0;
  let forcingReplyRate=0,kingAttackReplyRate=0,captureReplyRate=0;
  let actualReplyAvailable=null,replyFeatureCounts=null;

  if(needsCoreReplyScan||needsReplyCount||needsReplySafety||needsRepetition){
    const historyDepth=game.historyStack.length;
    try{
      game.fastApply(entry.raw);
      let replies=null;
      if(needsCoreReplyScan||needsReplyCount||needsReplySafety){
        replies=game.fastMoves();
        replyCount=replies.length;
      }
      if(replies){
        actualReplyAvailable=new Set();
        replyFeatureCounts=Object.create(null);
        let forcing=0,kingAttack=0,captures=0;
        for(const reply of replies){
          const replyFeatures=armxFullPredictiveMoveFeatures(game,reply);
          for(const feature of replyFeatures){
            if(!ARMX_FULL_NOTE_FEATURES.includes(feature))continue;
            actualReplyAvailable.add(feature);
            replyFeatureCounts[feature]=(replyFeatureCounts[feature]||0)+1;
          }
          if(needsReplySafety){
            if(replyFeatures.has('forcing'))forcing++;
            if(replyFeatures.has('kingAttack'))kingAttack++;
            if(replyFeatures.has('capture'))captures++;
          }
        }
        if(needsReplySafety&&replyCount){
          forcingReplyRate=forcing/replyCount;
          kingAttackReplyRate=kingAttack/replyCount;
          captureReplyRate=captures/replyCount;
        }
      }
      if(needsRepetition){
        const key=game.fastPositionKey();
        const count=game.positionCounts&&game.positionCounts.get(key)||0;
        repetitionPressure=armxFullClamp(Math.max(0,count-1)/2,0,1);
      }
    }finally{
      while(game.historyStack.length>historyDepth)game.fastUndo();
    }
  }

  let contextualOutcome=0,preferenceSignal=0,evidence=0;
  const usefulReplyFeatures=ARMX_FULL_NOTE_FEATURES.filter(feature=>{
    if((book.opportunities[feature]||0)<ARMX_FULL.minChoiceEvidence)return false;
    if(actualReplyAvailable)return actualReplyAvailable.has(feature);
    return previewReplyFeatures.has(feature)&&knownPreviewAvailable.has(feature);
  });

  // Full ARMX extends Preview's candidate model to broader reply behaviors.
  // This term is still entirely opponent-derived: tendency when available ×
  // observed outcome when this opponent actually chose that behavior.
  if(actualReplyAvailable&&replyCount){
    for(const feature of extendedOutcomeFeatures){
      if(!actualReplyAvailable.has(feature))continue;
      const choice=armxFullChoiceRate(book,feature);
      const effect=armxFullPreviewEffect(book,'opponentEffects',feature);
      if(choice.evidence<ARMX_FULL.minChoiceEvidence
          ||effect.evidence<ARMX_FULL.minEffectEvidence)continue;
      const choiceConfidence=armxFullClamp(choice.evidence/8,0,1);
      const effectConfidence=armxFullClamp(effect.evidence/6,0,1);
      const share=armxFullClamp((replyFeatureCounts[feature]||0)/replyCount,0,1);
      const availabilityWeight=0.55+0.45*armxFullClamp(share*2.5,0,1);
      const contribution=choice.rate*choice.rate*effect.value
        *choiceConfidence*effectConfidence*availabilityWeight
        *ARMX_FULL.extendedReplyOutcomeScale;
      contextualOutcome+=contribution;
      evidence+=Math.min(1.5,(choice.evidence*0.12+effect.evidence*0.18))
        *Math.max(0.25,choice.rate)*availabilityWeight;
    }
  }

  // Context-specific response notes answer a different question: after *this
  // kind of move / in this phase*, does this opponent choose the reply behavior
  // more or less often than its own normal baseline?
  for(const contextFeature of contextFeatures){
    if(!ARMX_FULL_CONTEXT_FEATURES.includes(contextFeature))continue;
    for(const replyFeature of usefulReplyFeatures){
      const conditional=armxFullConditionalRate(book,contextFeature,replyFeature);
      const stateContext=ARMX_FULL_STATE_CONTEXTS.includes(contextFeature);
      const minimumEvidence=stateContext
        ?ARMX_FULL.stateContextMinEvidence:ARMX_FULL.minChoiceEvidence;
      if(conditional.evidence<minimumEvidence)continue;
      const baseline=armxFullChoiceRate(book,replyFeature);
      const delta=conditional.rate-baseline.rate;
      const confidence=armxFullClamp(conditional.evidence/8,0,1);
      const contextScale=stateContext?ARMX_FULL.stateContextScale:1;
      if(Math.abs(delta)<0.025)continue;

      preferenceSignal+=delta*confidence*contextScale;
      evidence+=confidence*contextScale;

      const effect=armxFullPreviewEffect(book,'opponentEffects',replyFeature);
      if(effect.evidence>=ARMX_FULL.minEffectEvidence){
        const effectConfidence=armxFullClamp(effect.evidence/6,0,1);
        contextualOutcome+=delta*effect.value*confidence*effectConfidence*contextScale;
        evidence+=0.5*effectConfidence*contextScale;
      }
    }
  }

  return {
    contextFeatures:Array.from(contextFeatures),
    expectedOpponentOutcome:contextualOutcome,
    opponentPreferenceSignal:preferenceSignal,
    ownOutcome:0,
    evidence:Math.min(book.opponentMoves,evidence),
    replyCount,
    forcingReplyRate,
    kingAttackReplyRate,
    captureReplyRate,
    repetitionPressure,
    actualReplyFeatures:actualReplyAvailable?Array.from(actualReplyAvailable):[],
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
  // Same style mechanism for every sibling; personality lives only in numbers.
  const advantageRange=Math.max(1,Number(profile.advantageRange)||580);
  const ahead=armxFullClamp(
    (hostScore-(Number(profile.aheadThreshold)||0))/advantageRange,0,1
  );
  const behind=armxFullClamp(
    (-hostScore-(Number(profile.behindThreshold)||0))/advantageRange,0,1
  );

  let signal=0;
  for(const feature of features){
    signal+=(profile.weights[feature]||0)
      +ahead*(profile.aheadWeights[feature]||0)
      +behind*(profile.behindWeights[feature]||0);
  }

  const replyCount=Number(response.replyCount)||0;
  const compression=replyCount?armxFullClamp((24-replyCount)/18,-1,1):0;
  signal+=profile.replyCompressionWeight*compression;
  signal+=((profile.opponentForcingReplyWeight||0)
      +behind*(profile.behindForcingReplyWeight||0))
    *(Number(response.forcingReplyRate)||0);
  signal+=((profile.opponentKingAttackReplyWeight||0)
      +behind*(profile.behindKingAttackReplyWeight||0))
    *(Number(response.kingAttackReplyRate)||0);
  signal+=((profile.opponentCaptureReplyWeight||0)
      +behind*(profile.behindCaptureReplyWeight||0))
    *(Number(response.captureReplyRate)||0);
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
  const patient=Math.max(0,tendencies.patient);
  const aggressive=Math.max(0,tendencies.aggressive);
  const forcingCandidate=(features.includes('forcing')?1:0)
    +(features.includes('check')?0.65:0)
    +(features.includes('kingAttack')?0.45:0);
  const defensiveCandidate=(features.includes('quiet')?0.75:0)
    +(features.includes('retreat')?0.55:0)
    +(features.includes('castle')?0.70:0)
    -(features.includes('forcing')?0.35:0);
  signal+=patient*(profile.patientPressureWeight||0)*forcingCandidate;
  signal+=aggressive*(profile.aggressiveDefenseWeight||0)*defensiveCandidate;

  const opponentMultiplier=1
    +profile.patientOpponentScale*patient
    +profile.aggressiveOpponentScale*aggressive;
  const positionMultiplier=1+profile.aheadScale*ahead+profile.behindScale*behind;
  const scale=profile.baseScale*Math.max(0.15,paceMultiplier)*positionMultiplier*opponentMultiplier;
  const max=ARMX_FULL.maxStyleAdjustment[style]||0;
  return {
    signal,scale,adjustment:armxFullClamp(signal*scale,-max,max),
    tendencies,compression,repetitionPressure,
    forcingReplyRate:Number(response.forcingReplyRate)||0,
    kingAttackReplyRate:Number(response.kingAttackReplyRate)||0,
    captureReplyRate:Number(response.captureReplyRate)||0,
  };
}
function armxFullMateScale(entry){
  if(!entry)return false;
  const mate=typeof STONEFISH_V5_PRO_MATE==='number'?STONEFISH_V5_PRO_MATE
    :(typeof STONEFISH_V5_MATE==='number'?STONEFISH_V5_MATE:20000000);
  return (Number.isFinite(entry.deep)&&Math.abs(entry.deep)>=mate*0.9)
    ||(Number.isFinite(entry.score)&&Math.abs(entry.score)>=mate*0.9);
}
function armxFullReview(game,finished,style='artemis',perspective=game.side){
  let book=armxFullSyncNotebook(game,perspective);
  let previewProfile=book.previewProfile;
  if(!previewProfile){
    previewProfile=armxPreviewSyncProfile(game,perspective);
    book=armxFullSyncNotebook(game,perspective,previewProfile);
  }
  const maturity=armxFullNotebookMaturity(book);
  const candidates=(finished||[]).filter(entry=>entry&&Number.isFinite(entry.score))
    .slice(0,ARMX_FULL.candidateLimit);
  if(!candidates.length)return {reports:[],winner:null,book,maturity};

  const hostBest=candidates[0];
  const reports=candidates.map(entry=>{
    const previewReport=armxPreviewCandidateReport(game,entry,previewProfile);
    const response=armxFullCandidateResponseReport(game,entry,book,previewReport,style);

    // Preview is the proven subset. Full ARMX adds only contextual information
    // that Preview does not already encode, avoiding double-counted evidence.
    const previewAdjustment=(Number(previewReport.adjustment)||0)*ARMX_FULL.previewDecisionGain;
    const noteConfidence=armxFullClamp(response.evidence/ARMX_FULL.fullConfidenceEvidence,0,1);
    const learnedSignal=response.expectedOpponentOutcome;
    const noteAdjustment=armxFullClamp(
      learnedSignal*ARMX_FULL.fullNoteScale*noteConfidence*maturity,
      -ARMX_FULL.maxNoteAdjustment,ARMX_FULL.maxNoteAdjustment
    );
    const adaptiveAdjustment=previewAdjustment+noteAdjustment;

    const styleResult=armxFullStyleAdjustment(game,entry,response,style,hostBest,book);
    const hostGap=hostBest.score-entry.score;
    const deepSacrifice=Number.isFinite(hostBest.deep)&&Number.isFinite(entry.deep)
      ?hostBest.deep-entry.deep:hostGap;
    const styleProfile=ARMX_FULL.styleProfiles[style]||ARMX_FULL.styleProfiles.artemis;
    const hostScore=Number(hostBest&&hostBest.score)||0;
    const advantageRange=Math.max(1,Number(styleProfile.advantageRange)||580);
    const ahead=armxFullClamp(
      (hostScore-(Number(styleProfile.aheadThreshold)||0))/advantageRange,0,1
    );
    const behind=armxFullClamp(
      (-hostScore-(Number(styleProfile.behindThreshold)||0))/advantageRange,0,1
    );
    const allowedHostGap=styleProfile.maxHostGap
      +ahead*(styleProfile.aheadHostGapBonus||0)
      +behind*(styleProfile.behindHostGapBonus||0);
    const allowedDeepSacrifice=styleProfile.maxDeepSacrifice
      +ahead*(styleProfile.aheadDeepGapBonus||0)
      +behind*(styleProfile.behindDeepGapBonus||0);
    const protectedTruth=armxFullMateScale(hostBest)||armxFullMateScale(entry);
    const aheadSafetyFloor=Number.isFinite(styleProfile.aheadCandidateFloor)
      ?styleProfile.aheadCandidateFloor:-Infinity;
    const keepsWinningMargin=!ahead||Number(entry.score)>=aheadSafetyFloor;
    const objectiveEligible=entry===hostBest||(!protectedTruth&&keepsWinningMargin
      &&hostGap<=allowedHostGap&&deepSacrifice<=allowedDeepSacrifice);

    return {
      raw:entry.raw,
      hostScore:entry.score,
      hostDeep:entry.deep,
      adjustment:adaptiveAdjustment,
      signal:Number(previewReport.signal)||0,
      confidence:Number(previewReport.confidence)||0,
      evidence:Number(previewReport.evidence)||0,
      previewReport,
      entry,style,
      notebookResponse:response,
      maturity,
      previewAdjustment,
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
      objectiveEligible,eligible:objectiveEligible,fullScore:-Infinity,
    };
  });

  const provisionalReport=reports.find(report=>report.entry===hostBest)||reports[0];
  const observedPlies=Math.max(0,(game.historyStack?game.historyStack.length:0)
    -Math.max(0,Math.trunc(Number(game.armxObservationStartPly)||0)));
  const gateHost=Object.assign({},hostBest,{armxOriginalScore:hostBest.score});
  const gateStyleProfile=ARMX_FULL.styleProfiles[style]||ARMX_FULL.styleProfiles.artemis;

  for(const report of reports){
    if(report===provisionalReport){
      report.eligible=true;
      report.previewGate={allowed:true,reason:'provisional'};
      report.fullNoteGate={allowed:true,reason:'provisional'};
      report.styleGate={allowed:true,reason:'provisional'};
      report.previewLead=0;
      report.noteLead=0;
      report.styleLead=0;
      report.decisionLead=0;
      // Anchor the ranking on the native provisional score. Every adaptive
      // contribution below is a pairwise lead relative to this same move.
      report.fullScore=report.entry.score;
      continue;
    }

    let previewGate={allowed:false,reason:'preview-gate-unavailable'};
    if(typeof stonefishV55ARMXChangeDecision==='function'){
      const gateEntry=Object.assign({},report.entry,{armxOriginalScore:report.entry.score});
      previewGate=stonefishV55ARMXChangeDecision(
        gateHost,gateEntry,provisionalReport.previewReport,report.previewReport,observedPlies
      );
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
    const minStyleLead=Number(gateStyleProfile.minStyleLead);
    const styleAllowed=style!=='artemis'
      &&styleLead>=(Number.isFinite(minStyleLead)?minStyleLead:Infinity);

    // Preserve frozen Preview's exact pairwise vote. Preview itself chooses the
    // gain (normally 1.25x, 1.60x only for mature contrastive evidence).
    const previewGain=previewGate.allowed&&Number.isFinite(previewGate.decisionGain)
      ?previewGate.decisionGain:STONEFISH_V5_5_ARMX_DECISION_GAIN;
    const previewLead=previewGate.allowed
      ?stonefishV55ARMXDecisionScore(report.previewReport,previewGain)
        -stonefishV55ARMXDecisionScore(provisionalReport.previewReport,previewGain)
      :0;
    const noteLead=fullNoteAllowed
      ?(Number(report.noteAdjustment)||0)-(Number(provisionalReport.noteAdjustment)||0)
      :0;
    const appliedStyleLead=styleAllowed?styleLead:0;
    const hostLead=(Number(report.entry.score)||0)-(Number(provisionalReport.entry.score)||0);
    // previewLead already contains the native host-score difference. If Preview
    // is not voting, Full notes/style must carry the native gap themselves.
    const effectiveLead=previewGate.allowed
      ?previewLead+noteLead+appliedStyleLead
      :hostLead+noteLead+appliedStyleLead;

    report.previewGate=previewGate;
    report.fullNoteGate={
      allowed:fullNoteAllowed,
      responseEvidence,noteConfidence,notebookDecisionLead,signalQuality,earlyEvidence,
    };
    report.styleGate={allowed:styleAllowed,styleLead};
    report.previewLead=previewLead;
    report.noteLead=noteLead;
    report.styleLead=appliedStyleLead;
    report.decisionLead=effectiveLead;
    report.eligible=Boolean(report.objectiveEligible
      &&(previewGate.allowed||fullNoteAllowed||styleAllowed)
      &&effectiveLead>0);
    report.fullScore=report.eligible
      ?provisionalReport.entry.score+effectiveLead
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
    voluntaryOpponentMoves:book.voluntaryOpponentMoves,
    maturity,
    noteUsefulness:Number(book.lastPolicyTelemetry&&book.lastPolicyTelemetry.noteUsefulness)||0,
    learnedStrength:Number(book.lastPolicyTelemetry&&book.lastPolicyTelemetry.learnedStrength)||0,
    predictionSurprise:Number(book.lastPolicyTelemetry&&book.lastPolicyTelemetry.surprise)||0,
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
