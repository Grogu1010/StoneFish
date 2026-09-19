// ARMX-preview — per-game opponent adaptation model for Stonefish v5.5.
//
// ARMX is intentionally a separate model from Stonefish. It does not search the
// move tree and it does not reuse Stonefish evaluation. Instead it watches the
// actual game, builds a small profile of this opponent's choices and of what has
// worked (or failed) against them, then applies bounded evidence-based multipliers
// to Stonefish's already-searched candidates. The profile lives in a WeakMap keyed
// by the game object, so it automatically resets between games/rounds.

const ARMX_PREVIEW = Object.freeze({
  name: 'ARMX-preview',
  version: 'preview-native-calibration',
  kind: 'opponent-adaptation',
  reset: 'per-game',
  candidateLimit: 3,
  baseCandidateLimit: 2,
  expandedCandidateMinPlies: 36,
  expandedCandidateMinEvidence: 5.5,
  thirdCandidateMinSignal: 0.20,
  thirdCandidateMinConfidence: 0.90,
  thirdCandidateMinEvidence: 5.5,
  minEvidence: 1.25,
  fullConfidenceEvidence: 5.5,
  maxMultiplierDelta: 0.18,
  multiplierSignalScale: 0.18,
  opponentSignalWeight: 1.10,
  responseOutcomeWeight: 0.65,
  acceptedResponseWeight: 0.75,
  effectScale: 360,
  episodeFeatureWeight: 0.55,
  maxHostGap: 40,
  maxDeepSacrifice: 25,
  minOverrideEvidence: 3.5,
  minOverrideConfidence: 0.65,
  minAdaptedLead: 2,
  earlyOverridePlies: 20,
  earlyOverrideEvidence: 5,
  earlyOverrideConfidence: 0.90,
  shortHorizonPlies: 2,
  longHorizonPlies: 4,
});

const ARMX_PREVIEW_GAME_PROFILES = new WeakMap();
const ARMX_PREVIEW_FEATURES = Object.freeze([
  'capture', 'trade', 'rookTrade', 'queenTrade', 'minorTrade', 'simplify',
  'check', 'kingAttack', 'pawnPush', 'castle', 'quiet', 'advance', 'retreat'
]);
const ARMX_PREVIEW_REPLY_FEATURES = Object.freeze([
  'capture', 'trade', 'rookTrade', 'queenTrade', 'simplify'
]);
const ARMX_PREVIEW_PIECE_VALUES = Object.freeze([0, 100, 320, 335, 510, 930, 0]);

function armxPreviewClamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function armxPreviewSquareDistance(a, b) {
  const af = a & 7, ar = a >> 3, bf = b & 7, br = b >> 3;
  return Math.max(Math.abs(af - bf), Math.abs(ar - br));
}

function armxPreviewStateSnapshot(game, perspective) {
  let score = 0;
  const material = {
    whiteRooks: 0,
    blackRooks: 0,
    whiteQueens: 0,
    blackQueens: 0,
    whiteMinors: 0,
    blackMinors: 0,
    whiteNonPawn: 0,
    blackNonPawn: 0,
  };
  const board = game.boardState;
  const enemyKing = game.kingSq[-perspective];
  const ourKing = game.kingSq[perspective];

  for (let sq = 0; sq < 64; sq += 1) {
    const piece = board[sq];
    if (!piece) continue;
    const side = piece > 0 ? 1 : -1;
    const type = Math.abs(piece);
    const sign = side === perspective ? 1 : -1;
    score += sign * ARMX_PREVIEW_PIECE_VALUES[type];

    if (type >= 2 && type <= 5) {
      if (side === 1) material.whiteNonPawn += 1;
      else material.blackNonPawn += 1;
    }
    if (type === 4) {
      if (side === 1) material.whiteRooks += 1;
      else material.blackRooks += 1;
    } else if (type === 5) {
      if (side === 1) material.whiteQueens += 1;
      else material.blackQueens += 1;
    } else if (type === 2 || type === 3) {
      if (side === 1) material.whiteMinors += 1;
      else material.blackMinors += 1;
    }

    const file = sq & 7;
    const rank = sq >> 3;
    const centerDistance = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
    if (type === 2 || type === 3) score += sign * (18 - centerDistance * 3);
    if (type === 1) {
      const advance = side === 1 ? rank - 1 : 6 - rank;
      score += sign * Math.max(0, advance) * 5;
    }

    if (side === perspective && type !== 6 && armxPreviewSquareDistance(sq, enemyKing) <= 2) score += 12;
    if (side !== perspective && type !== 6 && armxPreviewSquareDistance(sq, ourKing) <= 2) score -= 12;
  }
  return { score, material };
}

