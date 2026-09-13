// Stonefish v5.5 testunit1 — Stonefish v5 Pro + ARMX-preview, and nothing else.
//
// v5 Pro runs normally first. ARMX-preview is a separate 3/4-ply adversarial critic:
// it searches broadly for opponent replies that Pro's narrow beam may have skipped.
// Stonefish then verifies ARMX's critical reply at the SAME five-ply root horizon.
// ARMX never gets final authority; it can only expose a reply that lowers a Pro move.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  armx: 'ARMX-preview',
});

const STONEFISH_V5_5_MAX_REPLY_VERIFICATIONS = 2;
let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55VerifyReply(game, rootMove, reply, perspective) {
  const oldTT = STONEFISH_V5_PRO_ACTIVE_TT;
  const oldStats = STONEFISH_V5_PRO_LAST_SEARCH_STATS;
  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };

  try {
    game.fastApply(rootMove); // ply 1
    game.fastApply(reply);    // ply 2 chosen by ARMX
    const value = stonefishV5ProMinimax(
      game,
      3,
      perspective,
      -STONEFISH_V5_PRO_MATE,
      STONEFISH_V5_PRO_MATE,
      2
    ); // plies 3-5 use normal Pro search
    game.fastUndo();
    game.fastUndo();
    return { value, stats: Object.assign({}, STONEFISH_V5_PRO_LAST_SEARCH_STATS) };
  } catch (error) {
    // Keep board state safe if a development-time ARMX reply is ever malformed.
    while (game.historyStack.length && game.side !== perspective) game.fastUndo();
    throw error;
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = oldTT;
    STONEFISH_V5_PRO_LAST_SEARCH_STATS = oldStats;
  }
}

function stonefishV55RecomputeProScore(entry, deep) {
  if (Math.abs(deep) >= STONEFISH_V5_PRO_MATE * 0.9) return deep;
  const selective = deep * 1.28 + entry.preliminary * 0.46;
  const heritageFloor = entry.heritageMatch
    ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
    : -Infinity;
  return Math.max(selective, heritageFloor);
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
  if (!review || !Array.isArray(review.reports) || !review.reports.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({ connected: true, override: false }, review || {});
    return baseScored;
  }

  const adjusted = baseScored.map(entry => Object.assign({}, entry));
  const verifications = [];
  let verificationCount = 0;

  // ARMX-preview reviews the strongest Pro candidates. For each one, Stonefish tests
  // ARMX's proposed worst reply with the remaining three Pro plies. Since the opponent
  // may always choose that reply, the verified value can only LOWER the candidate's
  // existing minimax value; ARMX cannot manufacture an optimistic bonus.
  for (const report of review.reports) {
    if (verificationCount >= STONEFISH_V5_5_MAX_REPLY_VERIFICATIONS) break;
    if (!report.criticalReply) continue;

    const target = adjusted.find(entry => stonefishV5SameMove(entry.raw, report.raw));
    if (!target || !Number.isFinite(target.deep) || !Number.isFinite(target.score)) continue;

    const verification = stonefishV55VerifyReply(game, target.raw, report.criticalReply, perspective);
    verificationCount += 1;
    const originalDeep = target.deep;
    const verifiedDeep = Math.min(originalDeep, verification.value);

    if (verifiedDeep < originalDeep - 1e-9) {
      target.deep = verifiedDeep;
      target.score = stonefishV55RecomputeProScore(target, verifiedDeep);
      target.armxRefuted = true;
      target.armxCriticalReply = report.criticalReply;
      target.armxOriginalDeep = originalDeep;
      target.armxVerifiedDeep = verifiedDeep;
    }

    verifications.push({
      raw: target.raw,
      criticalReply: report.criticalReply,
      armxScore: report.armxScore,
      originalDeep,
      verifiedDeep,
      changed: verifiedDeep < originalDeep - 1e-9,
      stats: verification.stats,
    });
  }

  adjusted.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  const baseWinner = baseScored[0];
  const finalWinner = adjusted[0];
  const changedMove = !stonefishV5SameMove(baseWinner.raw, finalWinner.raw);
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review, {
    connected: true,
    verifications,
    override: changedMove,
    recommendedRaw: finalWinner.raw,
    proRaw: baseWinner.raw,
    changedMove,
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
