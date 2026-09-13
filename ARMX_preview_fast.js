// ARMX-preview — fast adversarial threat scanner for Stonefish v5.5 testunit1.
//
// Preview is intentionally NOT a full engine. It scans replies Stonefish v5 Pro's
// normal beam is likely to miss, then follows only a few suspicious branches to a
// 3-ply base / selective 4-ply horizon. Later ARMX releases can become deeper and
// more strategic; this preview prioritises speed and useful disagreement.

const ARMX_PREVIEW = Object.freeze({
  name: 'ARMX-preview',
  version: 'preview-v55-fast1',
  base: 'Stonefish v5 Pro',
  basePly: 3,
  maxPly: 4,
  maxCandidates: 2,
  maxReplies: 4,
  maxContinuations: 2,
  maxFourthPlyReplies: 1,
  maxCriticalReplies: 1,
  maxNodes: 140,
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
  let score = (armxPreviewPieceValue(move.captured) || 0) * 18;
  if (move.promotion) score += armxPreviewPieceValue(move.promotion) * 12 + 2200;
  if (game.fastGivesCheck && game.fastGivesCheck(move)) score += 2500;
  if (move.flags & (4 | 8)) score += 120;
  return score;
}

function armxPreviewIsForcing(game, move) {
  return Boolean(move.captured || move.promotion || (game.fastGivesCheck && game.fastGivesCheck(move)));
}

function armxPreviewBaseEval(game, perspective) {
  let score = typeof stonefishV5ProCachedPositionScore === 'function'
    ? stonefishV5ProCachedPositionScore(game, perspective)
    : stonefishV5PositionScore(game, perspective);
  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    const danger = stonefishV5EnemyPasserThreat(game, perspective);
    if (danger >= 2200) score -= danger * 1.25;
    else if (danger >= 900) score -= danger * 0.56;
    else if (danger >= 300) score -= danger * 0.20;
  }
  if (game.in_check()) score += game.side === perspective ? -240 : 160;
  return score;
}

function armxPreviewRichEval(game, perspective) {
  let score = armxPreviewBaseEval(game, perspective);
  if (typeof stonefishV5ProKingZonePressure === 'function') {
    score += (stonefishV5ProKingZonePressure(game, perspective)
      - stonefishV5ProKingZonePressure(game, -perspective)) * 15;
  }
  if (typeof stonefishV5ProRayTactics === 'function') {
    score += stonefishV5ProRayTactics(game, perspective) * 0.25;
  }
  return score;
}

function armxPreviewTerminal(game, perspective, plyFromRoot, legal) {
  if (legal.length) return null;
  if (!game.in_check()) return 0;
  return game.side === perspective
    ? -STONEFISH_V5_PRO_MATE + plyFromRoot
    : STONEFISH_V5_PRO_MATE - plyFromRoot;
}

function armxPreviewProReplyWidth(game, legal) {
  let width = (typeof STONEFISH_V5_PRO_SPEED_BRANCH !== 'undefined'
    ? STONEFISH_V5_PRO_SPEED_BRANCH[4]
    : 5) || 5;
  if (game.in_check()) width = Math.max(width, 6);
  return Math.min(width, legal.length);
}

function armxPreviewNovelReplies(game, perspective, state) {
  const legal = game.fastMoves();
  if (!legal.length) return { legalCount: 0, proBeamCount: 0, replies: [] };
  const proOrder = typeof stonefishV5ProSpeedMoveOrder === 'function'
    ? stonefishV5ProSpeedMoveOrder
    : armxPreviewMoveOrder;
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
    let score = armxPreviewBaseEval(game, perspective);
    game.fastUndo();
    if (forcing) score -= 20;
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

  if (!screened.legalCount) {
    const terminal = game.in_check() ? STONEFISH_V5_PRO_MATE - 1 : 0;
    game.fastUndo();
    return { score: terminal, criticalReply: null, criticalReplies: [], line: [], legalReplies: 0, proBeamReplies: 0, novelReplies: 0 };
  }
  if (!screened.replies.length) {
    const score = armxPreviewBaseEval(game, perspective);
    game.fastUndo();
    return { score, criticalReply: null, criticalReplies: [], line: [], legalReplies: screened.legalCount, proBeamReplies: screened.proBeamCount, novelReplies: 0 };
  }

  const results = [];
  for (const reply of screened.replies) {
    if (state.nodes >= state.maxNodes) break;
    game.fastApply(reply);
    state.nodes += 1;
    const legal = game.fastMoves();
    const terminal = armxPreviewTerminal(game, perspective, 2, legal);
    let best = terminal !== null ? terminal : -Infinity;
    let bestMove = null;

    if (terminal === null) {
      const continuations = legal
        .map((move, index) => ({ move, index, order: armxPreviewMoveOrder(game, move) }))
        .sort((a, b) => (b.order - a.order) || (a.index - b.index))
        .slice(0, ARMX_PREVIEW.maxContinuations);
      for (const entry of continuations) {
        if (state.nodes >= state.maxNodes) break;
        const forcing = armxPreviewIsForcing(game, entry.move);
        game.fastApply(entry.move);
        state.nodes += 1;
        let value = armxPreviewRichEval(game, perspective);

        if (forcing && state.nodes < state.maxNodes) {
          const fourth = game.fastMoves()
            .map((move, index) => ({ move, index, order: armxPreviewMoveOrder(game, move) }))
            .sort((a, b) => (b.order - a.order) || (a.index - b.index))
            .slice(0, ARMX_PREVIEW.maxFourthPlyReplies);
          if (fourth.length) {
            game.fastApply(fourth[0].move);
            state.nodes += 1;
            value = Math.min(value, armxPreviewRichEval(game, perspective));
            game.fastUndo();
          }
        }

        game.fastUndo();
        if (value > best) { best = value; bestMove = entry.move; }
      }
    }
    game.fastUndo();
    results.push({ reply, score: best, line: bestMove ? [reply, bestMove] : [reply] });
  }

  game.fastUndo();
  results.sort((a, b) => a.score - b.score);
  const criticalReplies = results.slice(0, ARMX_PREVIEW.maxCriticalReplies);
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

function armxPreviewReview(game, candidates, perspective) {
  const finalists = candidates
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