function armxPreviewModelEval(game, perspective) {
  return armxPreviewStateSnapshot(game, perspective).score;
}

function armxPreviewFeatureSet(game, move) {
  const features = new Set();
  if (!move) return features;
  const piece = move.piece || Math.abs(game.boardState[move.from] || 0);
  const captured = move.captured || 0;
  const moveValue = ARMX_PREVIEW_PIECE_VALUES[piece] || 0;
  const capturedValue = ARMX_PREVIEW_PIECE_VALUES[captured] || 0;

  if (captured) features.add('capture');
  if (captured && piece > 1 && captured > 1 && Math.abs(moveValue - capturedValue) <= 180) features.add('trade');
  if (captured && piece === 4 && captured === 4) features.add('rookTrade');
  if (captured && piece === 5 && captured === 5) features.add('queenTrade');
  if (captured && (piece === 2 || piece === 3) && (captured === 2 || captured === 3)) features.add('minorTrade');
  if (captured >= 2) features.add('simplify');
  if (piece === 1) features.add('pawnPush');
  if (move.flags & (4 | 8)) features.add('castle');

  let givesCheck = false;
  if (typeof game.fastGivesCheck === 'function') givesCheck = game.fastGivesCheck(move);
  if (givesCheck) features.add('check');
  const enemyKing = game.kingSq[-game.side];
  if (givesCheck || (piece !== 6 && armxPreviewSquareDistance(move.to, enemyKing) <= 2)) features.add('kingAttack');

  const fromRank = move.from >> 3;
  const toRank = move.to >> 3;
  const forward = game.side === 1 ? toRank - fromRank : fromRank - toRank;
  if (forward > 0) features.add('advance');
  if (forward < 0) features.add('retreat');
  if (!captured && !givesCheck && !move.promotion && !(move.flags & (4 | 8))) features.add('quiet');
  return features;
}

function armxPreviewCheapFeatureSet(move) {
  const features = new Set();
  if (!move) return features;
  const piece = move.piece || 0;
  const captured = move.captured || 0;
  const moveValue = ARMX_PREVIEW_PIECE_VALUES[piece] || 0;
  const capturedValue = ARMX_PREVIEW_PIECE_VALUES[captured] || 0;
  if (captured) features.add('capture');
  if (captured && piece > 1 && captured > 1 && Math.abs(moveValue - capturedValue) <= 180) features.add('trade');
  if (captured && piece === 4 && captured === 4) features.add('rookTrade');
  if (captured && piece === 5 && captured === 5) features.add('queenTrade');
  if (captured >= 2) features.add('simplify');
  return features;
}

function armxPreviewFreshStats() {
  const stats = Object.create(null);
  for (const feature of ARMX_PREVIEW_FEATURES) {
    stats[feature] = { weight: 0, impact: 0, positive: 0, observations: new Set() };
  }
  return stats;
}

