// ARMX-preview — adversarial reply critic for Stonefish v5.5 testunit1.
//
// Stonefish v5 Pro is deep but deliberately narrow. ARMX-preview is the opposite:
// it stays at 3 ply (selective 4th) but scans the full opponent reply set looking for
// quiet refutations, defensive resources and counterplay that Pro's forcing-move beam
// might not search. It does not choose the final move; it returns critical replies for
// Stonefish to verify with Pro's own search.

const ARMX_PREVIEW = Object.freeze({
  name: 'ARMX-preview',
  version: 'preview-pro2',
  base: 'Stonefish v5 Pro',
  basePly: 3,
  maxPly: 4,
  maxCandidates: 4,
  maxReplies: 8,
  maxContinuations: 3,
  maxFourthPlyReplies: 2,
  maxNodes: 400,
});

function armxPreviewPieceValue(type) {
  if (type === 1) return 100;
  if (type === 2) return 320;
  if (type === 3) return 335;
  if (type === 4) return 510;
  if (type === 5) return 930;
  if (type === 6) return 20000;
  return 0;
}

function armxPreviewMoveOrder(game, move) {
  let score = (armxPreviewPieceValue(move.captured) || 0) * 16 - (armxPreviewPieceValue(move.piece) || 0) * (move.captured ? 1 : 0);
  if (move.promotion) score += armxPreviewPieceValue(move.promotion) * 11 + 1800;
  if (move.flags & (4 | 8)) score += 180;
  if (game.fastGivesCheck && game.fastGivesCheck(move)) score += 2200;
  return score;
}

function armxPreviewIsForcing(game, move) {
  if (move.captured || move.promotion) return true;
  return Boolean(game.fastGivesCheck && game.fastGivesCheck(move));
}

function armxPreviewMaterial(game, perspective) {
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (!p) continue;
    const value = armxPreviewPieceValue(Math.abs(p));
    score += (p > 0 ? 1 : -1) === perspective ? value : -value;
  }
  return score;
}

function armxPreviewEvaluate(game, perspective) {
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return 0;

  let score = typeof stonefishV5ProAdaptivePosition === 'function'
    ? stonefishV5ProAdaptivePosition(game, perspective)
    : armxPreviewMaterial(game, perspective);

  if (typeof stonefishV5ProCounterplay === 'function') {
    const forcing = stonefishV5ProCounterplay(game, perspective);
    score += game.side === perspective ? forcing * 0.22 : -forcing * 0.72;
  }
  if (typeof stonefishV5ProKingZonePressure === 'function') {
    score += (stonefishV5ProKingZonePressure(game, perspective) - stonefishV5ProKingZonePressure(game, -perspective)) * 18;
  }
  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    const danger = stonefishV5EnemyPasserThreat(game, perspective);
    if (danger >= 2200) score -= danger * 1.0;
    else if (danger >= 900) score -= danger * 0.45;
    else if (danger >= 300) score -= danger * 0.18;
  }
  if (game.in_check()) score += game.side === perspective ? -220 : 170;
  return score;
}

function armxPreviewTerminal(game, perspective, plyFromRoot, legal) {
  if (legal.length) return null;
  if (!game.in_check()) return 0;
  return game.side === perspective
    ? -STONEFISH_V5_PRO_MATE + plyFromRoot
    : STONEFISH_V5_PRO_MATE - plyFromRoot;
}

