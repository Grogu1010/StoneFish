// ARMX — full per-game opponent adaptation for the Stonefish v5.5 range.
//
// Full ARMX deliberately stays outside the native chess engine. The shared
// v5.5 host still owns legal move generation, evaluation and PVS. ARMX owns:
//   * opponent-specific per-game evidence,
//   * learned reply ordering,
//   * adaptive search effort,
//   * evidence-weighted finalist selection.
// Profiles reset with the game. There is no opponent identity shortcut.

const ARMX_FULL = Object.freeze({
  name: 'ARMX',
  version: '1.0-full',
  kind: 'opponent-adaptation',
  reset: 'per-game',
  candidateLimit: 3,
  baseSearchNodes: 9600,
  evidenceSearchNodes: 18400,
  surpriseSearchNodes: 7200,
  maxExtraNodes: 36000,
  baseDepth: 6,
  matureDepth: 8,
  maxExtraDepth: 4,
  matureOpponentMoves: 8,
  decisionGain: 1.85,
  matureDecisionGain: 2.70,
  counterStyleScale: 54,
  maxCounterAdjustment: 72,
  maxHostGap: 105,
  maxDeepSacrifice: 70,
  styleScale: Object.freeze({
    athena: 34,
    ares: 32,
    artemis: 0,
  }),
  maxStyleAdjustment: Object.freeze({
    athena: 105,
    ares: 100,
    artemis: 0,
  }),
});

const ARMX_FULL_LAST = Object.create(null);

function armxFullClamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function armxFullFeatureRate(profile, feature) {
  if (!profile || !profile.opponentMoves || !profile.opponentEffects) return 0;
  const row = profile.opponentEffects[feature];
  return row && row.observations ? row.observations.size / profile.opponentMoves : 0;
}

function armxFullOpponentShape(profile) {
  const capture = armxFullFeatureRate(profile, 'capture');
  const check = armxFullFeatureRate(profile, 'check');
  const kingAttack = armxFullFeatureRate(profile, 'kingAttack');
  const advance = armxFullFeatureRate(profile, 'advance');
  const pawnPush = armxFullFeatureRate(profile, 'pawnPush');
  const trade = armxFullFeatureRate(profile, 'trade');
  const simplify = armxFullFeatureRate(profile, 'simplify');
  const quiet = armxFullFeatureRate(profile, 'quiet');
  const retreat = armxFullFeatureRate(profile, 'retreat');
  const aggression = armxFullClamp(
    check * 1.45 + kingAttack * 1.10 + capture * 0.70 + advance * 0.35 + pawnPush * 0.20
      - quiet * 0.32 - retreat * 0.28,
    -1.5, 2.5
  );
  const simplification = armxFullClamp(trade * 1.10 + simplify * 0.90 + capture * 0.22, 0, 2);
  const patience = armxFullClamp(quiet * 0.85 + retreat * 0.65 - check * 0.45 - kingAttack * 0.35, -1, 1.5);
  return { aggression, simplification, patience, capture, check, kingAttack, advance, quiet, retreat };
}

function armxFullOpponentPolicy(game, perspective = game.side) {
  const profile = armxPreviewSyncProfile(game, perspective);
  const preview = armxPreviewOpponentPolicy(game, perspective);
  const opponentMoves = Number(profile.opponentMoves) || 0;
  const maturity = armxFullClamp(opponentMoves / ARMX_FULL.matureOpponentMoves, 0, 1);
  const quiet = profile.quietPolicy;
  const predictionSurprise = quiet && quiet.qualityWeight
    ? armxFullClamp(-(quiet.qualitySum / quiet.qualityWeight) / ARMX_PREVIEW.predictionSurpriseScale, 0, 1)
    : 0;

  // Full ARMX owns a larger adaptive reserve than Preview. The reserve is part
  // of ARMX, not a change to native evaluation/search rules: the same host
  // simply receives a larger verified node/depth allowance as evidence grows.
  const searchBudget = Math.round(
    ARMX_FULL.baseSearchNodes
      + ARMX_FULL.evidenceSearchNodes * maturity
      + ARMX_FULL.surpriseSearchNodes * predictionSurprise
  );
  const maxDepth = opponentMoves >= ARMX_FULL.matureOpponentMoves
    ? ARMX_FULL.matureDepth
    : opponentMoves >= 3 ? 7 : ARMX_FULL.baseDepth;

  const weights = preview && preview.weights
    ? new Float64Array(preview.weights)
    : new Float64Array(13);
  const priority = preview && typeof preview.priority === 'function'
    ? preview.priority
    : () => 0;
  const isLowPriority = preview && typeof preview.isLowPriority === 'function'
    ? preview.isLowPriority
    : () => false;

  return {
    model: ARMX_FULL.name,
    version: ARMX_FULL.version,
    observations: opponentMoves,
    maturity,
    searchBudget,
    maxDepth,
    maxExtraNodes: ARMX_FULL.maxExtraNodes,
    maxExtraDepth: ARMX_FULL.maxExtraDepth,
    weights,
    priority,
    isLowPriority,
  };
}