function armxPreviewNewProfile(perspective, game = null, observationStartPly = 0) {
  const replay = new Chess();
  // Recover the actual starting board, including positions supplied with a
  // partial history. Never pretend an arbitrary position began at move one.
  if (game) {
    replay.boardState = new Int8Array(game.boardState);
    replay.side = game.side;
    replay.castling = game.castling;
    replay.ep = game.ep;
    replay.halfmove = game.halfmove;
    replay.fullmove = game.fullmove;
    replay.kingSq = { 1: game.kingSq[1], '-1': game.kingSq[-1] };
    replay.historyStack = (game.historyStack || []).slice();
    replay.positionCounts = new Map(game.positionCounts);
    replay._stonefishRuntimePositionKey = null;
    while (replay.historyStack.length) replay.fastUndo();
  }
  return {
    perspective,
    processedPlies: 0,
    observationStartPly,
    lastHistoryState: null,
    initialPositionKey: replay.fastPositionKey(),
    replay,
    currentSnapshot: armxPreviewStateSnapshot(replay, perspective),
    pending: [],
    pendingOffer: null,
    ourEffects: armxPreviewFreshStats(),
    opponentEffects: armxPreviewFreshStats(),
    acceptedResponseEffects: armxPreviewFreshStats(),
    opponentMoves: 0,
    opponentChoices: Object.create(null),
    opponentOpportunities: Object.create(null),
    opponentOpportunityPlies: Object.create(null),
    notes: [],
  };
}

function armxPreviewRecordImpact(bucket, features, impact, weight, observationId) {
  const normalized = armxPreviewClamp(impact / ARMX_PREVIEW.effectScale, -1, 1);
  for (const feature of features) {
    const row = bucket[feature];
    if (!row) continue;
    row.weight += weight;
    row.impact += normalized * weight;
    if (normalized > 0) row.positive += weight;
    if (observationId !== undefined) row.observations.add(observationId);
  }
}

function armxPreviewEpisodeFeatures(baseFeatures, before, after) {
  const derived = new Set();
  if (!before || !after) return derived;
  const bothDropped = (whiteKey, blackKey) => after[whiteKey] < before[whiteKey]
    && after[blackKey] < before[blackKey];

  if (bothDropped('whiteRooks', 'blackRooks')) derived.add('rookTrade');
  if (bothDropped('whiteQueens', 'blackQueens')) derived.add('queenTrade');
  if (bothDropped('whiteMinors', 'blackMinors')) derived.add('minorTrade');
  if (bothDropped('whiteNonPawn', 'blackNonPawn')) {
    derived.add('trade');
    derived.add('simplify');
  }
  for (const feature of baseFeatures) derived.delete(feature);
  return derived;
}

function armxPreviewResolvePending(profile, currentPly, currentSnapshot = profile.currentSnapshot) {
  if (!profile.pending.length) return;
  const snapshot = currentSnapshot || armxPreviewStateSnapshot(profile.replay, profile.perspective);
  const now = snapshot.score;
  const keep = [];
  for (const event of profile.pending) {
    if (currentPly < event.resolveAt) {
      keep.push(event);
      continue;
    }
    const impact = now - event.before;
    const bucket = event.bucket === 'accepted-response'
      ? profile.acceptedResponseEffects
      : (event.actor === profile.perspective ? profile.ourEffects : profile.opponentEffects);
    armxPreviewRecordImpact(bucket, event.features, impact, event.weight, event.observationId);
    if (event.bucket !== 'accepted-response') {
      const episodeFeatures = armxPreviewEpisodeFeatures(event.features, event.beforeMaterial, snapshot.material);
      if (episodeFeatures.size) {
        armxPreviewRecordImpact(bucket, episodeFeatures, impact, event.weight * ARMX_PREVIEW.episodeFeatureWeight, event.observationId);
      }
    }
  }
  profile.pending = keep;
}

function armxPreviewObserveOpponentOpportunity(profile, game, chosenMove) {
  const legal = game.fastMoves();
  const available = new Set();
  for (const move of legal) {
    const features = armxPreviewCheapFeatureSet(move);
    for (const feature of ARMX_PREVIEW_REPLY_FEATURES) if (features.has(feature)) available.add(feature);
  }
  const chosen = armxPreviewCheapFeatureSet(chosenMove);
  profile.opponentMoves += 1;
  for (const feature of ARMX_PREVIEW_REPLY_FEATURES) {
    if (available.has(feature)) {
      profile.opponentOpportunities[feature] = (profile.opponentOpportunities[feature] || 0) + 1;
      if (chosen.has(feature)) profile.opponentChoices[feature] = (profile.opponentChoices[feature] || 0) + 1;
      if (!profile.opponentOpportunityPlies[feature]) profile.opponentOpportunityPlies[feature] = new Set();
      profile.opponentOpportunityPlies[feature].add(profile.processedPlies);
    }
  }
  return { available, chosen, move: chosenMove, actor: game.side };
}

