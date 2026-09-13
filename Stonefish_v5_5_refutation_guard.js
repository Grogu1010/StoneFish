// Stonefish v5.5 native Refutation Guard.
//
// This is deliberately part of v5.5, NOT ARMX. It preserves the useful idea from
// the old ARMX experiments: look outside the normal selective reply beam for a
// legal opponent resource, then force that reply into the SAME v5.5 search
// horizon. The current v5.5 implementation searches five plies; future versions
// can deepen the guard without renaming the feature. The guard never gives a move
// an optimistic bonus. A candidate can only be lowered after v5.5 itself verifies
// that the omitted reply is genuinely worse.

const STONEFISH_V5_5_REFUTATION_GUARD = Object.freeze({
  name: 'Refutation Guard',
  ply: 5,
  candidates: 1,
  maxScreenedReplies: 5,
  maxVerifiedReplies: 1,
  triggerScoreGap: 520,
  minVerifiedDrop: 24,
});

let STONEFISH_V5_5_LAST_REFUTATION_GUARD = null;

function stonefishV55GuardStaticScore(game, perspective) {
  let score = typeof stonefishV5PositionScore === 'function'
    ? stonefishV5PositionScore(game, perspective)
    : 0;
  if (game.in_check()) score += game.side === perspective ? -180 : 120;
  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    const danger = stonefishV5EnemyPasserThreat(game, perspective);
    if (danger >= 2200) score -= danger * 0.36;
    else if (danger >= 900) score -= danger * 0.16;
  }
  return score;
}

function stonefishV55GuardEntryBefore(a, b) {
  if (a.score < b.score) return true;
  if (a.score > b.score) return false;
  return a.index < b.index;
}

function stonefishV55GuardKeepWorst(screened, entry, limit) {
  if (limit <= 0) return;
  const last = screened.length ? screened[screened.length - 1] : null;
  if (screened.length >= limit && last && !stonefishV55GuardEntryBefore(entry, last)) return;

  let at = screened.length;
  while (at > 0 && stonefishV55GuardEntryBefore(entry, screened[at - 1])) at -= 1;
  screened.splice(at, 0, entry);
  if (screened.length > limit) screened.pop();
}

