// ARMX-preview — development-only adversarial critic for Stonefish v5.5 testunit1.
// Fast by design: 3-ply base, selective 4th ply, tiny candidate/reply caps, hard node budget.
// Advisory only. Future ARMX versions can become materially stronger without changing Stonefish v5.

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

function armxPreviewMoveUrgency(game, move) {
  let score = 0;
  if (move.captured) score += armxPreviewPieceValue(move.captured) * 4 - armxPreviewPieceValue(move.piece);
  if (move.promotion) score += armxPreviewPieceValue(move.promotion) * 3;
  if (game.fastGivesCheck && game.fastGivesCheck(move)) score += 1300;
  if (move.flags & (4 | 8)) score += 40;
  return score;
}

function armxPreviewForcing(game, move) {
  return Boolean(move.captured || move.promotion || (game.fastGivesCheck && game.fastGivesCheck(move)));
}

function armxPreviewStatic(game, perspective) {
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

function armxPreviewSortedMoves(game, cap) {
  const moves = game.fastMoves();
  moves.sort((a, b) => armxPreviewMoveUrgency(game, b) - armxPreviewMoveUrgency(game, a));
  return moves.slice(0, cap);
}

function armxPreviewCritiqueCandidate(game, candidate, perspective) {
  let nodes = 0;
  let worst = Infinity;
  let criticalReply = null;
  let criticalLine = [];

  game.fastApply(candidate);
  nodes += 1;
  const replies = armxPreviewSortedMoves(game, ARMX_PREVIEW.maxReplies);

  if (!replies.length) {
    const terminal = armxPreviewStatic(game, perspective);
    game.fastUndo();
    return { score: terminal, risk: 0, nodes, criticalReply: null, line: [] };
  }

  for (const reply of replies) {
    if (nodes >= ARMX_PREVIEW.maxNodes) break;
    game.fastApply(reply);
    nodes += 1;

    let bestRecovery = -Infinity;
    let bestRecoveryMove = null;
    const continuations = armxPreviewSortedMoves(game, ARMX_PREVIEW.maxContinuations);

    if (!continuations.length) {
      bestRecovery = armxPreviewStatic(game, perspective);
    } else {
      for (const continuation of continuations) {
        if (nodes >= ARMX_PREVIEW.maxNodes) break;
        game.fastApply(continuation);
        nodes += 1;

        let value = armxPreviewStatic(game, perspective);

        // Preview only spends a fourth ply on a forcing continuation.
        if (armxPreviewForcing(game, continuation) && nodes < ARMX_PREVIEW.maxNodes) {
          const fourthReplies = armxPreviewSortedMoves(game, ARMX_PREVIEW.maxFourthPlyReplies);
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
  if (worst === Infinity) worst = 0;
  return {
    score: worst,
    risk: Math.max(0, -worst),
    nodes,
    criticalReply,
    line: criticalLine,
  };
}

function armxPreviewReview(game, candidates, perspective) {
  const reports = [];
  let totalNodes = 0;

  for (const entry of candidates.slice(0, ARMX_PREVIEW.maxCandidates)) {
    if (totalNodes >= ARMX_PREVIEW.maxNodes) break;
    const report = armxPreviewCritiqueCandidate(game, entry.move, perspective);
    totalNodes += report.nodes;
    const disagreement = Math.max(0, entry.score - report.score);
    reports.push({
      move: entry.move,
      stonefishScore: entry.score,
      armxScore: report.score,
      risk: report.risk,
      criticalReply: report.criticalReply,
      line: report.line,
      nodes: report.nodes,
      adjustment: -Math.min(ARMX_PREVIEW.maxAdjustment, disagreement * 0.12 + report.risk * 0.04),
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
