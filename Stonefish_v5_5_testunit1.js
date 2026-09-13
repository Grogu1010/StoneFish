// Stonefish v5.5 testunit1 — v5 Pro knowledge + native v5.5 search + ARMX-preview.
//
// v5.5 no longer runs the full v5 Pro engine and then adds ARMX on top; that could
// never be 3x faster. It inherits Pro's chess knowledge/evaluation, adds its own
// safety-aware candidate ranking and much smaller five-ply Guarded-PVS search, and
// uses ARMX-preview to inject opponent replies that the narrow search might miss.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  knowledgeBase: 'Stonefish v5 Pro',
  search: 'Guarded PVS',
  nativeFeature: 'reply-pressure safety',
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
  const preSearchLeader = ranked[0] ? ranked[0].raw : null;
  let review = null;

  if (typeof armxPreviewReview === 'function') {
    const reviewable = ranked
      .filter(entry => Number.isFinite(entry.score))
      .slice(0, Math.min(ARMX_PREVIEW.maxCandidates, STONEFISH_V5_5_SEARCH.rootCandidates));
    review = armxPreviewReview(game, reviewable, perspective);
  }

  const finished = stonefishV55FinishCandidates(game, ranked, review);
  const winner = finished[0] || null;
  const reports = review && Array.isArray(review.reports) ? review.reports : [];
  const injected = reports.filter(report => report && report.criticalReply).length;
  const changedFromFastLeader = Boolean(winner && preSearchLeader && !stonefishV5SameMove(winner.raw, preSearchLeader));

  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review || {}, {
    connected: Boolean(review),
    hostCandidatesReviewed: reports.length,
    injectedReplies: injected,
    override: changedFromFastLeader,
    changedMove: changedFromFastLeader,
    recommendedRaw: winner ? winner.raw : null,
    fastLeaderRaw: preSearchLeader,
    search: STONEFISH_V5_5_SEARCH.name,
  });

  return finished;
}

// A/B control for the developer test lab. This is the exact same v5.5 host search,
// evaluation, candidate ranking and speed architecture, but ARMX is never consulted.
// Keeping this as a separate function makes ARMX's contribution directly measurable.
function stonefishV55Testunit1NoARMXScoreAllMoves(game) {
  const ranked = stonefishV55FastCandidates(game);
  if (!ranked.length) return [];
  return stonefishV55FinishCandidates(game, ranked, null);
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
