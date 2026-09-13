// ARMX-preview — development-only adversarial critic for Stonefish v5.5 testunit1.
//
// Fast by design:
// - 3-ply base critic.
// - selective 4th ply only on one forcing continuation.
// - only the top 3 Stonefish v5 candidates are reviewed.
// - 2 replies x 2 continuations, then at most 1 fourth-ply reply.
// - hard 72-node budget per root review.
// - no full-width duplicate search of Stonefish v5.
//
// ARMX-preview is intentionally limited. It is a separate model/critic, not a replacement
// evaluator, so future ARMX versions can gain tactical vocabulary, depth and authority while
// Stonefish v5 itself stays unchanged.

const ARMX_PREVIEW = Object.freeze({
  name: 'ARMX-preview',
  version: 'preview',
  basePly: 3,
  maxPly: 4,
  maxCandidates: 3,
  maxReplies: 2,
  maxContinuations: 2,
  maxFourthPlyReplies: 1,
  maxNodes: 72,
  maxAdjustment: 180,
  checkProbeLimit: 8,
});

function armxPreviewPieceValue(type) {
  if (type === 1) return 100;
  if (type === 2) return 320;
  if (type === 3) return 330;
  if (type === 4) return 500;
  if (type === 5) return 900;
  if (type === 6) return 20000;
  return 0;
}

function armxPreviewMoveUrgency(move) {
  let score = 0;
  if (move.captured) score += armxPreviewPieceValue(move.captured) * 4 - armxPreviewPieceValue(move.piece);
  if (move.promotion) score += armxPreviewPieceValue(move.promotion) * 3;
  if (move.flags & (4 | 8)) score += 40;
  return score;
}

function armxPreviewStatic(game, perspective) {
  // Deliberately primitive preview evaluation: material only.
  // Rich positional understanding is reserved for later ARMX versions.
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (!p) continue;
    const side = p > 0 ? 1 : -1;
    const value = armxPreviewPieceValue(Math.abs(p));
    score += side === perspective ? value : -value;
  }
  return score;
}

function armxPreviewTopMoves(game, cap) {
  const moves = game.fastMoves();
  if (moves.length <= cap) return moves;

  // Tiny insertion set instead of sorting the entire legal list.
  const best = [];
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i];
    const score = armxPreviewMoveUrgency(move);
    let at = best.length;
    while (at > 0 && score > best[at - 1].score) at -= 1;
    if (at < cap) {
      best.splice(at, 0, { move, score });
      if (best.length > cap) best.pop();
    }
  }

  // Preview gets a small bounded chance to notice a quiet check without checking every move.
  const probe = Math.min(moves.length, ARMX_PREVIEW.checkProbeLimit);
  for (let i = 0; i < probe; i += 1) {
    const move = moves[i];
    if (!move.captured && !move.promotion && game.fastGivesCheck && game.fastGivesCheck(move)) {
      if (!best.some(entry => entry.move === move)) {
        best[best.length - 1] = { move, score: 1200 };
      }
      break;
    }
  }

  return best.map(entry => entry.move);
}

function armxPreviewIsForcing(game, move) {
  if (move.captured || move.promotion) return true;
  return Boolean(game.fastGivesCheck && game.fastGivesCheck(move));
}

function armxPreviewCritiqueCandidate(game, candidate, perspective, baseline, nodeBudget) {
  let nodes = 0;
  let worst = Infinity;
  let criticalReply = null;
  let criticalLine = [];

  game.fastApply(candidate);
  nodes += 1;
  const replies = armxPreviewTopMoves(game, ARMX_PREVIEW.maxReplies);

  if (!replies.length) {
    const score = armxPreviewStatic(game, perspective);
    game.fastUndo();
    return { score, risk: Math.max(0, baseline - score), nodes, criticalReply: null, line: [] };
  }

  for (const reply of replies) {
    if (nodes >= nodeBudget) break;
    game.fastApply(reply);
    nodes += 1;

    let bestRecovery = -Infinity;
    let bestRecoveryMove = null;
    const continuations = armxPreviewTopMoves(game, ARMX_PREVIEW.maxContinuations);

    if (!continuations.length) {
      bestRecovery = armxPreviewStatic(game, perspective);
    } else {
      for (const continuation of continuations) {
        if (nodes >= nodeBudget) break;

        // This must be evaluated before applying the continuation because fastGivesCheck
        // expects a move from the current position.
        const forcingContinuation = armxPreviewIsForcing(game, continuation);
        game.fastApply(continuation);
        nodes += 1;

        let value = armxPreviewStatic(game, perspective);

        // Fourth ply is exceptional, not normal: one reply, only after a forcing third ply.
        if (nodes < nodeBudget && forcingContinuation) {
          const fourthReplies = armxPreviewTopMoves(game, ARMX_PREVIEW.maxFourthPlyReplies);
          if (fourthReplies.length) {
            game.fastApply(fourthReplies[0]);
            nodes += 1;
            value = Math.min(value, armxPreviewStatic(game, perspective));
            game.fastUndo();
          }
        }

        game.fastUndo();
        if (value > bestRecovery) {
          bestRecovery = value;
          bestRecoveryMove = continuation;
        }
      }
    }

    game.fastUndo();
    if (bestRecovery < worst) {
      worst = bestRecovery;
      criticalReply = reply;
      criticalLine = bestRecoveryMove ? [reply, bestRecoveryMove] : [reply];
    }
  }

  game.fastUndo();
  if (worst === Infinity) worst = baseline;

  return {
    score: worst,
    risk: Math.max(0, baseline - worst),
    nodes,
    criticalReply,
    line: criticalLine,
  };
}

function armxPreviewReview(game, candidates, perspective) {
  const reports = [];
  const baseline = armxPreviewStatic(game, perspective);
  let totalNodes = 0;

  for (const entry of candidates.slice(0, ARMX_PREVIEW.maxCandidates)) {
    const remaining = ARMX_PREVIEW.maxNodes - totalNodes;
    if (remaining <= 0) break;

    const raw = entry.raw || entry.move;
    if (!raw) continue;

    const report = armxPreviewCritiqueCandidate(game, raw, perspective, baseline, remaining);
    totalNodes += report.nodes;

    // Preview authority is intentionally modest. A 100cp concrete risk does not automatically
    // overturn v5; it merely subtracts a bounded warning from that candidate's existing score.
    const adjustment = -Math.min(ARMX_PREVIEW.maxAdjustment, report.risk * 0.55);
    reports.push({
      raw,
      stonefishScore: entry.score,
      armxScore: report.score,
      risk: report.risk,
      criticalReply: report.criticalReply,
      line: report.line,
      nodes: report.nodes,
      adjustment,
    });
  }

  return {
    model: ARMX_PREVIEW.name,
    version: ARMX_PREVIEW.version,
    basePly: ARMX_PREVIEW.basePly,
    maxPly: ARMX_PREVIEW.maxPly,
    nodes: totalNodes,
    reports,
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.ARMX_PREVIEW = ARMX_PREVIEW;
  globalThis.armxPreviewReview = armxPreviewReview;
}