function armxPreviewCapturedSquare(move, actor) {
  if (!move || !move.captured) return -1;
  return move.flags & 2 ? move.to - actor * 8 : move.to;
}

function armxPreviewRecordAcceptedResponse(profile, observed, opponentPlyIndex) {
  const offer = profile.pendingOffer;
  profile.pendingOffer = null;
  if (!offer || !observed || opponentPlyIndex !== offer.index + 1) return;
  // A capture elsewhere is an opponent choice, but is not acceptance of the
  // piece we just offered. Keep this more specific outcome memory attributable.
  if (armxPreviewCapturedSquare(observed.move, observed.actor) !== offer.to) return;
  const accepted = new Set();
  for (const feature of ARMX_PREVIEW_REPLY_FEATURES) {
    if (observed.available.has(feature) && observed.chosen.has(feature)) accepted.add(feature);
  }
  if (!accepted.size) return;

  profile.pending.push({
    bucket: 'accepted-response',
    observationId: opponentPlyIndex,
    features: accepted,
    before: offer.before,
    resolveAt: offer.index + ARMX_PREVIEW.shortHorizonPlies,
    weight: 0.65,
  });
  profile.pending.push({
    bucket: 'accepted-response',
    observationId: opponentPlyIndex,
    features: accepted,
    before: offer.before,
    resolveAt: offer.index + ARMX_PREVIEW.longHorizonPlies,
    weight: 0.35,
  });
}

function armxPreviewSyncProfile(game, perspective) {
  let profiles = ARMX_PREVIEW_GAME_PROFILES.get(game);
  if (!profiles) {
    profiles = new Map();
    ARMX_PREVIEW_GAME_PROFILES.set(game, profiles);
  }
  let profile = profiles.get(perspective);
  const historyLength = game.historyStack ? game.historyStack.length : 0;
  const history = game.historyStack || [];
  const observationStartPly = Math.max(0, Math.trunc(Number(game.armxObservationStartPly) || 0));
  const changedHistory = profile && profile.processedPlies > 0
    && history[profile.processedPlies - 1] !== profile.lastHistoryState;
  const changedEmptyPosition = profile && !historyLength
    && game.fastPositionKey() !== profile.initialPositionKey;
  if (!profile || historyLength < profile.processedPlies || changedHistory
    || changedEmptyPosition || profile.observationStartPly !== observationStartPly) {
    profile = armxPreviewNewProfile(perspective, game, observationStartPly);
    profiles.set(perspective, profile);
  }

  while (profile.processedPlies < history.length) {
    const index = profile.processedPlies;
    const state = history[index];
    const move = state && state.move;
    if (!move) break;
    // Seeded openings provide board history, not evidence about this opponent.
    if (index < observationStartPly) {
      profile.replay.fastApply(move);
      profile.currentSnapshot = armxPreviewStateSnapshot(profile.replay, perspective);
      profile.processedPlies += 1;
      profile.lastHistoryState = state;
      continue;
    }
    const actor = profile.replay.side;
    const before = profile.currentSnapshot.score;
    const beforeMaterial = profile.currentSnapshot.material;
    const features = armxPreviewFeatureSet(profile.replay, move);

    if (actor === -perspective) {
      const observed = armxPreviewObserveOpponentOpportunity(profile, profile.replay, move);
      armxPreviewRecordAcceptedResponse(profile, observed, index);
    }

    profile.pending.push({ actor, features, before, beforeMaterial, observationId: index, resolveAt: index + ARMX_PREVIEW.shortHorizonPlies, weight: 0.65 });
    profile.pending.push({ actor, features, before, beforeMaterial, observationId: index, resolveAt: index + ARMX_PREVIEW.longHorizonPlies, weight: 0.35 });

    profile.replay.fastApply(move);
    profile.currentSnapshot = armxPreviewStateSnapshot(profile.replay, perspective);
    profile.processedPlies += 1;
    profile.lastHistoryState = state;
    armxPreviewResolvePending(profile, profile.processedPlies, profile.currentSnapshot);

    if (actor === perspective) profile.pendingOffer = { before, index, to: move.to };
  }

  armxPreviewResolvePending(profile, profile.processedPlies, profile.currentSnapshot);
  return profile;
}

