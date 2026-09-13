// Stonefish v5.5 testunit1 — v5 Pro knowledge, v5.5 native search, ARMX-preview.
//
// This is now intentionally more than "v5 Pro with ARMX". v5.5 keeps Pro's
// evaluation/knowledge layer, replaces Pro's root search with Guarded PVS, then
// lets the separate ARMX-preview model audit only the chosen leader for missed
// opponent replies. ARMX can challenge; the chess engine still verifies and decides.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  knowledgeBase: 'Stonefish v5 Pro',
  search: 'Guarded PVS',
  armx: 'ARMX-preview',
});

let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55RawKey(move) {
  if (!move) return 'null';
  return `${move.from}:${move.to}:${move.promotion || 0}:${move.flags || 0}`;
}

function stonefishV55VerifyReply(game, rootMove, reply, perspective) {
  const historyDepth = game.historyStack.length;
  const oldStats = STONEFISH_V5_5_LAST_SEARCH_STATS;
  STONEFISH_V5_5_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, reductions: 0, researches: 0, cutoffs: 0 };

  try {
    game.fastApply(rootMove); // ply 1
    game.fastApply(reply);    // ply 2 nominated by ARMX
    const value = stonefishV55Minimax(
      game,
      3,
      perspective,
      -STONEFISH_V5_PRO_MATE,
      STONEFISH_V5_PRO_MATE,
      2
    ); // plies 3-5 use v5.5 Guarded PVS
    return { value, stats: Object.assign({}, STONEFISH_V5_5_LAST_SEARCH_STATS) };
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
    STONEFISH_V5_5_LAST_SEARCH_STATS = oldStats;
  }
}

function stonefishV55RecomputeScore(entry, deep) {
  if (Math.abs(deep) >= STONEFISH_V5_PRO_MATE * 0.9) return deep;
  const selective = deep * 1.28 + entry.preliminary * 0.46;
  const heritageFloor = entry.heritageMatch
    ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
    : -Infinity;
  return Math.max(selective, heritageFloor);
}

function stonefishV55SortScored(game, scored) {
  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
}

function stonefishV55FirstCriticalReply(report) {
  if (!report) return null;
  if (Array.isArray(report.criticalReplies) && report.criticalReplies.length) {
    const item = report.criticalReplies.find(value => value && value.reply);
    if (item) return item;
  }
  return report.criticalReply
    ? { reply: report.criticalReply, score: report.armxScore, line: report.line || [report.criticalReply] }
    : null;
}

function stonefishV55Testunit1ScoreAllMoves(game) {
  const baseScored = stonefishV55NativeScoreAllMoves(game);
  if (!baseScored.length) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;
    return [];
  }

  const baseWinner = baseScored[0];
  if (typeof armxPreviewReview !== 'function' || !baseWinner || !Number.isFinite(baseWinner.deep)) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = {
      model: null,
      connected: false,
      nodes: 0,
      reports: [],
      override: false,
      nativeOnly: true,
    };
    return baseScored;
  }

  const perspective = game.side;
  // Preview audits only the move v5.5 actually intends to play. This is the speed
  // boundary: one ARMX critique and at most one full five-ply verification.
  const review = armxPreviewReview(game, [baseWinner], perspective);
  const report = review && Array.isArray(review.reports) ? review.reports[0] : null;
  const critical = stonefishV55FirstCriticalReply(report);

  if (!critical) {
    STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review || {}, {
      connected: true,
      hostCandidatesReviewed: 1,
      verifications: [],
      verificationCount: 0,
      override: false,
      recommendedRaw: baseWinner.raw,
      nativeRaw: baseWinner.raw,
    });
    return baseScored;
  }

  const adjusted = baseScored.map(entry => Object.assign({}, entry));
  const leader = adjusted[0];
  const verification = stonefishV55VerifyReply(game, leader.raw, critical.reply, perspective);
  const originalDeep = leader.deep;
  const verifiedDeep = Math.min(originalDeep, verification.value);
  const changedEval = verifiedDeep < originalDeep - 1e-9;

  if (changedEval) {
    leader.deep = verifiedDeep;
    leader.score = stonefishV55RecomputeScore(leader, verifiedDeep);
    leader.armxRefuted = true;
    leader.armxOriginalDeep = originalDeep;
    leader.armxVerifiedDeep = verifiedDeep;
    leader.armxCriticalReply = critical.reply;
    stonefishV55SortScored(game, adjusted);
  }

  const finalWinner = adjusted[0];
  const changedMove = !stonefishV5SameMove(baseWinner.raw, finalWinner.raw);
  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review || {}, {
    connected: true,
    hostCandidatesReviewed: 1,
    verifications: [{
      raw: leader.raw,
      criticalReply: critical.reply,
      armxScore: critical.score,
      line: critical.line,
      originalDeep,
      verifiedDeep,
      changed: changedEval,
      stats: verification.stats,
    }],
    verificationCount: 1,
    override: changedMove,
    recommendedRaw: finalWinner.raw,
    nativeRaw: baseWinner.raw,
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
