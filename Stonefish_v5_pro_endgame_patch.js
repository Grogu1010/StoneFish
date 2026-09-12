// Stonefish v5 Pro endgame-race strength layer.
//
// Keep the proven fast five-ply engine unchanged in ordinary positions. When a
// genuinely advanced passed pawn creates a promotion race, spend some of the
// measured speed headroom on the moves that decide that race: pushes,
// promotions, captures of the passer, blockades and forcing checks.
//
// This is general chess logic only. It has no opponent, opening-suite or
// benchmark-specific branches.

const STONEFISH_V5_PRO_RACE_QDEPTH = 2;
const STONEFISH_V5_PRO_RACE_EXTRA_ROOT = 2;
const stonefishV5ProRaceBaseLeaf = stonefishV5ProLeaf;
const stonefishV5ProRaceBaseMinimax = stonefishV5ProMinimax;
const stonefishV5ProRaceBaseScoreAllMoves = stonefishV5ProScoreAllMoves;

function stonefishV5ProRaceKingDistance(a, b) {
  const af = a & 7, ar = a >> 3;
  const bf = b & 7, br = b >> 3;
  return Math.max(Math.abs(af - bf), Math.abs(ar - br));
}

function stonefishV5ProRacePasserValue(game, passer, side) {
  const enemy = -side;
  const promotionRank = side === 1 ? 7 : 0;
  const promotionSq = promotionRank * 8 + passer.file;
  const nextSq = passer.sq + side * 8;
  const tempo = game.side === side ? 1 : 0;

  let value;
  if (passer.distance <= 1) value = 14500;
  else if (passer.distance === 2) value = 6100;
  else if (passer.distance === 3) value = 2200;
  else if (passer.distance === 4) value = 620;
  else value = 0;
  if (!value) return 0;

  if (nextSq >= 0 && nextSq < 64) {
    const blocker = game.boardState[nextSq];
    if (blocker) {
      const blockerSide = blocker > 0 ? 1 : -1;
      value *= blockerSide === enemy ? 0.20 : 0.72;
    } else {
      const enemyAttacks = game._isAttacked(nextSq, enemy);
      const ownSupport = game._isAttacked(nextSq, side);
      if (!enemyAttacks) value *= 1.22;
      else if (ownSupport) value *= 0.90;
      else value *= 0.58;
    }
  }

  const enemyKing = game.kingSq[enemy];
  const ownKing = game.kingSq[side];
  const enemyKingDistance = stonefishV5ProRaceKingDistance(enemyKing, promotionSq);
  const ownKingDistance = stonefishV5ProRaceKingDistance(ownKing, passer.sq);
  const racePlies = passer.distance * 2 - tempo;

  if (enemyKingDistance * 2 > racePlies + 2) value *= 1.28;
  else if (enemyKingDistance * 2 <= Math.max(1, racePlies - 2)) value *= 0.68;
  if (ownKingDistance <= 2) value *= 1.10;

  if (game._isAttacked(promotionSq, enemy)) value *= 0.78;
  if (game._isAttacked(promotionSq, side)) value *= 1.08;
  if (tempo && passer.distance <= 2) value += 900;
  return value;
}

function stonefishV5ProRaceInfo(game, perspective) {
  const ours = stonefishV5PassedPawnInfo(game, perspective);
  const theirs = stonefishV5PassedPawnInfo(game, -perspective);
  let ourBest = 0, theirBest = 0;
  let critical = false;

  for (let i = 0; i < ours.length; i += 1) {
    if (ours[i].distance <= 3) critical = true;
    ourBest = Math.max(ourBest, stonefishV5ProRacePasserValue(game, ours[i], perspective));
  }
  for (let i = 0; i < theirs.length; i += 1) {
    if (theirs[i].distance <= 3) critical = true;
    theirBest = Math.max(theirBest, stonefishV5ProRacePasserValue(game, theirs[i], -perspective));
  }

  return { ours, theirs, ourBest, theirBest, critical, score: ourBest - theirBest * 1.08 };
}

stonefishV5ProLeaf = function(game, perspective) {
  const score = stonefishV5ProRaceBaseLeaf(game, perspective);
  const info = stonefishV5ProRaceInfo(game, perspective);
  if (!info.critical) return score;
  return score + info.score;
};

function stonefishV5ProRaceMovePriority(game, move, perspective) {
  const side = game.side;
  const enemy = -side;
  const ownPassers = stonefishV5PassedPawnInfo(game, side);
  const enemyPassers = stonefishV5PassedPawnInfo(game, enemy);
  let priority = 0;

  if (move.promotion) priority += 100000 + (STONEFISH_V5_PIECE[move.promotion] || 0) * 50;
  if (move.captured) priority += (STONEFISH_V5_PIECE[move.captured] || 0) * 8;

  for (let i = 0; i < ownPassers.length; i += 1) {
    const passer = ownPassers[i];
    if (passer.distance > 3 || move.from !== passer.sq) continue;
    if ((side === 1 && move.to > move.from) || (side === -1 && move.to < move.from)) {
      priority += 30000 + (4 - passer.distance) * 9000;
    }
  }

  for (let i = 0; i < enemyPassers.length; i += 1) {
    const passer = enemyPassers[i];
    if (passer.distance > 3) continue;
    const nextSq = passer.sq + enemy * 8;
    if (move.to === passer.sq) priority += 42000 + (4 - passer.distance) * 10000;
    if (move.to === nextSq) priority += 22000 + (4 - passer.distance) * 7000;
  }

  if (game.fastGivesCheck(move)) priority += 12000;
  return priority;
}

