// Stonefish v5.5 testunit1 — Stonefish v5 Pro + ARMX-preview, and nothing else.
//
// v5 Pro runs normally first. ARMX-preview is a separate 3/4-ply adversarial critic
// that searches opponent replies outside Pro's normal reply beam. Stonefish then
// verifies those missed replies at the SAME five-ply root horizon before allowing
// them to alter the result. ARMX never gets final authority.

const STONEFISH_V5_5_TESTUNIT1 = Object.freeze({
  name: 'Stonefish v5.5 testunit1',
  base: 'Stonefish v5 Pro',
  armx: 'ARMX-preview',
});

const STONEFISH_V5_5_MAX_REPLY_VERIFICATIONS = 3;
let STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = null;

function stonefishV55RawKey(move) {
  if (!move) return 'null';
  return `${move.from}:${move.to}:${move.promotion || 0}:${move.flags || 0}`;
}

function stonefishV55VerifyReply(game, rootMove, reply, perspective) {
  const oldTT = STONEFISH_V5_PRO_ACTIVE_TT;
  const oldStats = STONEFISH_V5_PRO_LAST_SEARCH_STATS;
  const historyDepth = game.historyStack.length;
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
    return { value, stats: Object.assign({}, STONEFISH_V5_PRO_LAST_SEARCH_STATS) };
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
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

function stonefishV55SortScored(game, scored) {
  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
}

function stonefishV55CriticalReplies(report) {
  if (!report) return [];
  if (Array.isArray(report.criticalReplies) && report.criticalReplies.length) {
    return report.criticalReplies
      .map(item => item && item.reply ? item : null)
      .filter(Boolean);
  }
  return report.criticalReply
    ? [{ reply: report.criticalReply, score: report.armxScore, line: report.line || [report.criticalReply] }]
    : [];
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
  const verifiedReplyKeys = new Set();

  // Only the current leader needs protection. If an ARMX-discovered missed reply
  // lowers it enough that another Pro candidate becomes best, protect that new
  // leader next. This avoids spending verification search on moves that cannot
  // affect the final decision.
  for (let attempt = 0; attempt < STONEFISH_V5_5_MAX_REPLY_VERIFICATIONS; attempt += 1) {
    stonefishV55SortScored(game, adjusted);
    const leader = adjusted[0];
    if (!leader || !Number.isFinite(leader.deep) || !Number.isFinite(leader.score)) break;

    const report = review.reports.find(item => stonefishV5SameMove(item.raw, leader.raw));
    const criticals = stonefishV55CriticalReplies(report);
    if (!criticals.length) break;

    let selected = null;
    for (const critical of criticals) {
      const key = stonefishV55RawKey(leader.raw) + '|' + stonefishV55RawKey(critical.reply);
      if (!verifiedReplyKeys.has(key)) {
        selected = { critical, key };
        break;
      }
    }
    if (!selected) break;
    verifiedReplyKeys.add(selected.key);

    const verification = stonefishV55VerifyReply(game, leader.raw, selected.critical.reply, perspective);
    const originalDeep = leader.deep;
    const verifiedDeep = Math.min(originalDeep, verification.value);
    const changed = verifiedDeep < originalDeep - 1e-9;

    if (changed) {
      leader.deep = verifiedDeep;
      leader.score = stonefishV55RecomputeProScore(leader, verifiedDeep);
      leader.armxRefuted = true;
      leader.armxOriginalDeep = leader.armxOriginalDeep === undefined ? originalDeep : leader.armxOriginalDeep;
      leader.armxVerifiedDeep = verifiedDeep;
      leader.armxCriticalReply = selected.critical.reply;
    }

    verifications.push({
      raw: leader.raw,
      criticalReply: selected.critical.reply,
      armxScore: selected.critical.score,
      line: selected.critical.line,
      originalDeep,
      verifiedDeep,
      changed,
      stats: verification.stats,
    });
  }

  stonefishV55SortScored(game, adjusted);
  const baseWinner = baseScored[0];
  const finalWinner = adjusted[0];
  const changedMove = !stonefishV5SameMove(baseWinner.raw, finalWinner.raw);

  STONEFISH_V5_5_TESTUNIT1_LAST_ARMX = Object.assign({}, review, {
    connected: true,
    verifications,
    verificationCount: verifications.length,
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
