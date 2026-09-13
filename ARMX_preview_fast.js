// ARMX-preview — adversarial reply critic for Stonefish v5.5 testunit1.
//
// Stonefish v5 Pro is deep but deliberately narrow. ARMX-preview stays shallow
// (3-ply base, selective 4th ply) and looks specifically where Pro did NOT look:
// opponent replies outside Pro's normal reply beam. It returns concrete missed
// replies for Stonefish to verify with Pro's own five-ply search.
//
// This keeps ARMX complementary to Pro instead of duplicating work. Preview is
// intentionally bounded so later ARMX releases can add depth, richer strategy,
// more reply coverage, and stronger learned prioritisation.

const ARMX_PREVIEW = Object.freeze({
  name: 'ARMX-preview',
  version: 'preview-pro3-fast',
  base: 'Stonefish v5 Pro',
  basePly: 3,
  maxPly: 4,
  maxCandidates: 2,
  maxReplies: 6,
  maxContinuations: 3,
  maxFourthPlyReplies: 2,
  maxCriticalReplies: 2,
  maxNodes: 220,
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
  let score = (armxPreviewPieceValue(move.captured) || 0) * 16
    - (armxPreviewPieceValue(move.piece) || 0) * (move.captured ? 1 : 0);
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

  // ARMX-preview is deliberately threat-sensitive. Pro already has a balanced
  // evaluator; the critic should be biased toward finding reasons a move can fail.
  if (typeof stonefishV5ProCounterplay === 'function') {
    const counterplay = stonefishV5ProCounterplay(game, perspective);
    score += game.side === perspective ? counterplay * 0.12 : -counterplay * 0.82;
  }
  if (typeof stonefishV5ProKingZonePressure === 'function') {
    const ours = stonefishV5ProKingZonePressure(game, perspective);
    const theirs = stonefishV5ProKingZonePressure(game, -perspective);
    score += (ours - theirs) * 22;
  }
  if (typeof stonefishV5ProLooseAndCoordination === 'function') {
    score += stonefishV5ProLooseAndCoordination(game, perspective) * 0.42;
  }
  if (typeof stonefishV5ProRayTactics === 'function') {
    score += stonefishV5ProRayTactics(game, perspective) * 0.38;
  }
  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    const danger = stonefishV5EnemyPasserThreat(game, perspective);
    if (danger >= 2200) score -= danger * 1.15;
    else if (danger >= 900) score -= danger * 0.55;
    else if (danger >= 300) score -= danger * 0.24;
  }
  if (game.in_check()) score += game.side === perspective ? -260 : 190;
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

function armxPreviewProReplyWidth(game, legal) {
  let width = (typeof STONEFISH_V5_PRO_SPEED_BRANCH !== 'undefined'
    ? STONEFISH_V5_PRO_SPEED_BRANCH[4]
    : 5) || 5;
  const danger = typeof stonefishV5EnemyPasserThreat === 'function'
    ? stonefishV5EnemyPasserThreat(game, game.side)
    : 0;
  if (game.in_check()) width = Math.max(width, 6);
  else if (danger >= 2200) width += 2;
  else if (danger >= 900) width += 1;
  return Math.min(width, legal.length);
}

function armxPreviewNovelReplies(game, perspective, state) {
  const legal = game.fastMoves();
  if (!legal.length) return { legalCount: 0, proBeamCount: 0, replies: [] };

  const proOrder = typeof stonefishV5ProSpeedMoveOrder === 'function'
    ? stonefishV5ProSpeedMoveOrder
    : (typeof stonefishV5ProMoveOrder === 'function' ? stonefishV5ProMoveOrder : armxPreviewMoveOrder);
  const orderedForPro = legal
    .map((move, index) => ({ move, index, order: proOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index));
  const proBeamCount = armxPreviewProReplyWidth(game, legal);
  const proBeam = new Set(orderedForPro.slice(0, proBeamCount).map(entry => entry.move));

  const screened = [];
  for (let i = 0; i < legal.length && state.nodes < state.maxNodes; i += 1) {
    const reply = legal[i];
    if (proBeam.has(reply)) continue;

    const forcing = armxPreviewIsForcing(game, reply);
    game.fastApply(reply);
    state.nodes += 1;
    let score = armxPreviewEvaluate(game, perspective);
    game.fastUndo();

    // Force is useful evidence, but unlike Pro's move order it is not allowed to
    // dominate: ARMX's main purpose is discovering quiet missed resources.
    if (forcing) score -= 18;
    screened.push({ reply, score, index: i });
  }

  screened.sort((a, b) => (a.score - b.score) || (a.index - b.index));
  return {
    legalCount: legal.length,
    proBeamCount,
    replies: screened.slice(0, ARMX_PREVIEW.maxReplies).map(entry => entry.reply),
  };
}

function armxPreviewSearchCandidate(game, raw, perspective, state) {
  game.fastApply(raw);
  state.nodes += 1;

  const screened = armxPreviewNovelReplies(game, perspective, state);
  if (screened.legalCount === 0) {
    const terminal = game.in_check() ? STONEFISH_V5_PRO_MATE - 1 : 0;
    game.fastUndo();
    return {
      score: terminal,
      criticalReply: null,
      criticalReplies: [],
      line: [],
      legalReplies: 0,
      proBeamReplies: 0,
      novelReplies: 0,
    };
  }

  if (!screened.replies.length) {
    const score = armxPreviewEvaluate(game, perspective);
    game.fastUndo();
    return {
      score,
      criticalReply: null,
      criticalReplies: [],
      line: [],
      legalReplies: screened.legalCount,
      proBeamReplies: screened.proBeamCount,
      novelReplies: Math.max(0, screened.legalCount - screened.proBeamCount),
    };
  }

  const replyResults = [];
  for (const reply of screened.replies) {
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
    replyResults.push({
      reply,
      score: bestRecovery,
      line: bestMove ? [reply, bestMove] : [reply],
    });
  }

  game.fastUndo();
  replyResults.sort((a, b) => a.score - b.score);
  const criticalReplies = replyResults.slice(0, ARMX_PREVIEW.maxCriticalReplies);
  const critical = criticalReplies[0] || null;
  return {
    score: critical ? critical.score : 0,
    criticalReply: critical ? critical.reply : null,
    criticalReplies,
    line: critical ? critical.line : [],
    legalReplies: screened.legalCount,
    proBeamReplies: screened.proBeamCount,
    novelReplies: Math.max(0, screened.legalCount - screened.proBeamCount),
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
      criticalReplies: result.criticalReplies,
      line: result.line,
      legalReplies: result.legalReplies,
      proBeamReplies: result.proBeamReplies,
      novelReplies: result.novelReplies,
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