function stonefishV5ProRaceForcingMoves(game, perspective) {
  const legal = game.fastMoves();
  const ranked = [];
  for (let i = 0; i < legal.length; i += 1) {
    const move = legal[i];
    const priority = stonefishV5ProRaceMovePriority(game, move, perspective);
    if (priority > 0) ranked.push({ move, priority, index: i });
  }
  ranked.sort((a, b) => (b.priority - a.priority) || (a.index - b.index));
  return ranked.slice(0, 7).map(entry => entry.move);
}

function stonefishV5ProRaceQuiescence(game, perspective, alpha, beta, qDepth, plyFromRoot) {
  if (!game.fastHasLegalMove()) {
    if (game.in_check()) {
      return game.side === perspective
        ? -STONEFISH_V5_PRO_MATE + plyFromRoot
        : STONEFISH_V5_PRO_MATE - plyFromRoot;
    }
    return 0;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;

  const standPat = stonefishV5ProLeaf(game, perspective);
  if (qDepth <= 0) return standPat;
  const info = stonefishV5ProRaceInfo(game, perspective);
  if (!info.critical) return standPat;

  const moves = stonefishV5ProRaceForcingMoves(game, perspective);
  if (!moves.length) return standPat;
  const maximizing = game.side === perspective;
  let best = standPat;

  if (maximizing) {
    if (best > alpha) alpha = best;
  } else if (best < beta) {
    beta = best;
  }
  if (beta <= alpha) return best;

  for (let i = 0; i < moves.length; i += 1) {
    game.fastApply(moves[i]);
    const value = stonefishV5ProRaceQuiescence(
      game, perspective, alpha, beta, qDepth - 1, plyFromRoot + 1
    );
    game.fastUndo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}

stonefishV5ProMinimax = function(game, depth, perspective, alpha, beta, plyFromRoot) {
  if (depth <= 0 && !game.in_check()) {
    const info = stonefishV5ProRaceInfo(game, perspective);
    if (info.critical) {
      return stonefishV5ProRaceQuiescence(
        game, perspective, alpha, beta, STONEFISH_V5_PRO_RACE_QDEPTH, plyFromRoot
      );
    }
  }
  return stonefishV5ProRaceBaseMinimax(game, depth, perspective, alpha, beta, plyFromRoot);
};

function stonefishV5ProRaceRootBonus(game, raw, perspective) {
  const before = stonefishV5ProRaceInfo(game, perspective);
  if (!before.critical) return 0;
  const movePriority = stonefishV5ProRaceMovePriority(game, raw, perspective);
  game.fastApply(raw);
  const after = stonefishV5ProRaceInfo(game, perspective);
  game.fastUndo();
  return (after.score - before.score) * 0.72 + movePriority * 0.08;
}

stonefishV5ProScoreAllMoves = function(game) {
  const scored = stonefishV5ProRaceBaseScoreAllMoves(game);
  if (!scored.length) return scored;
  const perspective = game.side;
  const rootInfo = stonefishV5ProRaceInfo(game, perspective);
  if (!rootInfo.critical) return scored;

  // Rescue at most two race-forcing moves that the ordinary four-finalist beam
  // did not search. This extra work exists only in critical promotion races.
  const rescue = scored
    .map((entry, index) => ({ entry, index, priority: stonefishV5ProRaceMovePriority(game, entry.raw, perspective) }))
    .filter(row => row.priority > 0 && row.entry.deep === null)
    .sort((a, b) => (b.priority - a.priority) || (a.index - b.index))
    .slice(0, STONEFISH_V5_PRO_RACE_EXTRA_ROOT);

  if (rescue.length) {
    const legal = scored.map(entry => entry.raw);
    const heritageMove = stonefishV5HeritageMove(game);
    const bookMove = stonefishV45BookMove(game, 1, legal);
    STONEFISH_V5_PRO_ACTIVE_TT = new Map();
    try {
      for (let i = 0; i < rescue.length; i += 1) {
        const entry = rescue[i].entry;
        if (entry.tactical === null) entry.tactical = stonefishV5TacticalScore(game, entry.raw);
        entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
          ? 0
          : stonefishV5ProRootKnowledge(
              game, entry.raw, heritageMove, bookMove, perspective, entry.tactical
            );
        entry.preliminary = entry.tactical + entry.knowledge
          + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
        entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
        entry.score = Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9
          ? entry.deep
          : entry.deep * stonefishV5ProConfidenceDeepWeight(entry)
            + entry.preliminary * 0.38
            + stonefishV5ProHeritageConfidenceBonus(entry);
      }
    } finally {
      STONEFISH_V5_PRO_ACTIVE_TT = null;
    }
  }

  for (let i = 0; i < scored.length; i += 1) {
    if (Number.isFinite(scored[i].score)) {
      scored[i].score += stonefishV5ProRaceRootBonus(game, scored[i].raw, perspective);
    }
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