function armxFullCounterStyleSignal(profile, features) {
  const shape = armxFullOpponentShape(profile);
  const set = new Set(features || []);
  let signal = 0;

  // Against forcing opponents, prefer positions that remove their preferred
  // forcing mechanisms. Against passive opponents, take space and create direct
  // questions. This is learned from this game only.
  if (shape.aggression > 0) {
    if (set.has('castle')) signal += 0.85 * shape.aggression;
    if (set.has('trade')) signal += 0.45 * shape.aggression;
    if (set.has('simplify')) signal += 0.40 * shape.aggression;
    if (set.has('retreat')) signal += 0.18 * shape.aggression;
    if (set.has('kingAttack')) signal -= 0.12 * shape.aggression;
  } else if (shape.aggression < 0) {
    const passive = -shape.aggression;
    if (set.has('check')) signal += 0.75 * passive;
    if (set.has('kingAttack')) signal += 0.68 * passive;
    if (set.has('advance')) signal += 0.32 * passive;
    if (set.has('pawnPush')) signal += 0.22 * passive;
  }

  if (shape.patience > 0.18) {
    if (set.has('advance')) signal += 0.22 * shape.patience;
    if (set.has('kingAttack')) signal += 0.32 * shape.patience;
    if (set.has('quiet')) signal -= 0.12 * shape.patience;
  }

  return armxFullClamp(signal, -1.5, 1.5);
}

function armxFullStyleSignal(entry, report, style) {
  if (!style || style === 'artemis') return 0;
  const set = new Set(report && report.features || []);
  const capturedValue = entry && entry.raw
    ? (ARMX_PREVIEW_PIECE_VALUES[entry.raw.captured || 0] || 0) / 500
    : 0;
  let signal = 0;

  if (style === 'athena') {
    // Athena keeps material and tension on the board, reduces forcing contact,
    // castles readily and accepts retreats. This deliberately creates a
    // defensive, long-horizon identity without changing chess evaluation.
    if (set.has('quiet')) signal += 1.25;
    if (set.has('castle')) signal += 1.65;
    if (set.has('retreat')) signal += 0.80;
    if (set.has('capture')) signal -= 0.95 + capturedValue * 0.45;
    if (set.has('trade')) signal -= 1.30;
    if (set.has('simplify')) signal -= 1.45;
    if (set.has('queenTrade')) signal -= 1.10;
    if (set.has('rookTrade')) signal -= 0.75;
    if (set.has('check')) signal -= 0.35;
    if (set.has('kingAttack')) signal -= 0.55;
    if (set.has('advance')) signal -= 0.25;
    if (set.has('pawnPush')) signal -= 0.18;
  } else if (style === 'ares') {
    // Ares asks forcing questions immediately. Checks, king contact, captures,
    // advances and simplifying conversions all pull it forward; passive retreats
    // and quiet manoeuvres are strongly disfavoured.
    if (set.has('check')) signal += 2.10;
    if (set.has('kingAttack')) signal += 1.75;
    if (set.has('capture')) signal += 1.25 + capturedValue * 0.55;
    if (set.has('advance')) signal += 0.78;
    if (set.has('pawnPush')) signal += 0.52;
    if (set.has('trade')) signal += 0.52;
    if (set.has('simplify')) signal += 0.42;
    if (set.has('quiet')) signal -= 0.92;
    if (set.has('retreat')) signal -= 1.25;
    if (set.has('castle')) signal -= 0.20;
  }
  return signal;
}

function armxFullMateScale(entry) {
  if (!entry) return false;
  const mate = typeof STONEFISH_V5_PRO_MATE === 'number'
    ? STONEFISH_V5_PRO_MATE
    : (typeof STONEFISH_V5_MATE === 'number' ? STONEFISH_V5_MATE : 20000000);
  return (Number.isFinite(entry.deep) && Math.abs(entry.deep) >= mate * 0.9)
    || (Number.isFinite(entry.score) && Math.abs(entry.score) >= mate * 0.9);
}

