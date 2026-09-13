// Stonefish v5.5 testunit1 — v5 Pro knowledge + native v5.5 search + ARMX-preview.
//
// v5.5 inherits v5 Pro's chess knowledge and uses a fast four-root Guarded-PVS
// search with late-move reductions and exact transposition reuse. ARMX audits the
// actual provisional winner only when the fully searched host result is close or
// the position carries exceptional passer danger.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  knowledgeBase: 'Stonefish v5 Pro',
  search: 'Guarded PVS',
  nativeFeature: 'PVS + TT four-root search',
  armx: 'ARMX-preview selective audit',
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
  const shouldAskARMX = stonefishV55Testunit1ShouldAskARMX(game, finished, perspective);

  if (provisional && shouldAskARMX && typeof armxPreviewReview === 'function') {
    review = armxPreviewReview(game, [provisional], perspective);
    const report = review && Array.isArray(review.reports) ? review.reports[0] : null;
    if (report && report.criticalReply) {
      stonefishV55AuditCandidate(game, provisional, perspective, report.criticalReply);
      stonefishV55SortFinalScores(game, finished);
      audited = true;
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
    eligible: shouldAskARMX,
    hostCandidatesReviewed: reports.length,
    injectedReplies: reports.filter(report => report && report.criticalReply).length,
    audited,
    override: changedByARMX,
    changedMove: changedByARMX,
    recommendedRaw: winner ? winner.raw : null,
    provisionalRaw,
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
