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
  version: 'preview-adapt5',
  kind: 'opponent-adaptation',
  reset: 'per-game',
  candidateLimit: 2,
  minEvidence: 1.25,
  fullConfidenceEvidence: 5.5,
  maxMultiplierDelta: 0.18,
  multiplierSignalScale: 0.18,
  opponentSignalWeight: 1.10,
  responseOutcomeWeight: 0.65,
  effectScale: 360,
  episodeFeatureWeight: 0.55,
  maxHostGap: 260,
  maxDeepSacrifice: 55,
  minOverrideEvidence: 3.5,
  minOverrideConfidence: 0.65,
  minAdaptedLead: 12,
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
  // Independent, intentionally small ARMX evaluation. It is not Stonefish's
  // evaluator: material + activity + king-zone presence + pawn advancement.
  // Material counts are gathered in the same pass so ARMX can recognize exchange
  // episodes without adding another board scan per observed ply.
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
    stats[feature] = { weight: 0, impact: 0, positive: 0 };
  }
  return stats;
}

function armxPreviewNewProfile(perspective) {
  const replay = new Chess();
  return {
    perspective,
    processedPlies: 0,
    replay,
    currentSnapshot: armxPreviewStateSnapshot(replay, perspective),
    pending: [],
    ourEffects: armxPreviewFreshStats(),
    opponentEffects: armxPreviewFreshStats(),
    opponentMoves: 0,
    opponentChoices: Object.create(null),
    opponentOpportunities: Object.create(null),
    notes: [],
  };
}

function armxPreviewRecordImpact(bucket, features, impact, weight) {
  const normalized = armxPreviewClamp(impact / ARMX_PREVIEW.effectScale, -1, 1);
  for (const feature of features) {
    const row = bucket[feature];
    if (!row) continue;
    row.weight += weight;
    row.impact += normalized * weight;
    if (normalized > 0) row.positive += weight;
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
    const bucket = event.actor === profile.perspective ? profile.ourEffects : profile.opponentEffects;
    armxPreviewRecordImpact(bucket, event.features, impact, event.weight);
    const episodeFeatures = armxPreviewEpisodeFeatures(
      event.features,
      event.beforeMaterial,
      snapshot.material
    );
    if (episodeFeatures.size) {
      armxPreviewRecordImpact(
        bucket,
        episodeFeatures,
        impact,
        event.weight * ARMX_PREVIEW.episodeFeatureWeight
      );
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
    }
  }
}

