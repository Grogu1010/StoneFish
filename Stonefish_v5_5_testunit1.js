// Stonefish v5.5 testunit1 — Stonefish v5 Pro + ARMX-preview, and nothing else.
//
// Development-only test unit. v5 Pro runs normally first. ARMX-preview is a separate
// broad 3/4-ply model whose job is to surface candidates Pro's narrow finalist beam may
// have missed. Stonefish then verifies ARMX's challenge with its own normal five-ply
// search before ARMX is allowed to change the final move.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  armx: 'ARMX-preview',
});

const STONEFISH_V5_5_ARMX_CHALLENGE_GAIN = 20;
const STONEFISH_V5_5_PRO_VERIFY_MARGIN = 35;
const STONEFISH_V5_5_MAX_VERIFICATIONS = 2;
let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55VerifyWithPro(game, raw, perspective) {
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
  const proDeep = Number.isFinite(proTop.deep) ? proTop.deep : null;
  const proReport = review && Array.isArray(review.reports)
    ? review.reports.find(report => stonefishV5SameMove(report.raw, proTop.raw))
    : null;

  const verified = [];
  let winner = null;

  // ARMX is most valuable when it finds a move Pro did NOT put in its deep-search
  // finalist set. Do not use shallow ARMX to overrule two moves Pro already compared
  // at five ply; use ARMX to rescue candidates that Pro's beam excluded.
  if (review && proReport && proDeep !== null) {
    const challenges = review.reports
      .filter(report => !Number.isFinite(report.proScore))
      .filter(report => report.armxScore - proReport.armxScore >= STONEFISH_V5_5_ARMX_CHALLENGE_GAIN)
      .slice(0, STONEFISH_V5_5_MAX_VERIFICATIONS);

    for (const challenge of challenges) {
      const verification = stonefishV55VerifyWithPro(game, challenge.raw, perspective);
      const gain = verification.deep - proDeep;
      const item = {
        raw: challenge.raw,
        armxScore: challenge.armxScore,
        armxGain: challenge.armxScore - proReport.armxScore,
        proDeep: verification.deep,
        proDeepGain: gain,
        stats: verification.stats,
      };
      verified.push(item);

      if (gain >= STONEFISH_V5_5_PRO_VERIFY_MARGIN && (!winner || verification.deep > winner.proDeep)) {
        winner = item;
      }
    }
  }

  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({
    connected: true,
    proposedOverride: Boolean(review && review.override),
    verifiedChallenges: verified,
    override: Boolean(winner),
    recommendedRaw: winner ? winner.raw : proTop.raw,
    verifiedGain: winner ? winner.proDeepGain : 0,
    verifyMargin: STONEFISH_V5_5_PRO_VERIFY_MARGIN,
  }, review || {});

  // Object.assign above lets the original review fields overwrite the final decision;
  // explicitly restore the verified decision fields as the authoritative v5.5 result.
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX.connected = true;
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX.proposedOverride = Boolean(review && review.override);
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX.verifiedChallenges = verified;
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX.override = Boolean(winner);
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX.recommendedRaw = winner ? winner.raw : proTop.raw;
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX.verifiedGain = winner ? winner.proDeepGain : 0;
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX.verifyMargin = STONEFISH_V5_5_PRO_VERIFY_MARGIN;

  if (!winner) return baseScored;
  const recommendedIndex = baseScored.findIndex(entry => stonefishV5SameMove(entry.raw, winner.raw));
  if (recommendedIndex <= 0) return baseScored;

  const adjusted = baseScored.slice();
  const [recommended] = adjusted.splice(recommendedIndex, 1);
  recommended.armxOverride = true;
  recommended.armxVerifiedDeep = winner.proDeep;
  recommended.armxVerifiedGain = winner.proDeepGain;
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
