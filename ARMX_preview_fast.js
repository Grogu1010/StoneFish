// ARMX-preview — development-only second-opinion model for Stonefish v5.5 testunit1.
//
// v5.5 baseline is Stonefish v5 Pro. ARMX-preview deliberately searches differently:
// v5 Pro is deeper but narrow; ARMX is shallower (3 ply, selective 4th) but reviews a
// broader root set and uses a counterplay-heavy evaluation. That gives it a real chance
// to catch candidates that v5 Pro's finalist beam did not search deeply.

const ARMX_PREVIEW = Object.freeze({
  name: 'ARMX-preview',
  version: 'preview-pro1',
  base: 'Stonefish v5 Pro',
  basePly: 3,
  maxPly: 4,
  maxCandidates: 8,
  maxReplies: 4,
  maxContinuations: 3,
  maxFourthPlyReplies: 2,
  maxNodes: 320,
  overrideThreshold: 55,
  emergencyOverrideThreshold: 28,
  emergencyScore: -180,
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

function armxPreviewMoveKey(move) {
  return `${move.from}:${move.to}:${move.promotion || 0}`;
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

function armxPreviewTopMoves(game, cap) {
  const legal = game.fastMoves();
  if (legal.length <= cap) return legal;
  return legal
    .map((move, index) => ({ move, index, order: armxPreviewMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
    .slice(0, cap)
    .map(entry => entry.move);
}

function armxPreviewMaterial(game, perspective) {
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

function armxPreviewTerminal(game, perspective, plyFromRoot, legal) {
  if (legal && legal.length) return null;
  if (!legal) legal = game.fastMoves();
  if (legal.length) return null;
  if (!game.in_check()) return 0;
  const mate = typeof STONEFISH_V5_PRO_MATE !== 'undefined' ? STONEFISH_V5_PRO_MATE : 20000000;
  return game.side === perspective ? -mate + plyFromRoot : mate - plyFromRoot;
}

function armxPreviewEvaluate(game, perspective) {
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return 0;

  let score = typeof stonefishV5ProAdaptivePosition === 'function'
    ? stonefishV5ProAdaptivePosition(game, perspective)
    : armxPreviewMaterial(game, perspective);

  // ARMX intentionally weights immediate counterplay more heavily than Pro's main search.
  if (typeof stonefishV5ProCounterplay === 'function') {
    const forcing = stonefishV5ProCounterplay(game, perspective);
    score += game.side === perspective ? forcing * 0.28 : -forcing * 0.82;
  }

  if (typeof stonefishV5ProKingZonePressure === 'function') {
    const ours = stonefishV5ProKingZonePressure(game, perspective);
    const theirs = stonefishV5ProKingZonePressure(game, -perspective);
    score += (ours - theirs) * 22;
  }

  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    const danger = stonefishV5EnemyPasserThreat(game, perspective);
    const ourDanger = stonefishV5EnemyPasserThreat(game, -perspective);
    if (danger >= 2200) score -= danger * 1.15;
    else if (danger >= 900) score -= danger * 0.48;
    else if (danger >= 300) score -= danger * 0.22;
    if (ourDanger >= 2200) score += ourDanger * 0.52;
    else if (ourDanger >= 900) score += ourDanger * 0.25;
  }

  if (game.in_check()) score += game.side === perspective ? -240 : 190;
  return score;
}

function armxPreviewCandidatePriority(game, entry) {
  const raw = entry.raw || entry.move;
  if (!raw) return -Infinity;
  let score = armxPreviewMoveOrder(game, raw) * 0.9;
  if (Number.isFinite(entry.preliminary)) score += entry.preliminary * 0.22;
  if (Number.isFinite(entry.scout)) score += entry.scout * 0.08;
  if (Number.isFinite(entry.tactical)) score += entry.tactical * 0.28;
  return score;
}

function armxPreviewCandidatePool(game, proScored) {
  const result = [];
  const seen = new Set();
  const add = entry => {
    const raw = entry && (entry.raw || entry.move);
    if (!raw) return;
    const key = armxPreviewMoveKey(raw);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  };

  // Always include every candidate Pro actually deep-searched first.
  proScored
    .filter(entry => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .forEach(add);

  // Then deliberately widen beyond Pro's finalist beam using a different ordering.
  proScored
    .filter(entry => !seen.has(armxPreviewMoveKey(entry.raw || entry.move)))
    .map((entry, index) => ({ entry, index, priority: armxPreviewCandidatePriority(game, entry) }))
    .sort((a, b) => (b.priority - a.priority) || (a.index - b.index))
    .forEach(item => {
      if (result.length < ARMX_PREVIEW.maxCandidates) add(item.entry);
    });

  return result.slice(0, ARMX_PREVIEW.maxCandidates);
}

function armxPreviewSearchCandidate(game, candidate, perspective, state) {
  const criticalLine = [];
  let worst = Infinity;
  let worstReply = null;

  if (state.nodes >= state.maxNodes) return { score: -Infinity, nodes: 0, line: [] };
  game.fastApply(candidate);
  state.nodes += 1;
  const replies = armxPreviewTopMoves(game, ARMX_PREVIEW.maxReplies);
  const rootTerminal = armxPreviewTerminal(game, perspective, 1, replies);
  if (rootTerminal !== null) {
    game.fastUndo();
    return { score: rootTerminal, nodes: 1, line: [] };
  }

  for (const reply of replies) {
    if (state.nodes >= state.maxNodes) break;
    const replyForcing = armxPreviewIsForcing(game, reply);
    game.fastApply(reply);
    state.nodes += 1;

    const continuations = armxPreviewTopMoves(game, ARMX_PREVIEW.maxContinuations);
    const replyTerminal = armxPreviewTerminal(game, perspective, 2, continuations);
    let bestRecovery = replyTerminal !== null ? replyTerminal : -Infinity;
    let bestContinuation = null;

    if (replyTerminal === null) {
      for (const continuation of continuations) {
        if (state.nodes >= state.maxNodes) break;
        const continuationForcing = armxPreviewIsForcing(game, continuation);
        game.fastApply(continuation);
        state.nodes += 1;

        let value;
        const fourthMoves = game.fastMoves();
        const thirdTerminal = armxPreviewTerminal(game, perspective, 3, fourthMoves);
        if (thirdTerminal !== null) {
          value = thirdTerminal;
        } else {
          value = armxPreviewEvaluate(game, perspective);

          // Fourth ply is selective: spend it when the line is forcing or when the opponent
          // has an immediately dangerous reply. The opponent gets the minimum value.
          const shouldExtend = continuationForcing || replyForcing ||
            fourthMoves.some(move => armxPreviewIsForcing(game, move));
          if (shouldExtend && state.nodes < state.maxNodes) {
            const orderedFourth = fourthMoves
              .map((move, index) => ({ move, index, order: armxPreviewMoveOrder(game, move) }))
              .sort((a, b) => (b.order - a.order) || (a.index - b.index))
              .slice(0, ARMX_PREVIEW.maxFourthPlyReplies)
              .map(entry => entry.move);
            let fourthWorst = Infinity;
            for (const fourth of orderedFourth) {
              if (state.nodes >= state.maxNodes) break;
              game.fastApply(fourth);
              state.nodes += 1;
              const fifthLegal = game.fastMoves();
              const fourthTerminal = armxPreviewTerminal(game, perspective, 4, fifthLegal);
              const fourthValue = fourthTerminal !== null ? fourthTerminal : armxPreviewEvaluate(game, perspective);
              game.fastUndo();
              if (fourthValue < fourthWorst) fourthWorst = fourthValue;
            }
            if (fourthWorst !== Infinity) value = Math.min(value, fourthWorst);
          }
        }

        game.fastUndo();
        if (value > bestRecovery) {
          bestRecovery = value;
          bestContinuation = continuation;
        }
      }
    }

    game.fastUndo();
    if (bestRecovery < worst) {
      worst = bestRecovery;
      worstReply = reply;
      criticalLine.length = 0;
      criticalLine.push(reply);
      if (bestContinuation) criticalLine.push(bestContinuation);
    }
  }

  game.fastUndo();
  if (worst === Infinity) worst = armxPreviewEvaluate(game, perspective);
  return { score: worst, reply: worstReply, line: criticalLine.slice() };
}

function armxPreviewReview(game, proScored, perspective) {
  const pool = armxPreviewCandidatePool(game, proScored);
  const state = { nodes: 0, maxNodes: ARMX_PREVIEW.maxNodes };
  const reports = [];

  for (const entry of pool) {
    if (state.nodes >= state.maxNodes) break;
    const raw = entry.raw || entry.move;
    const before = state.nodes;
    const searched = armxPreviewSearchCandidate(game, raw, perspective, state);
    reports.push({
      raw,
      proScore: entry.score,
      armxScore: searched.score,
      criticalReply: searched.reply || null,
      line: searched.line || [],
      nodes: state.nodes - before,
      forcing: armxPreviewIsForcing(game, raw),
    });
  }

  reports.sort((a, b) => {
    if (Math.abs(b.armxScore - a.armxScore) > 1e-9) return b.armxScore - a.armxScore;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  const proRaw = proScored.length ? proScored[0].raw : null;
  const proReport = reports.find(report => proRaw && stonefishV5SameMove(report.raw, proRaw)) || null;
  const best = reports.length ? reports[0] : null;
  const gain = best && proReport ? best.armxScore - proReport.armxScore : 0;
  const threshold = proReport && proReport.armxScore <= ARMX_PREVIEW.emergencyScore
    ? ARMX_PREVIEW.emergencyOverrideThreshold
    : ARMX_PREVIEW.overrideThreshold;
  const override = Boolean(best && proReport && !stonefishV5SameMove(best.raw, proRaw) && gain >= threshold);

  return {
    model: ARMX_PREVIEW.name,
    version: ARMX_PREVIEW.version,
    base: ARMX_PREVIEW.base,
    basePly: ARMX_PREVIEW.basePly,
    maxPly: ARMX_PREVIEW.maxPly,
    nodes: state.nodes,
    candidatesReviewed: reports.length,
    reports,
    proRaw,
    recommendedRaw: override ? best.raw : proRaw,
    override,
    gain,
    threshold,
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.ARMX_PREVIEW = ARMX_PREVIEW;
  globalThis.armxPreviewReview = armxPreviewReview;
}
