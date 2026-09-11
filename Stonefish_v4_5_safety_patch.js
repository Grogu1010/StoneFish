// Stonefish_v4.5 refinement layer.
// ONLY the three v4.5 additions are changed here:
// 1) weighted opening knowledge,
// 2) forced-mate pattern knowledge,
// 3) inverse positional tie-breakers.
//
// v3/v4 search depth and all v4 criteria remain unchanged.

function stonefishV45FilterByV4Order(game, candidates, order) {
  let kept = candidates.slice();
  for (let i = 0; i < order.length && kept.length > 1; i += 1) {
    kept = stonefishV4BestByCriterion(game, kept, order[i]);
  }
  return kept;
}

// Opening knowledge is allowed to select only among moves that survive the
// COMPLETE v4 chain. This preserves v4's proven safety while still letting the
// weighted 50-line repertoire decide genuine v4 ties.
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
    : stonefishV45FilterByV4Order(game, getStonefishV3BestRawMoves(game).slice(), STONEFISH_V4_ORDER);
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

function stonefishV45PatternTieBreak(game, candidates) {
  if (candidates.length <= 1) return candidates;
  let best = -Infinity;
  const scores = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i += 1) {
    const score = stonefishV45MatePatternScore(game, candidates[i]);
    scores[i] = score;
    if (score > best) best = score;
  }
  if (best <= 0) return candidates;
  return candidates.filter((_, i) => scores[i] === best);
}

function stonefishV45RefinedCandidates(game) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return candidates;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];
    candidates = stonefishV4BestByCriterion(game, candidates, criterion);

    // INVERSES: the only two inverse questions that improved the ablation tests.
    // They sit beside v4's own mobility rule and remain hard lexicographic filters.
    if (criterion === 'mobility' && candidates.length > 1) {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppCheckRisk');
      if (candidates.length > 1) {
        candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
      }
    }

    // FORCED-MATE PATTERNS: mate-net geometry enters only after piece support,
    // where it performed best without destabilising ordinary play.
    if (criterion === 'pieceSupport' && candidates.length > 1) {
      candidates = stonefishV45PatternTieBreak(game, candidates);
    }
  }

  return candidates;
}

stonefishV45BestRawMoves = function(game) {
  return stonefishV45RefinedCandidates(game);
};

getStonefishV45MoveWithProfile = function(game, profileIndex = 0) {
  let candidates = stonefishV45RefinedCandidates(game);
  if (!candidates.length) return null;

  // Opening weights only resolve genuine final v4.5 ties.
  const book = stonefishV45BookMove(game, profileIndex, candidates);
  if (book) return stonefishV3PublicMove(game, book);

  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
};

getStonefishV45Move = function(game) {
  return getStonefishV45MoveWithProfile(game, 0);
};