function stonefishV55GuardNovelReplies(game, rootMove, perspective) {
  const historyDepth = game.historyStack.length;
  try {
    game.fastApply(rootMove);
    const legal = game.fastMoves();
    if (!legal.length) return { legal: 0, beam: 0, replies: [] };

    const beam = typeof stonefishV55SearchWidth === 'function'
      ? stonefishV55SearchWidth(game, 4, legal)
      : Math.min(4, legal.length);
    const orderedBeam = typeof stonefishV55TopOrdered === 'function'
      ? stonefishV55TopOrdered(game, legal, beam, null)
      : legal
        .map((move, index) => ({ move, index, order: stonefishV5ProSpeedMoveOrder(game, move) }))
        .sort((a, b) => (b.order - a.order) || (a.index - b.index))
        .slice(0, beam);
    const selected = new Set(orderedBeam.map(entry => entry.move));
    const screened = [];

    for (let i = 0; i < legal.length; i += 1) {
      const reply = legal[i];
      if (selected.has(reply)) continue;
      game.fastApply(reply);
      const score = stonefishV55GuardStaticScore(game, perspective);
      game.fastUndo();
      stonefishV55GuardKeepWorst(
        screened,
        { reply, score, index: i },
        STONEFISH_V5_5_REFUTATION_GUARD.maxScreenedReplies
      );
    }

    return {
      legal: legal.length,
      beam,
      replies: screened,
    };
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55ShouldRunGuard(game, finished, perspective) {
  const leader = finished[0] || null;
  if (!leader) return false;
  const runnerUp = finished[1] || null;
  if (!runnerUp || !Number.isFinite(runnerUp.score)) return true;
  if (leader.score - runnerUp.score <= STONEFISH_V5_5_REFUTATION_GUARD.triggerScoreGap) return true;
  if (game.in_check()) return true;
  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    return stonefishV5EnemyPasserThreat(game, perspective) >= 2200;
  }
  return false;
}

function stonefishV55ApplyRefutationGuard(game, finished, perspective = game.side) {
  const metadata = {
    model: STONEFISH_V5_5_REFUTATION_GUARD.name,
    ply: STONEFISH_V5_5_REFUTATION_GUARD.ply,
    eligible: false,
    screened: 0,
    verified: 0,
    reusedSearchTable: false,
    changedMove: false,
    lowered: false,
    originalDeep: null,
    verifiedDeep: null,
    drop: 0,
    criticalReply: null,
  };
  STONEFISH_V5_5_LAST_REFUTATION_GUARD = metadata;
  if (!finished || !finished.length) return metadata;

  const originalLeader = finished[0];
  metadata.eligible = stonefishV55ShouldRunGuard(game, finished, perspective);
  if (!metadata.eligible) return metadata;

  const reusableTT = finished.v55SearchTT instanceof Map ? finished.v55SearchTT : null;
  metadata.reusedSearchTable = Boolean(reusableTT);
  const candidates = finished.slice(0, STONEFISH_V5_5_REFUTATION_GUARD.candidates);
  for (const entry of candidates) {
    if (!entry || !Number.isFinite(entry.deep)) continue;
    const scan = stonefishV55GuardNovelReplies(game, entry.raw, perspective);
    metadata.screened += scan.replies.length;
    if (!scan.replies.length) continue;

    for (let i = 0; i < Math.min(STONEFISH_V5_5_REFUTATION_GUARD.maxVerifiedReplies, scan.replies.length); i += 1) {
      const criticalReply = scan.replies[i].reply;
      const originalDeep = entry.deep;
      const originalScore = entry.score;

      if (typeof stonefishV55VerifyInjectedReply === 'function') {
        stonefishV55VerifyInjectedReply(game, entry, perspective, criticalReply, reusableTT);
      } else {
        entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, criticalReply);
        entry.score = stonefishV55RecomputeFinalScore(entry);
      }
      metadata.verified += 1;

      // Adding an extra legal opponent reply can only make the root candidate
      // worse. Preserve that minimax invariant even if selective-search noise
      // happens to return a numerically higher value on the verification pass.
      const verifiedDeep = Math.min(originalDeep, entry.deep);
      const drop = originalDeep - verifiedDeep;
      if (drop < STONEFISH_V5_5_REFUTATION_GUARD.minVerifiedDrop) {
        entry.deep = originalDeep;
        entry.score = originalScore;
        entry.refutationGuardCriticalReply = null;
        entry.refutationGuardVerifiedDeep = null;
        continue;
      }

      entry.refutationGuardOriginalDeep = originalDeep;
      entry.refutationGuardCriticalReply = criticalReply;
      entry.deep = verifiedDeep;
      entry.score = stonefishV55RecomputeFinalScore(entry);
      entry.refutationGuardVerifiedDeep = verifiedDeep;
      metadata.lowered = true;
      metadata.originalDeep = originalDeep;
      metadata.verifiedDeep = verifiedDeep;
      metadata.drop = drop;
      metadata.criticalReply = criticalReply;
      break;
    }
  }

  if (metadata.lowered) stonefishV55SortFinalScores(game, finished);
  metadata.changedMove = Boolean(
    finished[0] && originalLeader && !stonefishV5SameMove(finished[0].raw, originalLeader.raw)
  );
  STONEFISH_V5_5_LAST_REFUTATION_GUARD = metadata;
  return metadata;
}

function stonefishV55LastRefutationGuard() {
  return STONEFISH_V5_5_LAST_REFUTATION_GUARD;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_REFUTATION_GUARD = STONEFISH_V5_5_REFUTATION_GUARD;
  globalThis.stonefishV55ApplyRefutationGuard = stonefishV55ApplyRefutationGuard;
  globalThis.stonefishV55LastRefutationGuard = stonefishV55LastRefutationGuard;
}
