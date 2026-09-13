// Stonefish v5.5 testunit1 — fast native v5.5 + Refutation Guard + ARMX-preview.
//
// Native v5.5 owns the chess search. Its Refutation Guard checks for opponent
// replies outside the normal selective beam and verifies them through the same
// five-ply v5.5 search before they may lower a move. ARMX-preview is separate: it
// learns this opponent's behavior from the current game and applies small bounded
// multipliers to already-searched candidates. The No-ARMX control uses the exact
// same v5.5 host, including Refutation Guard, but never consults ARMX.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  knowledgeBase: 'Stonefish v5 Pro',
  search: 'Guarded PVS',
  nativeFeature: 'PVS + TT four-root search + Refutation Guard',
  refutationGuard: 'Refutation Guard',
  armx: 'ARMX-preview opponent adaptation model',
});

let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55Testunit1HostSearch(game) {
  const ranked = stonefishV55FastCandidates(game);
  if (!ranked.length) return { finished: [], fastLeader: null, refutationGuard: null };
  const fastLeader = ranked[0] ? ranked[0].raw : null;
  const finished = stonefishV55FinishCandidates(game, ranked);
  const refutationGuard = typeof stonefishV55ApplyRefutationGuard === 'function'
    ? stonefishV55ApplyRefutationGuard(game, finished, game.side)
    : null;
  return { finished, fastLeader, refutationGuard };
}

function stonefishV55FindEntry(finished, raw) {
  return finished.find(entry => entry && raw && stonefishV5SameMove(entry.raw, raw)) || null;
}

function stonefishV55FindARMXReport(reports, raw) {
  return reports.find(report => report && raw && stonefishV5SameMove(report.raw, raw)) || null;
}

function stonefishV55ARMXChangeAllowed(provisional, challenger, provisionalReport, challengerReport) {
  if (!provisional || !challenger || !provisionalReport || !challengerReport) return false;
  const hostGap = provisional.armxOriginalScore - challenger.armxOriginalScore;
  if (hostGap > ARMX_PREVIEW.maxHostGap) return false;
  if (Number.isFinite(provisional.deep) && Number.isFinite(challenger.deep)
    && challenger.deep < provisional.deep - ARMX_PREVIEW.maxDeepSacrifice) return false;
  const confidence = Math.max(provisionalReport.confidence || 0, challengerReport.confidence || 0);
  const evidence = Math.max(provisionalReport.evidence || 0, challengerReport.evidence || 0);
  if (evidence < ARMX_PREVIEW.minEvidence || confidence < 0.20) return false;
  if (challengerReport.adaptedScore <= provisionalReport.adaptedScore) return false;
  return true;
}

function stonefishV55Testunit1ScoreAllMoves(game) {
  const perspective = game.side;
  const host = stonefishV55Testunit1HostSearch(game);
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
      touched.push(target);
    }

    const proposedReport = reports[0] || null;
    const proposed = proposedReport ? stonefishV55FindEntry(finished, proposedReport.raw) : null;
    const provisionalReport = stonefishV55FindARMXReport(reports, provisionalRaw);
    const wantsChange = Boolean(proposed && provisionalRaw && !stonefishV5SameMove(proposed.raw, provisionalRaw));

    let allowChange = !wantsChange;
    if (wantsChange) {
      allowChange = stonefishV55ARMXChangeAllowed(
        provisional,
        proposed,
        provisionalReport,
        proposedReport
      );
      adaptationRejected = !allowChange;
    }

    if (allowChange) {
      for (const target of touched) {
        target.score = target.armxAdaptedScore;
        totalAdjustment += target.armxAdjustment || 0;
      }
      if (touched.length) stonefishV55SortFinalScores(game, finished);
      adaptationApplied = touched.some(target => Math.abs(target.armxAdjustment || 0) > 1e-9);
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
    connected: Boolean(review),
    eligible: Boolean(review),
    adaptationApplied,
    adaptationRejected,
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
    search: STONEFISH_V5_5_SEARCH.name,
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
