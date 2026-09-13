// Stonefish v5.5 testunit1 — v5 Pro knowledge + native v5.5 search + ARMX-preview.
//
// v5.5 inherits v5 Pro's chess knowledge and uses a fast four-root Guarded-PVS
// search with late-move reductions and exact transposition reuse. ARMX acts as a
// separate comparative critic: when the host result is close, it audits the top
// two finalists and only changes the choice when their relative adversarial risk
// justifies doing so.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  knowledgeBase: 'Stonefish v5 Pro',
  search: 'Guarded PVS',
  nativeFeature: 'PVS + TT four-root search',
  armx: 'ARMX-preview comparative adversarial critic',
  thirdRootChallenger: false,
  armxScoreGap: 450,
});

let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55Testunit1ShouldAskARMX(game, finished, perspective) {
  const winner = finished[0] || null;
  const runnerUp = finished[1] || null;
  if (!winner) return false;
  if (!runnerUp || !Number.isFinite(runnerUp.score)) return true;

  const scoreGap = Math.max(0, winner.score - runnerUp.score);
  if (scoreGap <= STONEFISH_V5_5_TESTUNIT1.armxScoreGap) return true;
  if (game.in_check()) return true;

  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    const danger = stonefishV5EnemyPasserThreat(game, perspective);
    if (danger >= 2200) return true;
  }
  return false;
}

function stonefishV55Testunit1HostSearch(game) {
  const ranked = stonefishV55FastCandidates(game);
  if (!ranked.length) return { finished: [], fastLeader: null, challengerSearched: false };
  const fastLeader = ranked[0] ? ranked[0].raw : null;
  const finished = stonefishV55FinishCandidates(game, ranked);
  return { finished, fastLeader, challengerSearched: false };
}

function stonefishV55FindEntry(finished, raw) {
  return finished.find(entry => entry && raw && stonefishV5SameMove(entry.raw, raw)) || null;
}

function stonefishV55Testunit1ScoreAllMoves(game) {
  const perspective = game.side;
  const host = stonefishV55Testunit1HostSearch(game);
  const finished = host.finished;
  if (!finished.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;
    return [];
  }

  // Native v5.5 decides first. The No-ARMX control runs this exact same host path,
  // so any later move change can be attributed specifically to ARMX.
  const provisional = finished[0] || null;
  const provisionalRaw = provisional ? provisional.raw : null;
  const runnerUp = finished[1] || null;
  const hostScoreGap = provisional && runnerUp && Number.isFinite(runnerUp.score)
    ? provisional.score - runnerUp.score
    : Infinity;
  let review = null;
  let audited = false;
  let criticApplied = false;
  let criticAdjustment = 0;
  let criticRisk = 0;
  let candidatesPenalized = 0;
  const shouldAskARMX = stonefishV55Testunit1ShouldAskARMX(game, finished, perspective);

  if (provisional && shouldAskARMX && typeof armxPreviewReview === 'function') {
    const comparisonSet = runnerUp ? [provisional, runnerUp] : [provisional];
    review = armxPreviewReview(game, comparisonSet, perspective);
    const reports = review && Array.isArray(review.reports) ? review.reports : [];

    // Apply ARMX symmetrically to the candidates it reviewed. This is the key
    // fast5 invariant: ARMX must compare risk, not simply distrust whoever the
    // host happened to rank first. A candidate only receives a bounded penalty
    // after ARMX finds a novel reply beyond its risk threshold.
    for (const report of reports) {
      const target = stonefishV55FindEntry(finished, report.raw);
      if (!target) continue;
      criticRisk = Math.max(criticRisk, Number.isFinite(report.risk) ? report.risk : 0);
      const adjustment = Number.isFinite(report.adjustment) ? report.adjustment : 0;
      if (!(adjustment < 0) || !report.criticalReply) continue;

      const originalScore = target.score;
      stonefishV55AuditCandidate(game, target, perspective, report.criticalReply);
      audited = true;
      target.armxCriticAdjustment = adjustment;
      target.armxOriginalScore = originalScore;
      target.score = Math.min(target.score, originalScore + adjustment);
      criticApplied = true;
      candidatesPenalized += 1;
      criticAdjustment = Math.min(criticAdjustment, adjustment);
    }

    if (audited || criticApplied) stonefishV55SortFinalScores(game, finished);
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
    eligible: shouldAskARMX,
    comparative: reports.length > 1,
    hostCandidatesReviewed: reports.length,
    injectedReplies: reports.filter(report => report && report.criticalReply).length,
    audited,
    criticApplied,
    criticAdjustment,
    criticRisk,
    candidatesPenalized,
    override: changedByARMX,
    changedMove: changedByARMX,
    recommendedRaw: winner ? winner.raw : null,
    provisionalRaw,
    runnerUpRaw: runnerUp ? runnerUp.raw : null,
    fastLeaderRaw: host.fastLeader,
    hostSearchChangedMove: changedFromFastLeader,
    challengerSearched: false,
    hostScoreGap,
    search: STONEFISH_V5_5_SEARCH.name,
  });

  return finished;
}

// A/B control for the developer test lab. This is the exact same v5.5 host search,
// evaluation, candidate ranking and speed architecture, but ARMX is never consulted.
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