function armxPreviewEffect(stats, feature) {
  const row = stats[feature];
  if (!row || row.weight < ARMX_PREVIEW.minEvidence) return { value: 0, evidence: row ? row.weight : 0 };
  return { value: row.impact / row.weight, evidence: row.weight };
}

function armxPreviewOpponentChoiceRate(profile, feature) {
  const opportunities = profile.opponentOpportunities[feature] || 0;
  if (!opportunities) return { rate: 0, evidence: 0 };
  // A uniform Beta prior prevents one forced capture becoming a 100% habit.
  return { rate: ((profile.opponentChoices[feature] || 0) + 1) / (opportunities + 2), evidence: opportunities };
}

function armxPreviewHasUsefulReplyEvidence(profile) {
  for (const feature of ARMX_PREVIEW_REPLY_FEATURES) {
    const choiceEvidence = profile.opponentOpportunities[feature] || 0;
    if (choiceEvidence < 2) continue;
    const opponent = profile.opponentEffects[feature];
    if (opponent && opponent.weight >= ARMX_PREVIEW.minEvidence) return true;
    const ours = profile.ourEffects[feature];
    if (choiceEvidence >= 3 && ours && ours.weight >= ARMX_PREVIEW.minEvidence) return true;
    const accepted = profile.acceptedResponseEffects[feature];
    if (accepted && accepted.weight >= ARMX_PREVIEW.minEvidence) return true;
  }
  return false;
}

function armxPreviewProfileMatureForThirdCandidate(profile) {
  if (!profile || profile.processedPlies - profile.observationStartPly < ARMX_PREVIEW.expandedCandidateMinPlies) return false;
  for (const feature of ARMX_PREVIEW_FEATURES) {
    const ours = profile.ourEffects[feature];
    const opponent = profile.opponentEffects[feature];
    const accepted = profile.acceptedResponseEffects[feature];
    if (ours && ours.weight >= ARMX_PREVIEW.expandedCandidateMinEvidence) return true;
    if (opponent && opponent.weight >= ARMX_PREVIEW.expandedCandidateMinEvidence) return true;
    if (accepted && accepted.weight >= ARMX_PREVIEW.expandedCandidateMinEvidence) return true;
  }
  return false;
}

