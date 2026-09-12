// Stonefish_v4.5 refinement layer.
// ONLY the three v4.5 additions are changed here:
// 1) weighted opening knowledge,
// 2) forced-mate pattern knowledge,
// 3) inverse positional tie-breakers.
//
// v3/v4 search depth and every v4 criterion remain unchanged.

function stonefishV45FilterByV4Order(game, candidates, order) {
  let kept = candidates.slice();
  for (let i = 0; i < order.length && kept.length > 1; i += 1) {
    kept = stonefishV4BestByCriterion(game, kept, order[i]);
  }
  return kept;
}

// OPENING KNOWLEDGE
// The book may choose only from the candidate set supplied by v3/v4.5.
// Production calls this after v4's first five filters, so book knowledge can
// genuinely influence the opening without bypassing tactical/material safety.
stonefishV45BookMove = function(game, profileIndex, allowedCandidates) {
  const side = game.turn();
  const history = stonefishV45HistoryUci(game);
  const key = profileIndex + ':' + side;
  let stateMap = STONEFISH_V45_BOOK_STATE.get(game);
  if (!stateMap) {
    stateMap = new Map();
    STONEFISH_V45_BOOK_STATE.set(game, stateMap);
  }

  const safe = allowedCandidates && allowedCandidates.length
    ? allowedCandidates
    : getStonefishV3BestRawMoves(game).slice();
  if (!safe.length) return null;

  const safeByUci = new Map();
  for (let i = 0; i < safe.length; i += 1) {
    safeByUci.set(stonefishV45RawUci(game, safe[i]), safe[i]);
  }

  const compatible = STONEFISH_V45_OPENINGS.filter(line => (
    line.side === side &&
    stonefishV45LineCompatible(line, history) &&
    line.moves.length > history.length &&
    safeByUci.has(line.moves[history.length])
  ));

  if (!compatible.length) {
    stateMap.delete(key);
    return null;
  }

  const state = stateMap.get(key);
  let selected = state ? compatible.find(line => line.id === state.lineId) : null;
  if (!selected) {
    selected = stonefishV45WeightedLine(compatible, profileIndex);
    if (!selected) return null;
    stateMap.set(key, { lineId:selected.id });
  }

  return safeByUci.get(selected.moves[history.length]) || null;
};

// FORCED-MATE PATTERN KNOWLEDGE
// Only named mating geometries contribute here. Generic checking / king-space
// bonuses are intentionally excluded so this layer does not hijack ordinary play.
function stonefishV45StrictPatternScore(game, raw) {
  if (game.fastIsMateMove(raw)) return 1000000;

  game.fastApply(raw);
  const ownSide = -game.side;
  const enemySide = game.side;
  let score = 0;

  score += stonefishV45LadderScore(game, ownSide, enemySide);
  score += stonefishV45TriangleScore(game, ownSide, enemySide);
  score += stonefishV45BackRankScore(game, ownSide, enemySide);
  score += stonefishV45SmotheredScore(game, ownSide, enemySide, raw);
  score += stonefishV45ArabianScore(game, ownSide, enemySide);
  score += stonefishV45BodenScore(game, ownSide, enemySide);

  // Queen + rook kill-box geometry.
  const freedom = stonefishV4KingFreedom(game, enemySide);
  if (
    game.in_check() &&
    freedom === 0 &&
    stonefishV45Pieces(game, ownSide, 5).length &&
    stonefishV45Pieces(game, ownSide, 4).length
  ) {
    score += 24;
  }

  game.fastUndo();
  return score;
}

function stonefishV45StrictPatternTieBreak(game, candidates) {
  if (candidates.length <= 1) return candidates;
  let best = 0;
  const scores = new Array(candidates.length);

  for (let i = 0; i < candidates.length; i += 1) {
    const score = stonefishV45StrictPatternScore(game, candidates[i]);
    scores[i] = score;
    if (score > best) best = score;
  }

  if (best <= 0) return candidates;
  return candidates.filter((_, i) => scores[i] === best);
}

// Build the non-book v4.5 candidate set. Inverse pressure enters immediately
// before v4's own mobility criterion; named mate patterns enter after pieceSupport.
function stonefishV45RefinedCandidates(game) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return candidates;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];

    // INVERSE KNOWLEDGE: first avoid allowing opponent checks, then minimise
    // opponent legal mobility. Only these two inverses survived tuning.
    if (criterion === 'mobility') {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppCheckRisk');
      if (candidates.length > 1) {
        candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
      }
    }

    candidates = stonefishV4BestByCriterion(game, candidates, criterion);

    if (criterion === 'pieceSupport' && candidates.length > 1) {
      candidates = stonefishV45StrictPatternTieBreak(game, candidates);
    }
  }

  return candidates;
}

stonefishV45BestRawMoves = function(game) {
  return stonefishV45RefinedCandidates(game);
};

getStonefishV45MoveWithProfile = function(game, profileIndex = 0) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return null;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];

    // OPENING KNOWLEDGE: after the five proven early safety/development filters,
    // allow a compatible weighted book line to choose among the surviving moves.
    if (criterion === 'mobility') {
      const book = stonefishV45BookMove(game, profileIndex, candidates);
      if (book) return stonefishV3PublicMove(game, book);

      // INVERSE KNOWLEDGE enters before our own mobility preference.
      candidates = stonefishV45BestByInverse(game, candidates, 'oppCheckRisk');
      if (candidates.length > 1) {
        candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
      }
    }

    candidates = stonefishV4BestByCriterion(game, candidates, criterion);

    // FORCED-MATE PATTERN KNOWLEDGE enters after piece support.
    if (criterion === 'pieceSupport' && candidates.length > 1) {
      candidates = stonefishV45StrictPatternTieBreak(game, candidates);
    }
  }

  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
};

getStonefishV45Move = function(game) {
  return getStonefishV45MoveWithProfile(game, 0);
};