function armxPreviewSyncProfile(game, perspective) {
  let profile = ARMX_PREVIEW_GAME_PROFILES.get(game);
  const historyLength = game.historyStack ? game.historyStack.length : 0;
  if (!profile || profile.perspective !== perspective || historyLength < profile.processedPlies) {
    profile = armxPreviewNewProfile(perspective);
    ARMX_PREVIEW_GAME_PROFILES.set(game, profile);
  }

  const history = game.historyStack || [];
  while (profile.processedPlies < history.length) {
    const index = profile.processedPlies;
    const state = history[index];
    const move = state && state.move;
    if (!move) break;
    const actor = profile.replay.side;
    const before = profile.currentSnapshot.score;
    const beforeMaterial = profile.currentSnapshot.material;
    const features = armxPreviewFeatureSet(profile.replay, move);

    if (actor === -perspective) armxPreviewObserveOpponentOpportunity(profile, profile.replay, move);

    profile.pending.push({
      actor,
      features,
      before,
      beforeMaterial,
      resolveAt: index + ARMX_PREVIEW.shortHorizonPlies,
      weight: 0.65,
    });
    profile.pending.push({
      actor,
      features,
      before,
      beforeMaterial,
      resolveAt: index + ARMX_PREVIEW.longHorizonPlies,
      weight: 0.35,
    });

    profile.replay.fastApply(move);
    profile.currentSnapshot = armxPreviewStateSnapshot(profile.replay, perspective);
    profile.processedPlies += 1;
    armxPreviewResolvePending(profile, profile.processedPlies, profile.currentSnapshot);
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
  return {
    rate: (profile.opponentChoices[feature] || 0) / opportunities,
    evidence: opportunities,
  };
}

function armxPreviewCandidateReplyOpportunities(game, raw) {
  const historyDepth = game.historyStack.length;
  const available = new Set();
  try {
    game.fastApply(raw);
    for (const reply of game.fastMoves()) {
      const features = armxPreviewCheapFeatureSet(reply);
      for (const feature of ARMX_PREVIEW_REPLY_FEATURES) if (features.has(feature)) available.add(feature);
    }
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
  return available;
}

function armxPreviewCandidateReport(game, entry, profile) {
  const features = armxPreviewFeatureSet(game, entry.raw);
  const replyOpportunities = armxPreviewCandidateReplyOpportunities(game, entry.raw);
  let signal = 0;
  let evidence = 0;
  const reasons = [];

  for (const feature of features) {
    const effect = armxPreviewEffect(profile.ourEffects, feature);
    if (effect.evidence < ARMX_PREVIEW.minEvidence) continue;
    const weight = feature === 'rookTrade' || feature === 'queenTrade' ? 1.45
      : feature === 'trade' || feature === 'simplify' ? 1.15 : 0.72;
    signal += effect.value * weight;
    evidence += Math.min(3, effect.evidence) * weight;
    if (Math.abs(effect.value) >= 0.12) reasons.push(`${feature}:${effect.value > 0 ? '+' : ''}${effect.value.toFixed(2)}`);
  }

  for (const feature of replyOpportunities) {
    const choice = armxPreviewOpponentChoiceRate(profile, feature);
    const opponentEffect = armxPreviewEffect(profile.opponentEffects, feature);

    if (choice.evidence >= 2 && opponentEffect.evidence >= ARMX_PREVIEW.minEvidence) {
      // What the opponent actually tends to do matters: uncommon responses should
      // not dominate merely because one historical occurrence had a huge result.
      const propensity = choice.rate * choice.rate;
      const contribution = propensity * opponentEffect.value * ARMX_PREVIEW.opponentSignalWeight;
      signal += contribution;
      evidence += Math.min(2.5, (choice.evidence * 0.35 + opponentEffect.evidence * 0.25) * Math.max(0.25, choice.rate));
      if (Math.abs(contribution) >= 0.08) {
        reasons.push(`opp-${feature}:${Math.round(choice.rate * 100)}%/${opponentEffect.value > 0 ? '+' : ''}${opponentEffect.value.toFixed(2)}`);
      }
    }

    // Connect earlier exchange outcomes to a new exchange invitation. If ARMX has
    // learned that *our* rook/trade/simplification episodes work against this
    // opponent, a candidate that gives them the option to accept such an exchange
    // receives only the acceptance-rate-weighted expected value. If they rarely
    // accept it, its influence stays small; if they habitually accept, the learned
    // result matters. This uses no search tree and adds no board traversal.
    const ourEffect = armxPreviewEffect(profile.ourEffects, feature);
    if (choice.evidence >= 3 && ourEffect.evidence >= ARMX_PREVIEW.minEvidence) {
      const reliability = armxPreviewClamp((choice.evidence - 1) / 6, 0.25, 1);
      const expectedOutcome = choice.rate * ourEffect.value
        * ARMX_PREVIEW.responseOutcomeWeight * reliability;
      signal += expectedOutcome;
      evidence += Math.min(1.75, ourEffect.evidence * 0.20 + choice.evidence * 0.12) * Math.max(0.2, choice.rate);
      if (Math.abs(expectedOutcome) >= 0.06) {
        reasons.push(`offer-${feature}:${Math.round(choice.rate * 100)}%/${ourEffect.value > 0 ? '+' : ''}${ourEffect.value.toFixed(2)}`);
      }
    }
  }

  const confidence = armxPreviewClamp(evidence / ARMX_PREVIEW.fullConfidenceEvidence, 0, 1);
  const delta = armxPreviewClamp(
    signal * ARMX_PREVIEW.multiplierSignalScale * confidence,
    -ARMX_PREVIEW.maxMultiplierDelta,
    ARMX_PREVIEW.maxMultiplierDelta
  );
  const multiplier = 1 + delta;
  // A small floor keeps opponent knowledge relevant in approximately equal
  // positions, while the native deep-score gate prevents tactically bad flips.
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
    const choice = armxPreviewOpponentChoiceRate(profile, feature);
    if (choice.evidence >= 3 && (choice.rate >= 0.70 || choice.rate <= 0.25)) {
      notes.push(`opponent ${choice.rate >= 0.70 ? 'often' : 'rarely'} chooses ${feature} when available (${Math.round(choice.rate * 100)}%)`);
    }
  }
  return notes.slice(0, 6);
}

function armxPreviewReview(game, candidates, perspective = game.side) {
  const profile = armxPreviewSyncProfile(game, perspective);
  const finalists = candidates
    .filter(entry => entry && Number.isFinite(entry.score))
    .slice(0, ARMX_PREVIEW.candidateLimit);
  const reports = finalists.map(entry => armxPreviewCandidateReport(game, entry, profile));
  reports.sort((a, b) => b.adaptedScore - a.adaptedScore);
  profile.notes = armxPreviewProfileNotes(profile);

  return {
    model: ARMX_PREVIEW.name,
    version: ARMX_PREVIEW.version,
    kind: ARMX_PREVIEW.kind,
    reset: ARMX_PREVIEW.reset,
    observedPlies: profile.processedPlies,
    opponentMovesObserved: profile.opponentMoves,
    notes: profile.notes.slice(),
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