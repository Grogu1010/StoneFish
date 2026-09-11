// v4.5 safety rebuild: the three allowed knowledge layers may refine v4 ties,
// but they may never bypass the complete proven v4 lexicographic chain.

function stonefishV45FilterByV4Order(game, candidates, order) {
  let kept = candidates.slice();
  for (let i = 0; i < order.length && kept.length > 1; i += 1) {
    kept = stonefishV4BestByCriterion(game, kept, order[i]);
  }
  return kept;
}

function stonefishV45V4FinalCandidates(game) {
  const v3 = getStonefishV3BestRawMoves(game).slice();
  return stonefishV45FilterByV4Order(game, v3, STONEFISH_V4_ORDER);
}

// OPENINGS: a book move is eligible only if it is one of v4's FINAL tied moves.
// The weighted repertoire therefore breaks a v4 tie; it can never override v4.
stonefishV45BookMove = function(game, profileIndex, allowedCandidates) {
  const side = game.turn();
  const history = stonefishV45HistoryUci(game);
  const key = profileIndex + ':' + side;
  let stateMap = STONEFISH_V45_BOOK_STATE.get(game);
  if (!stateMap) {
    stateMap = new Map();
    STONEFISH_V45_BOOK_STATE.set(game, stateMap);
  }

  const safe = (allowedCandidates && allowedCandidates.length)
    ? allowedCandidates
    : stonefishV45V4FinalCandidates(game);
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
    stateMap.set(key, { lineId: selected.id });
  }
  return safeByUci.get(selected.moves[history.length]) || null;
};

// FORCED-MATE PATTERNS: pattern knowledge only breaks ties among final v4 moves.
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

// INVERSES: these are also only allowed to break final v4 ties.
function stonefishV45ApplyInverseOrder(game, candidates, inverseOrder = STONEFISH_V45_INVERSE_ORDER) {
  let kept = candidates.slice();
  for (let i = 0; i < inverseOrder.length && kept.length > 1; i += 1) {
    kept = stonefishV45BestByInverse(game, kept, inverseOrder[i]);
  }
  return kept;
}

stonefishV45BestRawMoves = function(game, inverseOrder = STONEFISH_V45_INVERSE_ORDER, usePatterns = true) {
  let candidates = stonefishV45V4FinalCandidates(game);
  if (!candidates.length) return candidates;
  candidates = stonefishV45ApplyInverseOrder(game, candidates, inverseOrder);
  if (usePatterns) candidates = stonefishV45PatternTieBreak(game, candidates);
  return candidates;
};

getStonefishV45MoveWithProfile = function(game, profileIndex = 0) {
  const finalV4 = stonefishV45V4FinalCandidates(game);
  if (!finalV4.length) return null;

  // v3/v4 already make mate-in-one dominant; preserve that property exactly.
  for (let i = 0; i < finalV4.length; i += 1) {
    if (game.fastIsMateMove(finalV4[i])) return stonefishV3PublicMove(game, finalV4[i]);
  }

  // Opening knowledge is now a tie-breaker among COMPLETE v4 survivors only.
  const book = stonefishV45BookMove(game, profileIndex, finalV4);
  if (book) return stonefishV3PublicMove(game, book);

  let candidates = stonefishV45ApplyInverseOrder(game, finalV4);
  candidates = stonefishV45PatternTieBreak(game, candidates);
  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
};
