// Stonefish v5.5 testunit1 — v5 Pro knowledge + native v5.5 search + ARMX-preview.
//
// v5.5 inherits v5 Pro's chess knowledge, but uses a faster knowledge-gated
// two-root five-ply search. The host first chooses a provisional winner on its own.
// Only then does ARMX-preview inspect that actual intended move for an opponent
// reply outside the host beam. Stonefish re-searches that reply before deciding.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  knowledgeBase: 'Stonefish v5 Pro',
  search: 'Guarded PVS',
  nativeFeature: 'knowledge-gated two-root search',
  armx: 'ARMX-preview',
});

let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55Testunit1ScoreAllMoves(game) {
  const ranked = stonefishV55FastCandidates(game);
  if (!ranked.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;
    return [];
  }

  const perspective = game.side;
  const fastLeader = ranked[0] ? ranked[0].raw : null;

  // Native v5.5 decides first. This exact same result is what the No-ARMX control
  // returns, so any later move change can be attributed specifically to ARMX.
  const finished = stonefishV55FinishCandidates(game, ranked);
  const provisional = finished[0] || null;
  const provisionalRaw = provisional ? provisional.raw : null;
  let review = null;
  let audited = false;

  if (provisional && typeof armxPreviewReview === 'function') {
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
    winner && fastLeader && !stonefishV5SameMove(winner.raw, fastLeader)
  );

  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review || {}, {
    connected: Boolean(review),
    hostCandidatesReviewed: reports.length,
    injectedReplies: reports.filter(report => report && report.criticalReply).length,
    audited,
    override: changedByARMX,
    changedMove: changedByARMX,
    recommendedRaw: winner ? winner.raw : null,
    provisionalRaw,
    fastLeaderRaw: fastLeader,
    hostSearchChangedMove: changedFromFastLeader,
    search: STONEFISH_V5_5_SEARCH.name,
  });

  return finished;
}

// A/B control for the developer test lab. This is the exact same v5.5 host search,
// evaluation, candidate ranking and speed architecture, but ARMX is never consulted.
function stonefishV55Testunit1NoARMXScoreAllMoves(game) {
  const ranked = stonefishV55FastCandidates(game);
  if (!ranked.length) return [];
  return stonefishV55FinishCandidates(game, ranked);
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
