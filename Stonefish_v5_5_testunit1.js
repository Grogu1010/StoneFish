// Stonefish v5.5 testunit1 — Stonefish v5 Pro + ARMX-preview, and nothing else.
//
// v5 Pro runs normally first. ARMX-preview stays a separate 3/4-ply model and
// nominates one move outside Pro's normal four-finalist beam. Stonefish then gives
// that nomination the SAME five-ply finalist treatment Pro gives its own finalists.
// ARMX therefore expands search coverage without lowering Pro's decision standard.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  armx: 'ARMX-preview',
});

const STONEFISH_V5_5_MAX_VERIFICATIONS = 1;
let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55DeepSearch(game, raw, perspective) {
  const oldTT = STONEFISH_V5_PRO_ACTIVE_TT;
  const oldStats = STONEFISH_V5_PRO_LAST_SEARCH_STATS;
  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    const deep = stonefishV5ProFivePlyScore(game, raw, perspective);
    return { deep, stats: Object.assign({}, STONEFISH_V5_PRO_LAST_SEARCH_STATS) };
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = oldTT;
    STONEFISH_V5_PRO_LAST_SEARCH_STATS = oldStats;
  }
}

function stonefishV55ScoreAsProFinalist(game, entry, perspective) {
  const raw = entry.raw;
  const tactical = Number.isFinite(entry.tactical)
    ? entry.tactical
    : stonefishV5TacticalScore(game, raw);

  // The v4.5 book choice is already stored per game by the base Pro call, so asking
  // again returns the same active repertoire branch rather than rerolling it.
  const bookMove = stonefishV45BookMove(game, 1, game.fastMoves());
  // We only need to preserve whether this candidate was the heritage move. Passing
  // the candidate itself when heritageMatch=true recreates that exact root bonus.
  const heritageMove = entry.heritageMatch ? raw : null;
  const knowledge = Math.abs(tactical) >= STONEFISH_V5_MATE * 1.5
    ? 0
    : stonefishV5ProRootKnowledge(game, raw, heritageMove, bookMove, perspective, tactical);
  const preliminary = tactical + knowledge + stonefishV5ProConversionUrgency(game, raw, perspective);
  const verification = stonefishV55DeepSearch(game, raw, perspective);
  const deep = verification.deep;

  let score;
  if (Math.abs(deep) >= STONEFISH_V5_PRO_MATE * 0.9) {
    score = deep;
  } else {
    const selective = deep * 1.28 + preliminary * 0.46;
    const heritageFloor = entry.heritageMatch
      ? preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
      : -Infinity;
    score = Math.max(selective, heritageFloor);
  }

  return {
    raw,
    tactical,
    knowledge,
    preliminary,
    deep,
    score,
    stats: verification.stats,
  };
}

function stonefishV55Testunit1ScoreAllMoves(game) {
  const baseScored = stonefishV5ProScoreAllMoves(game);
  if (!baseScored.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;
    return [];
  }

  if (typeof armxPreviewReview !== 'function') {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = {
      model: null,
      connected: false,
      nodes: 0,
      reports: [],
      override: false,
    };
    return baseScored;
  }

  const perspective = game.side;
  const review = armxPreviewReview(game, baseScored, perspective);
  const proTop = baseScored[0];
  const verified = [];
  let winner = null;

  if (review && Array.isArray(review.reports)) {
    // Reports are already ordered by ARMX score. Only nominate moves that Pro did
    // not deep-search (their Pro score is -Infinity). ARMX gets one nomination in
    // preview, keeping the extra work bounded and leaving room for later versions.
    const challenges = review.reports
      .filter(report => !Number.isFinite(report.proScore))
      .slice(0, STONEFISH_V5_5_MAX_VERIFICATIONS);

    for (const challenge of challenges) {
      const entry = baseScored.find(item => stonefishV5SameMove(item.raw, challenge.raw));
      if (!entry) continue;
      const finalist = stonefishV55ScoreAsProFinalist(game, entry, perspective);
      finalist.armxScore = challenge.armxScore;
      finalist.armxLine = challenge.line;
      verified.push(finalist);

      // This is the key safety property: ARMX cannot win merely because its own
      // shallower score likes a move. The nominated move must beat the actual Pro
      // winner on Pro's own complete finalist score after a normal five-ply search.
      if (finalist.score > proTop.score + 1e-9) winner = finalist;
    }
  }

  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review || {}, {
    connected: true,
    verifiedChallenges: verified,
    override: Boolean(winner),
    recommendedRaw: winner ? winner.raw : proTop.raw,
    verifiedGain: winner ? winner.score - proTop.score : 0,
    proTopScore: proTop.score,
  });

  if (!winner) return baseScored;
  const recommendedIndex = baseScored.findIndex(entry => stonefishV5SameMove(entry.raw, winner.raw));
  if (recommendedIndex <= 0) return baseScored;

  const adjusted = baseScored.slice();
  const [recommended] = adjusted.splice(recommendedIndex, 1);
  recommended.armxOverride = true;
  recommended.armxVerifiedScore = winner.score;
  recommended.armxVerifiedGain = winner.score - proTop.score;
  adjusted.unshift(recommended);
  return adjusted;
}

function getStonefishV55Testunit1Move(game) {
  const scored = stonefishV55Testunit1ScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function stonefishV55Testunit1LastARMX() {
  return STONEFISH_V5_5_TESTUNIT1_LAST_ARMX;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_TESTUNIT1 = STONEFISH_V5_5_TESTUNIT1;
  globalThis.getStonefishV55Testunit1Move = getStonefishV55Testunit1Move;
  globalThis.stonefishV55Testunit1ScoreAllMoves = stonefishV55Testunit1ScoreAllMoves;
  globalThis.stonefishV55Testunit1LastARMX = stonefishV55Testunit1LastARMX;
}
