// Stonefish v5.5 testunit1 — Stonefish v5 Pro + ARMX-preview, and nothing else.
//
// Development-only test unit. v5 Pro runs normally first. ARMX-preview then receives
// the scored Pro move set and may return a different move only when its independent
// broad 3/4-ply review finds a sufficiently better line.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  armx: 'ARMX-preview',
});

let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55Testunit1ScoreAllMoves(game) {
  const baseScored = stonefishV5ProScoreAllMoves(game);
  if (!baseScored.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;
    return [];
  }

  // Missing ARMX means exact v5 Pro behavior.
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

  const review = armxPreviewReview(game, baseScored, game.side);
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({ connected: true }, review);
  if (!review || !review.override || !review.recommendedRaw) return baseScored;

  // Do not alter Pro's internal scores. ARMX is a second opinion: when its confidence
  // threshold is met, move the recommended candidate to the front and leave the rest
  // in the exact order returned by v5 Pro.
  const recommendedIndex = baseScored.findIndex(entry => stonefishV5SameMove(entry.raw, review.recommendedRaw));
  if (recommendedIndex <= 0) return baseScored;

  const adjusted = baseScored.slice();
  const [recommended] = adjusted.splice(recommendedIndex, 1);
  recommended.armxOverride = true;
  recommended.armxGain = review.gain;
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
