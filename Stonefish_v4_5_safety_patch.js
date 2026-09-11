// v4.5 safety rebuild: knowledge can refine v4, never bypass its proven safety chain.

const STONEFISH_V45_BOOK_GATE_ORDER = [
  'promotion',
  'castleNow',
  'openingDevelop',
  'hangingMax',
  'repetitionLeadGuard',
  'mobility'
];

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

// Override the opening selector so a book line is eligible only when its next move
// survives v4's critical safety/development/mobility filters.
stonefishV45BookMove = function(game, profileIndex) {
  const side = game.turn();
  const history = stonefishV45HistoryUci(game);
  const key = profileIndex + ':' + side;
  let stateMap = STONEFISH_V45_BOOK_STATE.get(game);
  if (!stateMap) {
    stateMap = new Map();
    STONEFISH_V45_BOOK_STATE.set(game, stateMap);
  }

  let safe = getStonefishV3BestRawMoves(game).slice();
  safe = stonefishV45FilterByV4Order(game, safe, STONEFISH_V45_BOOK_GATE_ORDER);
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

// Mate-pattern knowledge may only choose among moves accepted by the complete v4 chain.
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

stonefishV45BestRawMoves = function(game) {
  let candidates = stonefishV45V4FinalCandidates(game);
  if (!candidates.length) return candidates;

  // Inverses are strictly tie-breakers AFTER v4 has finished, so they cannot
  // override any v4 preference.
  for (let i = 0; i < STONEFISH_V45_INVERSE_ORDER.length && candidates.length > 1; i += 1) {
    candidates = stonefishV45BestByInverse(game, candidates, STONEFISH_V45_INVERSE_ORDER[i]);
  }

  candidates = stonefishV45PatternTieBreak(game, candidates);
  return candidates;
};

getStonefishV45MoveWithProfile = function(game, profileIndex = 0) {
  const v3 = getStonefishV3BestRawMoves(game).slice();
  if (!v3.length) return null;

  // v3 already guarantees mate-in-one candidates dominate all non-mating moves.
  for (let i = 0; i < v3.length; i += 1) {
    if (game.fastIsMateMove(v3[i])) return stonefishV3PublicMove(game, v3[i]);
  }

  const book = stonefishV45BookMove(game, profileIndex);
  if (book) return stonefishV3PublicMove(game, book);

  const candidates = stonefishV45BestRawMoves(game);
  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
};