function armxPreviewTopContinuations(game, cap) {
  const legal = game.fastMoves();
  return legal
    .map((move, index) => ({ move, index, order: armxPreviewMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
    .slice(0, cap)
    .map(entry => entry.move);
}

function armxPreviewWorstReplies(game, perspective, state) {
  const replies = game.fastMoves();
  const screened = [];

  // This full reply scan is ARMX-preview's defining difference from Pro. Each legal
  // reply gets a cheap resulting-position look, so a quiet move can outrank flashy
  // checks/captures if it actually makes the position worse for Stonefish.
  for (let i = 0; i < replies.length && state.nodes < state.maxNodes; i += 1) {
    const reply = replies[i];
    const forcing = armxPreviewIsForcing(game, reply);
    game.fastApply(reply);
    state.nodes += 1;
    let score = armxPreviewEvaluate(game, perspective);
    game.fastUndo();

    // Keep a modest forcing bias without letting it dominate the positional screen.
    if (forcing) score -= 28;
    screened.push({ reply, score, index: i });
  }

  screened.sort((a, b) => (a.score - b.score) || (a.index - b.index));
  return screened.slice(0, ARMX_PREVIEW.maxReplies).map(entry => entry.reply);
}

function armxPreviewSearchCandidate(game, raw, perspective, state) {
  game.fastApply(raw);
  state.nodes += 1;

  const replies = armxPreviewWorstReplies(game, perspective, state);
  const rootTerminal = armxPreviewTerminal(game, perspective, 1, replies);
  if (rootTerminal !== null) {
    game.fastUndo();
    return { score: rootTerminal, criticalReply: null, line: [] };
  }

  let worst = Infinity;
  let criticalReply = null;
  let criticalContinuation = null;

  for (const reply of replies) {
    if (state.nodes >= state.maxNodes) break;
    game.fastApply(reply);
    state.nodes += 1;
    const continuations = armxPreviewTopContinuations(game, ARMX_PREVIEW.maxContinuations);
    const replyTerminal = armxPreviewTerminal(game, perspective, 2, continuations);
    let bestRecovery = replyTerminal !== null ? replyTerminal : -Infinity;
    let bestMove = null;

    if (replyTerminal === null) {
      for (const continuation of continuations) {
        if (state.nodes >= state.maxNodes) break;
        const forcing = armxPreviewIsForcing(game, continuation);
        game.fastApply(continuation);
        state.nodes += 1;
        const fourth = game.fastMoves();
        const thirdTerminal = armxPreviewTerminal(game, perspective, 3, fourth);
        let value = thirdTerminal !== null ? thirdTerminal : armxPreviewEvaluate(game, perspective);

        if (thirdTerminal === null && forcing && state.nodes < state.maxNodes) {
          const ordered = fourth
            .map((move, index) => ({ move, index, order: armxPreviewMoveOrder(game, move) }))
            .sort((a, b) => (b.order - a.order) || (a.index - b.index))
            .slice(0, ARMX_PREVIEW.maxFourthPlyReplies)
            .map(entry => entry.move);
          let fourthWorst = Infinity;
          for (const move of ordered) {
            if (state.nodes >= state.maxNodes) break;
            game.fastApply(move);
            state.nodes += 1;
            const legal = game.fastMoves();
            const terminal = armxPreviewTerminal(game, perspective, 4, legal);
            const replyValue = terminal !== null ? terminal : armxPreviewEvaluate(game, perspective);
            game.fastUndo();
            if (replyValue < fourthWorst) fourthWorst = replyValue;
          }
          if (fourthWorst !== Infinity) value = Math.min(value, fourthWorst);
        }

        game.fastUndo();
        if (value > bestRecovery) {
          bestRecovery = value;
          bestMove = continuation;
        }
      }
    }

    game.fastUndo();
    if (bestRecovery < worst) {
      worst = bestRecovery;
      criticalReply = reply;
      criticalContinuation = bestMove;
    }
  }

  game.fastUndo();
  if (worst === Infinity) worst = armxPreviewEvaluate(game, perspective);
  return {
    score: worst,
    criticalReply,
    line: criticalReply ? (criticalContinuation ? [criticalReply, criticalContinuation] : [criticalReply]) : [],
  };
}

function armxPreviewReview(game, proScored, perspective) {
  const finalists = proScored
    .filter(entry => Number.isFinite(entry.score))
    .slice(0, ARMX_PREVIEW.maxCandidates);
  const state = { nodes: 0, maxNodes: ARMX_PREVIEW.maxNodes };
  const reports = [];

  for (const entry of finalists) {
    if (state.nodes >= state.maxNodes) break;
    const before = state.nodes;
    const result = armxPreviewSearchCandidate(game, entry.raw, perspective, state);
    reports.push({
      raw: entry.raw,
      proScore: entry.score,
      proDeep: entry.deep,
      armxScore: result.score,
      criticalReply: result.criticalReply,
      line: result.line,
      nodes: state.nodes - before,
    });
  }

  return {
    model: ARMX_PREVIEW.name,
    version: ARMX_PREVIEW.version,
    base: ARMX_PREVIEW.base,
    basePly: ARMX_PREVIEW.basePly,
    maxPly: ARMX_PREVIEW.maxPly,
    nodes: state.nodes,
    candidatesReviewed: reports.length,
    reports,
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.ARMX_PREVIEW = ARMX_PREVIEW;
  globalThis.armxPreviewReview = armxPreviewReview;
}
