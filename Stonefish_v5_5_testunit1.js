// Stonefish v5.5 testunit1 — native PVS + separate ARMX-preview.
//
// Native v5.5 owns the chess search and considers every legal root move.
// Capture quiescence resolves exchanges before evaluation. ARMX is separate: it
// learns this opponent's behavior from the current game, supplies reply priorities,
// and applies bounded multipliers to searched candidates. The No-ARMX control uses
// the exact same v5.5 host, but never consults ARMX.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  knowledgeBase: 'Native tapered positional evaluation',
  search: 'Native PVS',
  nativeFeature: 'All legal root moves + capture quiescence + exact finalist scores',
  refutationGuard: 'Full legal reply search',
  armx: 'ARMX-preview opponent adaptation model',
});

const STONEFISH_V5_5_ARMX_MIN_POSITIVE_SIGNAL = 0.10;
const STONEFISH_V5_5_ARMX_STRONG_AVOID_SIGNAL = -0.45;
const STONEFISH_V5_5_ARMX_DECISION_GAIN = 1.25;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_GAIN = 1.60;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_SIGNAL_EDGE = 0.30;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_CONFIDENCE = 0.90;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_EVIDENCE = 5.5;
let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

const STONEFISH_V5_5_NEUTRAL_COMPILED_WEIGHTS = new Float64Array(13);

function stonefishV55Testunit1HostSearch(game, replyPolicy = null) {
  return sf55cHost(game, replyPolicy);
}

// ARMX has useful work to do before the learned reply policy reaches its
// activation threshold. When WebAssembly is available, use the already parity-
// checked native search from the first ARMX turn with neutral policy weights.
// This changes only the implementation path: learned ordering, node budgets,
// depth, review logic, and the No-ARMX control remain exactly as before.
function stonefishV55Testunit1ARMXHostSearch(game, replyPolicy = null) {
  if (replyPolicy || typeof sf55cNativeAcceleratedHost !== 'function') {
    return stonefishV55Testunit1HostSearch(game, replyPolicy);
  }
  const accelerated = sf55cNativeAcceleratedHost(game, {
    weights: STONEFISH_V5_5_NEUTRAL_COMPILED_WEIGHTS,
    searchBudget: SF55C.nodes,
    maxDepth: SF55C.maxDepth,
    policyEnabled: false,
  });
  if (accelerated) {
    globalThis.SF55C_LAST = accelerated;
    return accelerated;
  }
  return stonefishV55Testunit1HostSearch(game, null);
}

function stonefishV55FindEntry(finished, raw) {
  return finished.find(entry => entry && raw && stonefishV5SameMove(entry.raw, raw)) || null;
}

function stonefishV55FindARMXReport(reports, raw) {
  return reports.find(report => report && raw && stonefishV5SameMove(report.raw, raw)) || null;
}

function stonefishV55ARMXPairDecisionGain(provisionalReport, challengerReport) {
  if (!provisionalReport || !challengerReport) return STONEFISH_V5_5_ARMX_DECISION_GAIN;
  const provisionalConfidence = Number(provisionalReport.confidence) || 0;
  const challengerConfidence = Number(challengerReport.confidence) || 0;
  const provisionalEvidence = Number(provisionalReport.evidence) || 0;
  const challengerEvidence = Number(challengerReport.evidence) || 0;
  const signalEdge = (Number(challengerReport.signal) || 0) - (Number(provisionalReport.signal) || 0);
  const mature = provisionalConfidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_CONFIDENCE
    && challengerConfidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_CONFIDENCE
    && provisionalEvidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_EVIDENCE
    && challengerEvidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_EVIDENCE;
  return mature && signalEdge >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_SIGNAL_EDGE
    ? STONEFISH_V5_5_ARMX_CONTRASTIVE_GAIN
    : STONEFISH_V5_5_ARMX_DECISION_GAIN;
}

function stonefishV55ARMXDecisionScore(report, gain = STONEFISH_V5_5_ARMX_DECISION_GAIN) {
  if (!report) return -Infinity;
  const hostScore = Number(report.hostScore);
  const adjustment = Number(report.adjustment) || 0;
  return Number.isFinite(hostScore)
    ? hostScore + adjustment * gain
    : -Infinity;
}