function armxPreviewCandidateReplyOpportunities(game, raw) {
  const historyDepth = game.historyStack.length;
  const available = new Set();
  const offered = new Set();
  try {
    game.fastApply(raw);
    for (const reply of game.fastMoves()) {
      const features = armxPreviewCheapFeatureSet(reply);
      for (const feature of ARMX_PREVIEW_REPLY_FEATURES) if (features.has(feature)) available.add(feature);
      if (armxPreviewCapturedSquare(reply, game.side) === raw.to) {
        for (const feature of ARMX_PREVIEW_REPLY_FEATURES) if (features.has(feature)) offered.add(feature);
      }
    }
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
  return { available, offered };
}

function armxPreviewCandidateReport(game, entry, profile) {
  const features = armxPreviewFeatureSet(game, entry.raw);
  const replyOptions = armxPreviewHasUsefulReplyEvidence(profile)
    ? armxPreviewCandidateReplyOpportunities(game, entry.raw)
    : { available: new Set(), offered: new Set() };
  let signal = 0;
  let evidence = 0;
  const independentObservations = new Set();
  const recordObservations = observations => {
    for (const observation of observations || []) independentObservations.add(observation);
  };
  const reasons = [];

  for (const feature of features) {
    const effect = armxPreviewEffect(profile.ourEffects, feature);
    if (effect.evidence < ARMX_PREVIEW.minEvidence) continue;
    recordObservations(profile.ourEffects[feature].observations);
    const weight = feature === 'rookTrade' || feature === 'queenTrade' ? 1.45
      : feature === 'trade' || feature === 'simplify' ? 1.15 : 0.72;
    signal += effect.value * weight;
    evidence += Math.min(3, effect.evidence) * weight;
    if (Math.abs(effect.value) >= 0.12) reasons.push(`${feature}:${effect.value > 0 ? '+' : ''}${effect.value.toFixed(2)}`);
  }

  for (const feature of replyOptions.available) {
    const choice = armxPreviewOpponentChoiceRate(profile, feature);
    const opponentEffect = armxPreviewEffect(profile.opponentEffects, feature);
    if (choice.evidence >= 2 && opponentEffect.evidence >= ARMX_PREVIEW.minEvidence) {
      recordObservations(profile.opponentOpportunityPlies[feature]);
      recordObservations(profile.opponentEffects[feature].observations);
      const propensity = choice.rate * choice.rate;
      const contribution = propensity * opponentEffect.value * ARMX_PREVIEW.opponentSignalWeight;
      signal += contribution;
      evidence += Math.min(2.5, (choice.evidence * 0.35 + opponentEffect.evidence * 0.25) * Math.max(0.25, choice.rate));
      if (Math.abs(contribution) >= 0.08) reasons.push(`opp-${feature}:${Math.round(choice.rate * 100)}%/${opponentEffect.value > 0 ? '+' : ''}${opponentEffect.value.toFixed(2)}`);
    }

    const ourEffect = armxPreviewEffect(profile.ourEffects, feature);
    if (choice.evidence >= 3 && ourEffect.evidence >= ARMX_PREVIEW.minEvidence) {
      recordObservations(profile.opponentOpportunityPlies[feature]);
      recordObservations(profile.ourEffects[feature].observations);
      const reliability = armxPreviewClamp((choice.evidence - 1) / 6, 0.25, 1);
      const expectedOutcome = choice.rate * ourEffect.value * ARMX_PREVIEW.responseOutcomeWeight * reliability;
      signal += expectedOutcome;
      evidence += Math.min(1.75, ourEffect.evidence * 0.20 + choice.evidence * 0.12) * Math.max(0.2, choice.rate);
      if (Math.abs(expectedOutcome) >= 0.06) reasons.push(`offer-${feature}:${Math.round(choice.rate * 100)}%/${ourEffect.value > 0 ? '+' : ''}${ourEffect.value.toFixed(2)}`);
    }

    const acceptedEffect = armxPreviewEffect(profile.acceptedResponseEffects, feature);
    if (replyOptions.offered.has(feature) && choice.evidence >= 2 && acceptedEffect.evidence >= ARMX_PREVIEW.minEvidence) {
      recordObservations(profile.opponentOpportunityPlies[feature]);
      recordObservations(profile.acceptedResponseEffects[feature].observations);
      const reliability = armxPreviewClamp(acceptedEffect.evidence / ARMX_PREVIEW.fullConfidenceEvidence, 0.25, 1);
      const acceptedOutcome = choice.rate * acceptedEffect.value
        * ARMX_PREVIEW.acceptedResponseWeight * reliability;
      signal += acceptedOutcome;
      evidence += Math.min(2.25, acceptedEffect.evidence * 0.32 + choice.evidence * 0.10)
        * Math.max(0.25, choice.rate);
      if (Math.abs(acceptedOutcome) >= 0.06) {
        reasons.push(`accepted-${feature}:${Math.round(choice.rate * 100)}%/${acceptedEffect.value > 0 ? '+' : ''}${acceptedEffect.value.toFixed(2)}`);
      }
    }
  }

  const featureEvidence = evidence;
  // Correlated labels and the two horizons do not create new observations.
  evidence = Math.min(evidence, independentObservations.size);
  const confidence = armxPreviewClamp(evidence / ARMX_PREVIEW.fullConfidenceEvidence, 0, 1);
  const delta = armxPreviewClamp(signal * ARMX_PREVIEW.multiplierSignalScale * confidence, -ARMX_PREVIEW.maxMultiplierDelta, ARMX_PREVIEW.maxMultiplierDelta);
  const multiplier = 1 + delta;
  const scoreMagnitude = armxPreviewClamp(Math.abs(entry.score || 0), 180, 1600);
  const adjustment = scoreMagnitude * delta;
  return {
    raw: entry.raw,
    hostScore: entry.score,
    hostDeep: entry.deep,
    multiplier,
    adjustment,
    adaptedScore: entry.score + adjustment,
    signal,
    confidence,
    evidence,
    featureEvidence,
    independentObservations: independentObservations.size,
    features: Array.from(features),
    reasons,
  };
}

function armxPreviewProfileNotes(profile) {
  const notes = [];
  const important = ['rookTrade', 'queenTrade', 'minorTrade', 'trade', 'simplify', 'capture', 'kingAttack', 'quiet'];
  for (const feature of important) {
    const ours = armxPreviewEffect(profile.ourEffects, feature);
    if (ours.evidence >= ARMX_PREVIEW.minEvidence && Math.abs(ours.value) >= 0.14) {
      notes.push(`${feature} against opponent has been ${ours.value > 0 ? 'working' : 'hurting us'} (${ours.value > 0 ? '+' : ''}${ours.value.toFixed(2)}, n=${ours.evidence.toFixed(1)})`);
    }
    const accepted = armxPreviewEffect(profile.acceptedResponseEffects, feature);
    if (accepted.evidence >= ARMX_PREVIEW.minEvidence && Math.abs(accepted.value) >= 0.16) {
      notes.push(`opponent accepting ${feature} has been ${accepted.value > 0 ? 'working for us' : 'hurting us'} (${accepted.value > 0 ? '+' : ''}${accepted.value.toFixed(2)}, n=${accepted.evidence.toFixed(1)})`);
    }
    const choice = armxPreviewOpponentChoiceRate(profile, feature);
    if (choice.evidence >= 3 && (choice.rate >= 0.70 || choice.rate <= 0.25)) {
      notes.push(`opponent ${choice.rate >= 0.70 ? 'often' : 'rarely'} chooses ${feature} when available (${Math.round(choice.rate * 100)}%)`);
    }
  }
  return notes.slice(0, 6);
}

function armxPreviewReview(game, candidates, perspective = game.side) {
  const profile = armxPreviewSyncProfile(game, perspective);
  const expanded = armxPreviewProfileMatureForThirdCandidate(profile);
  const reviewLimit = expanded ? ARMX_PREVIEW.candidateLimit : ARMX_PREVIEW.baseCandidateLimit;
  const finalists = candidates.filter(entry => entry && Number.isFinite(entry.score)).slice(0, reviewLimit);
  const candidateReports = finalists.map(entry => armxPreviewCandidateReport(game, entry, profile));
  const reports = candidateReports.filter((report, index) => {
    if (index < ARMX_PREVIEW.baseCandidateLimit) return true;
    return report.signal >= ARMX_PREVIEW.thirdCandidateMinSignal
      && report.confidence >= ARMX_PREVIEW.thirdCandidateMinConfidence
      && report.evidence >= ARMX_PREVIEW.thirdCandidateMinEvidence;
  });
  reports.sort((a, b) => b.adaptedScore - a.adaptedScore);
  profile.notes = armxPreviewProfileNotes(profile);

  return {
    model: ARMX_PREVIEW.name,
    version: ARMX_PREVIEW.version,
    kind: ARMX_PREVIEW.kind,
    reset: ARMX_PREVIEW.reset,
    observedPlies: Math.max(0, profile.processedPlies - profile.observationStartPly),
    opponentMovesObserved: profile.opponentMoves,
    notes: profile.notes.slice(),
    candidateLimitUsed: reviewLimit,
    expandedCandidateReview: expanded,
    thirdCandidateAccepted: reports.length > ARMX_PREVIEW.baseCandidateLimit,
    candidatesReviewed: reports.length,
    reports,
    nodes: 0,
  };
}

function armxPreviewResetGame(game) {
  if (game) ARMX_PREVIEW_GAME_PROFILES.delete(game);
}

if (typeof globalThis !== 'undefined') {
  globalThis.ARMX_PREVIEW = ARMX_PREVIEW;
  globalThis.armxPreviewReview = armxPreviewReview;
  globalThis.armxPreviewResetGame = armxPreviewResetGame;
}