function armxFullReview(game, finished, style = 'artemis', perspective = game.side) {
  const profile = armxPreviewSyncProfile(game, perspective);
  const opponentMoves = Number(profile.opponentMoves) || 0;
  const maturity = armxFullClamp(opponentMoves / ARMX_FULL.matureOpponentMoves, 0, 1);
  const candidates = (finished || [])
    .filter(entry => entry && Number.isFinite(entry.score))
    .slice(0, ARMX_FULL.candidateLimit);
  if (!candidates.length) return { reports: [], winner: null, profile, opponentMoves, maturity };

  const hostBest = candidates[0];
  const reports = candidates.map(entry => {
    const previewReport = armxPreviewCandidateReport(game, entry, profile);
    const adaptiveGain = ARMX_FULL.decisionGain
      + (ARMX_FULL.matureDecisionGain - ARMX_FULL.decisionGain) * maturity;
    const counterSignal = armxFullCounterStyleSignal(profile, previewReport.features);
    const counterAdjustment = armxFullClamp(
      counterSignal * ARMX_FULL.counterStyleScale * maturity,
      -ARMX_FULL.maxCounterAdjustment,
      ARMX_FULL.maxCounterAdjustment
    );
    const adaptiveAdjustment = (Number(previewReport.adjustment) || 0) * adaptiveGain
      + counterAdjustment;
    const styleRaw = armxFullStyleSignal(entry, previewReport, style)
      * (ARMX_FULL.styleScale[style] || 0);
    const styleAdjustment = armxFullClamp(
      styleRaw,
      -(ARMX_FULL.maxStyleAdjustment[style] || 0),
      ARMX_FULL.maxStyleAdjustment[style] || 0
    );
    const hostGap = hostBest.score - entry.score;
    const deepSacrifice = Number.isFinite(hostBest.deep) && Number.isFinite(entry.deep)
      ? hostBest.deep - entry.deep
      : hostGap;
    const protectedTruth = armxFullMateScale(hostBest) || armxFullMateScale(entry);
    const eligible = entry === hostBest || (!protectedTruth
      && hostGap <= ARMX_FULL.maxHostGap
      && deepSacrifice <= ARMX_FULL.maxDeepSacrifice);
    const fullScore = eligible
      ? entry.score + adaptiveAdjustment + styleAdjustment
      : -Infinity;

    return {
      ...previewReport,
      entry,
      style,
      opponentShape: armxFullOpponentShape(profile),
      adaptiveGain,
      counterSignal,
      counterAdjustment,
      adaptiveAdjustment,
      styleAdjustment,
      hostGap,
      deepSacrifice,
      eligible,
      fullScore,
    };
  });

  reports.sort((a, b) => b.fullScore - a.fullScore
    || b.hostScore - a.hostScore
    || String(a.entry.uci).localeCompare(String(b.entry.uci)));

  return {
    model: ARMX_FULL.name,
    version: ARMX_FULL.version,
    style,
    reset: ARMX_FULL.reset,
    observedPlies: Math.max(0, profile.processedPlies - profile.observationStartPly),
    opponentMoves,
    maturity,
    notes: armxPreviewProfileNotes(profile),
    opponentShape: armxFullOpponentShape(profile),
    reports,
    winner: reports.length ? reports[0].entry : hostBest,
  };
}

function armxFullRankHost(game, host, style = 'artemis') {
  const finished = host && Array.isArray(host.finished) ? host.finished : [];
  if (!finished.length) {
    ARMX_FULL_LAST[style] = null;
    return finished;
  }

  const original = finished[0];
  const review = armxFullReview(game, finished, style, game.side);
  const winner = review.winner || original;
  const index = finished.indexOf(winner);
  if (index > 0) {
    finished.splice(index, 1);
    finished.unshift(winner);
  }

  ARMX_FULL_LAST[style] = {
    ...review,
    searchBudget: host.searchBudget,
    searchDepth: host.depth,
    depthLimit: host.depthLimit,
    changedMove: Boolean(original && winner && !stonefishV5SameMove(original.raw, winner.raw)),
    provisionalRaw: original && original.raw,
    recommendedRaw: winner && winner.raw,
  };
  return finished;
}

function armxFullLast(style = 'artemis') {
  return ARMX_FULL_LAST[style] || null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.ARMX_FULL = ARMX_FULL;
  globalThis.armxFullOpponentPolicy = armxFullOpponentPolicy;
  globalThis.armxFullReview = armxFullReview;
  globalThis.armxFullRankHost = armxFullRankHost;
  globalThis.armxFullLast = armxFullLast;
}