function stonefishV55BestARMXReport(reports, provisionalReport = null) {
  let best = provisionalReport || null;
  let bestLead = provisionalReport ? 0 : -Infinity;
  for (const report of reports || []) {
    if (!report || report === provisionalReport) continue;
    const gain = provisionalReport
      ? stonefishV55ARMXPairDecisionGain(provisionalReport, report)
      : STONEFISH_V5_5_ARMX_DECISION_GAIN;
    const score = stonefishV55ARMXDecisionScore(report, gain);
    const provisionalScore = provisionalReport
      ? stonefishV55ARMXDecisionScore(provisionalReport, gain)
      : -Infinity;
    const lead = provisionalReport ? score - provisionalScore : score;
    if (provisionalReport && lead <= 0) continue;
    if (!best || lead > bestLead) {
      best = report;
      bestLead = lead;
    }
  }
  return best;
}

function stonefishV55ARMXMateScale(entry) {
  if (!entry) return false;
  const mate = typeof STONEFISH_V5_PRO_MATE === 'number' ? STONEFISH_V5_PRO_MATE : STONEFISH_V5_MATE;
  return (Number.isFinite(entry.deep) && Math.abs(entry.deep) >= mate * 0.9)
    || (Number.isFinite(entry.score) && Math.abs(entry.score) >= mate * 0.9);
}

