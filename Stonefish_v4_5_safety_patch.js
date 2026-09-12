// Stonefish_v4.5 refinement layer.
// ONLY the three v4.5 additions are changed here:
// 1) weighted opening knowledge,
// 2) forced-mate pattern knowledge,
// 3) inverse positional tie-breakers.
// v3/v4 search depth and every v4 criterion remain unchanged.

const STONEFISH_V45_FULL_KNOWLEDGE_RATE = 0.60;
const STONEFISH_V45_RESTRAINED_BOOK_RATE = 0.40;
const STONEFISH_V45_CONFIDENCE_STATE = new WeakMap();

function stonefishV45FilterByV4Order(game, candidates, order) {
  let kept = candidates.slice();
  for (let i = 0; i < order.length && kept.length > 1; i += 1) {
    kept = stonefishV4BestByCriterion(game, kept, order[i]);
  }
  return kept;
}

function stonefishV45KnowledgeMode(game, profileIndex = 0) {
  let state = STONEFISH_V45_CONFIDENCE_STATE.get(game);
  if (!state) {
    state = new Map();
    STONEFISH_V45_CONFIDENCE_STATE.set(game, state);
  }
  const key = profileIndex + ':' + game.turn();
  let mode = state.get(key);
  if (!mode) {
    mode = Math.random() < STONEFISH_V45_FULL_KNOWLEDGE_RATE ? 'full' : 'restrained';
    state.set(key, mode);
  }
  return mode;
}

// OPENING KNOWLEDGE: weighted 50-line repertoire, restricted to candidates that
// have already survived v3 plus v4's early safety/development filters.
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
  for (let i = 0; i < safe.length; i += 1) safeByUci.set(stonefishV45RawUci(game, safe[i]), safe[i]);

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

// FORCED-MATE PATTERN KNOWLEDGE: only named mating geometries contribute.
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

  const freedom = stonefishV4KingFreedom(game, enemySide);
  if (game.in_check() && freedom === 0 && stonefishV45Pieces(game, ownSide, 5).length && stonefishV45Pieces(game, ownSide, 4).length) {
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

function stonefishV45RefinedCandidates(game, mode = 'full') {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return candidates;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];

    if (criterion === 'mobility') {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppCheckRisk');
      if (mode === 'full' && candidates.length > 1) {
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
  return stonefishV45RefinedCandidates(game, stonefishV45KnowledgeMode(game, 0));
};

getStonefishV45MoveWithProfile = function(game, profileIndex = 0) {
  const mode = stonefishV45KnowledgeMode(game, profileIndex);
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return null;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];

    if (criterion === 'mobility') {
      // Full mode always follows a compatible weighted line; restrained mode
      // follows it 40% of the time. Both remain inside the same opening feature.
      const useBook = mode === 'full' || Math.random() < STONEFISH_V45_RESTRAINED_BOOK_RATE;
      if (useBook) {
        const book = stonefishV45BookMove(game, profileIndex, candidates);
        if (book) return stonefishV3PublicMove(game, book);
      }

      // INVERSE KNOWLEDGE: both modes suppress opponent checks. Full mode also
      // minimises opponent mobility before v4 maximises our own mobility.
      candidates = stonefishV45BestByInverse(game, candidates, 'oppCheckRisk');
      if (mode === 'full' && candidates.length > 1) {
        candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
      }
    }

    candidates = stonefishV4BestByCriterion(game, candidates, criterion);

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
