// Stonefish v5.5 testunit1 — Stonefish v5 + ARMX-preview, and nothing else.
//
// Development-only test unit.
// Invariant: Stonefish v5's evaluation, search, weights, candidate generation, move ordering,
// tie-breaking and public move conversion remain unchanged. The sole new capability is that the
// already-scored v5 candidates may be reviewed by a separately loaded ARMX model.
//
// Load order for this test unit:
//   ... normal Stonefish dependencies ...
//   Stonefish_v5.js
//   ARMX_preview_fast.js
//   Stonefish_v5_5_testunit1.js

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5',
  armx: 'ARMX-preview',
});

let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55Testunit1ScoreAllMoves(game) {
  // Important: v5 completes its normal decision process first. Nothing inside v5 is replaced.
  const baseScored = stonefishV5ScoreAllMoves(game);
  if (!baseScored.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;
    return [];
  }

  // ARMX is a separate optional module. Missing ARMX means exact v5 behavior.
  if (typeof armxPreviewReview !== 'function') {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = {
      model: null,
      connected: false,
      nodes: 0,
      reports: [],
    };
    return baseScored;
  }

  const perspective = game.side;
  const review = armxPreviewReview(game, baseScored, perspective);
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({ connected: true }, review);

  if (!review || !Array.isArray(review.reports) || !review.reports.length) return baseScored;

  // Clone entries so testunit1 never mutates v5's own result objects.
  const adjusted = baseScored.map(entry => ({
    raw: entry.raw,
    tactical: entry.tactical,
    knowledge: entry.knowledge,
    v5Score: entry.score,
    armxAdjustment: 0,
    score: entry.score,
  }));

  for (const report of review.reports) {
    const target = adjusted.find(entry => stonefishV5SameMove(entry.raw, report.raw));
    if (!target) continue;
    target.armxAdjustment = Number.isFinite(report.adjustment) ? report.adjustment : 0;
    target.armxRisk = report.risk;
    target.armxScore = report.armxScore;
    target.armxCriticalReply = report.criticalReply;
    target.armxLine = report.line;
    target.score = target.v5Score + target.armxAdjustment;
  }

  // Preserve the exact v5 ordering rule after the sole ARMX score adjustment.
  adjusted.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw);
    const bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

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