function stonefishV55ARMXChangeDecision(
  provisional,
  challenger,
  provisionalReport,
  challengerReport,
  observedPlies = 0
) {
  if (!provisional || !challenger || !provisionalReport || !challengerReport) {
    return { allowed: false, reason: 'missing-candidate-report' };
  }

  // Native search owns forced tactical truth. ARMX must never re-rank a mate-scale
  // decision just because its behavioral multipliers prefer another mating line.
  if (stonefishV55ARMXMateScale(provisional) || stonefishV55ARMXMateScale(challenger)) {
    return { allowed: false, reason: 'mate-scale' };
  }

  const hostGap = provisional.armxOriginalScore - challenger.armxOriginalScore;
  if (hostGap > ARMX_PREVIEW.maxHostGap) {
    return { allowed: false, reason: 'host-gap', hostGap };
  }
  const deepSacrifice = Number.isFinite(provisional.deep) && Number.isFinite(challenger.deep)
    ? provisional.deep - challenger.deep
    : 0;
  if (deepSacrifice > ARMX_PREVIEW.maxDeepSacrifice) {
    return { allowed: false, reason: 'deep-sacrifice', hostGap, deepSacrifice };
  }

  const challengerConfidence = Number(challengerReport.confidence) || 0;
  const challengerEvidence = Number(challengerReport.evidence) || 0;
  if (challengerEvidence < ARMX_PREVIEW.minOverrideEvidence) {
    return { allowed: false, reason: 'evidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }
  if (challengerConfidence < ARMX_PREVIEW.minOverrideConfidence) {
    return { allowed: false, reason: 'confidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }

  // Early observations are especially noisy: the bad adapt2 trace flipped a move
  // after only a few observed choices with sub-0.4 challenger confidence. ARMX may
  // still learn immediately, but it only gets voting power this early when the
  // evidence is already overwhelming.
  if (observedPlies < ARMX_PREVIEW.earlyOverridePlies
    && challengerEvidence < ARMX_PREVIEW.earlyOverrideEvidence) {
    return { allowed: false, reason: 'early-evidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }
  if (observedPlies < ARMX_PREVIEW.earlyOverridePlies
    && challengerConfidence < ARMX_PREVIEW.earlyOverrideConfidence) {
    return { allowed: false, reason: 'early-confidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }

  const decisionGain = stonefishV55ARMXPairDecisionGain(provisionalReport, challengerReport);
  const provisionalDecisionScore = stonefishV55ARMXDecisionScore(provisionalReport, decisionGain);
  const challengerDecisionScore = stonefishV55ARMXDecisionScore(challengerReport, decisionGain);
  const adaptedLead = challengerDecisionScore - provisionalDecisionScore;
  if (adaptedLead < ARMX_PREVIEW.minAdaptedLead) {
    return {
      allowed: false,
      reason: 'adapted-lead',
      hostGap,
      deepSacrifice,
      challengerEvidence,
      challengerConfidence,
      adaptedLead,
      decisionGain,
    };
  }

  // Do not change a sound native choice merely because two negative ARMX signals
  // differ by a few points. A flip needs either a positively learned challenger
  // or a genuinely strong learned reason to avoid the provisional move.
  const challengerSignal = Number(challengerReport.signal) || 0;
  const provisionalSignal = Number(provisionalReport.signal) || 0;
  if (challengerSignal < STONEFISH_V5_5_ARMX_MIN_POSITIVE_SIGNAL
    && provisionalSignal > STONEFISH_V5_5_ARMX_STRONG_AVOID_SIGNAL) {
    return {
      allowed: false,
      reason: 'signal-quality',
      hostGap,
      deepSacrifice,
      challengerEvidence,
      challengerConfidence,
      adaptedLead,
      challengerSignal,
      provisionalSignal,
      decisionGain,
    };
  }

  const allowed = challengerDecisionScore > provisionalDecisionScore;
  return {
    allowed,
    reason: allowed ? 'allowed' : 'adapted-order',
    hostGap,
    deepSacrifice,
    challengerEvidence,
    challengerConfidence,
    adaptedLead,
    challengerSignal,
    provisionalSignal,
    decisionGain,
  };
}

function stonefishV55ARMXChangeAllowed(
  provisional,
  challenger,
  provisionalReport,
  challengerReport,
  observedPlies = 0
) {
  return stonefishV55ARMXChangeDecision(
    provisional,
    challenger,
    provisionalReport,
    challengerReport,
    observedPlies
  ).allowed;
}

function stonefishV55ARMXPromoteReviewedCandidate(finished, candidate) {
  if (!candidate || !finished || !finished.length) return false;
  const index = finished.indexOf(candidate);
  if (index <= 0) return false;
  finished.splice(index, 1);
  finished.unshift(candidate);
  return true;
}

function stonefishV55Testunit1ScoreAllMoves(game) {
  const perspective = game.side;
  const replyPolicy = typeof armxPreviewOpponentPolicy === 'function'
    ? armxPreviewOpponentPolicy(game, perspective) : null;
  const host = stonefishV55Testunit1ARMXHostSearch(game, replyPolicy);
  const finished = host.finished;
  if (!finished.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;
    return [];
  }

  const provisional = finished[0] || null;
  const provisionalRaw = provisional ? provisional.raw : null;
  const runnerUp = finished[1] || null;
  const hostScoreGap = provisional && runnerUp && Number.isFinite(runnerUp.score)
    ? provisional.score - runnerUp.score
    : Infinity;
  let review = null;
  let adaptationApplied = false;
  let adaptationRejected = false;
  let totalAdjustment = 0;
  let gateDecision = null;
  let proposedRaw = null;

  // ARMX is deliberately cheap enough to observe every v5.5 turn. If the game
  // has not produced enough evidence yet, its multipliers stay at/near 1.0.
  if (provisional && typeof armxPreviewReview === 'function') {
    const comparisonSet = finished.slice(0, Math.max(1, ARMX_PREVIEW.candidateLimit));
    review = armxPreviewReview(game, comparisonSet, perspective);
    const reports = review && Array.isArray(review.reports) ? review.reports : [];
    const touched = [];

    for (const report of reports) {
      const target = stonefishV55FindEntry(finished, report.raw);
      if (!target) continue;
      target.armxOriginalScore = target.score;
      target.armxMultiplier = report.multiplier;
      target.armxAdjustment = report.adjustment;
      target.armxAdaptedScore = report.adaptedScore;
      target.armxDecisionScore = stonefishV55ARMXDecisionScore(report);
      touched.push(target);
    }

    // Ordinary comparisons retain the conservative 1.25x voting weight. If both
    // reports have mature evidence and a large contrastive learned signal, that
    // pair alone may use 1.60x. Deep-score, mate, host-gap and evidence gates still
    // decide whether the proposed change is actually permitted.
    const provisionalReport = stonefishV55FindARMXReport(reports, provisionalRaw);
    const proposedReport = stonefishV55BestARMXReport(reports, provisionalReport);
    const proposed = proposedReport ? stonefishV55FindEntry(finished, proposedReport.raw) : null;
    proposedRaw = proposed ? proposed.raw : null;
    const wantsChange = Boolean(proposed && provisionalRaw && !stonefishV5SameMove(proposed.raw, provisionalRaw));

    let allowChange = !wantsChange;
    if (wantsChange) {
      gateDecision = stonefishV55ARMXChangeDecision(
        provisional,
        proposed,
        provisionalReport,
        proposedReport,
        review && Number(review.observedPlies) || 0
      );
      allowChange = gateDecision.allowed;
      adaptationRejected = !allowChange;
    }

    if (allowChange) {
      for (const target of touched) totalAdjustment += target.armxAdjustment || 0;
      adaptationApplied = touched.some(target => Math.abs(target.armxAdjustment || 0) > 1e-9);
      if (wantsChange) stonefishV55ARMXPromoteReviewedCandidate(finished, proposed);
    }
  }

  const winner = finished[0] || null;
  const reports = review && Array.isArray(review.reports) ? review.reports : [];
  const changedByARMX = Boolean(
    winner && provisionalRaw && !stonefishV5SameMove(winner.raw, provisionalRaw)
  );
  const changedFromFastLeader = Boolean(
    winner && host.fastLeader && !stonefishV5SameMove(winner.raw, host.fastLeader)
  );

  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review || {}, {
    searchGuidanceActive: Boolean(replyPolicy),
    replyPolicyObservations: replyPolicy ? replyPolicy.observations : 0,
    connected: Boolean(review),
    eligible: Boolean(review),
    adaptationApplied,
    adaptationRejected,
    rejectionReason: adaptationRejected && gateDecision ? gateDecision.reason : null,
    gateDecision,
    proposedRaw,
    decisionGain: gateDecision && Number.isFinite(gateDecision.decisionGain)
      ? gateDecision.decisionGain
      : STONEFISH_V5_5_ARMX_DECISION_GAIN,
    totalAdjustment,
    override: changedByARMX,
    changedMove: changedByARMX,
    recommendedRaw: winner ? winner.raw : null,
    provisionalRaw,
    runnerUpRaw: runnerUp ? runnerUp.raw : null,
    fastLeaderRaw: host.fastLeader,
    hostSearchChangedMove: changedFromFastLeader,
    hostScoreGap,
    refutationGuard: host.refutationGuard,
    search: STONEFISH_V5_5_TESTUNIT1.search,
    // Compatibility fields for older diagnostics while the preview evolves.
    criticApplied: adaptationApplied,
    criticAdjustment: totalAdjustment,
    criticRisk: 0,
    candidatesPenalized: reports.filter(report => report && report.adjustment < 0).length,
    hostCandidatesReviewed: reports.length,
    injectedReplies: 0,
    audited: Boolean(host.refutationGuard && host.refutationGuard.verified),
    challengerSearched: false,
  });

  return finished;
}

// A/B control for the developer test lab. This is the exact same native v5.5,
// including Refutation Guard. Only the separate ARMX opponent model is bypassed.
function stonefishV55Testunit1NoARMXScoreAllMoves(game) {
  return stonefishV55Testunit1HostSearch(game).finished;
}

function getStonefishV55Testunit1Move(game) {
  const scored = stonefishV55Testunit1ScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function getStonefishV55Testunit1NoARMXMove(game) {
  const scored = stonefishV55Testunit1NoARMXScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function stonefishV55Testunit1LastARMX() {
  return STONEFISH_V5_5_TESTUNIT1_LAST_ARMX;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_TESTUNIT1 = STONEFISH_V5_5_TESTUNIT1;
  globalThis.getStonefishV55Testunit1Move = getStonefishV55Testunit1Move;
  globalThis.getStonefishV55Testunit1NoARMXMove = getStonefishV55Testunit1NoARMXMove;
  globalThis.stonefishV55Testunit1ScoreAllMoves = stonefishV55Testunit1ScoreAllMoves;
  globalThis.stonefishV55Testunit1NoARMXScoreAllMoves = stonefishV55Testunit1NoARMXScoreAllMoves;
  globalThis.stonefishV55Testunit1LastARMX = stonefishV55Testunit1LastARMX;
}
