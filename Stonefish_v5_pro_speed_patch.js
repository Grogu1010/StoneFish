// Stonefish v5 Pro performance layer.
// The five-ply search horizon, root shortlist, branch widths, move ordering,
// scoring, and tie-breaking stay unchanged. This file only removes repeated work.

const STONEFISH_V5_PRO_SPEED_CACHE_LIMIT = 60000;
const STONEFISH_V5_PRO_MOBILITY_CACHE = new Map();
const STONEFISH_V5_PRO_PASSER_INFO_CACHE = new Map();
const STONEFISH_V5_PRO_PASSER_STATUS_CACHE = new Map();
const STONEFISH_V5_PRO_CONTEXT_CACHE = new Map();
const STONEFISH_V5_PRO_ADAPTIVE_CACHE = new Map();

function stonefishV5ProSpeedCacheSet(cache, key, value) {
  if (cache.size >= STONEFISH_V5_PRO_SPEED_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

// fastMobility is called repeatedly by both v5 and v5 Pro evaluation. The
// result is pure for a board/castling state and requested side, so memoize it.
const stonefishV5ProBaseFastMobility = Chess.prototype.fastMobility;
Chess.prototype.fastMobility = function(side) {
  const key = side + '|' + this.fastPositionKey();
  const cached = STONEFISH_V5_PRO_MOBILITY_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_MOBILITY_CACHE,
    key,
    stonefishV5ProBaseFastMobility.call(this, side)
  );
};

// At a search leaf we only need to know whether at least one legal move exists.
// Avoid allocating and validating the entire legal-move array in normal positions.
if (!Chess.prototype.fastHasLegalMove) {
  Chess.prototype.fastHasLegalMove = function() {
    const pseudo = this._pseudoMoves();
    for (let i = 0; i < pseudo.length; i += 1) {
      if (this._testLegalRaw(pseudo[i])) return true;
    }
    return false;
  };
}

// Passed-pawn geometry is consulted by several independent v5/v5 Pro scoring
// systems. Cache the immutable descriptors for the current position.
const stonefishV5ProBasePassedPawnInfo = stonefishV5PassedPawnInfo;
stonefishV5PassedPawnInfo = function(game, side) {
  const key = side + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_PASSER_INFO_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_PASSER_INFO_CACHE,
    key,
    stonefishV5ProBasePassedPawnInfo(game, side)
  );
};

const stonefishV5ProBasePasserStatus = stonefishV5PasserStatus;
stonefishV5PasserStatus = function(game, pawnSide, perspective) {
  const key = pawnSide + '|' + perspective + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_PASSER_STATUS_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_PASSER_STATUS_CACHE,
    key,
    stonefishV5ProBasePasserStatus(game, pawnSide, perspective)
  );
};

// Root knowledge asks for contexts and then adaptive evaluation asks for those
// same contexts again. Cache them exactly, including fullmove because opening
// weighting depends on it.
const stonefishV5ProBaseContexts = stonefishV5ProContexts;
stonefishV5ProContexts = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_CONTEXT_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_CONTEXT_CACHE,
    key,
    stonefishV5ProBaseContexts(game, perspective)
  );
};

// Full adaptive leaf evaluation is also pure for a position/fullmove/perspective.
// Transpositions therefore reuse the exact same score rather than re-running all
// geometry, coordination, mobility, and passer calculations.
const stonefishV5ProBaseAdaptivePosition = stonefishV5ProAdaptivePosition;
stonefishV5ProAdaptivePosition = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_ADAPTIVE_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_ADAPTIVE_CACHE,
    key,
    stonefishV5ProBaseAdaptivePosition(game, perspective)
  );
};

// The caller already performs terminal/draw checks, so do not duplicate the
// insufficient-material scan at every leaf.
stonefishV5ProLeaf = function(game, perspective) {
  return stonefishV5ProAdaptivePosition(game, perspective);
};

function stonefishV5ProTTKey(game, depth, perspective, plyFromRoot, positionKey, visits) {
  return perspective + '|' + depth + '|' + plyFromRoot + '|' + game.fullmove + '|' + game.halfmove + '|' + visits + '|' + positionKey;
}

let STONEFISH_V5_PRO_ACTIVE_TT = null;
let STONEFISH_V5_PRO_LAST_SEARCH_STATS = null;

stonefishV5ProMinimax = function(game, depth, perspective, alpha, beta, plyFromRoot) {
  const positionKey = game.fastPositionKey();
  const visits = game.positionCounts.get(positionKey) || 0;
  const tt = STONEFISH_V5_PRO_ACTIVE_TT;
  const ttKey = tt ? stonefishV5ProTTKey(game, depth, perspective, plyFromRoot, positionKey, visits) : null;

  if (tt) {
    const hit = tt.get(ttKey);
    if (hit !== undefined) {
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.ttHits += 1;
      return hit;
    }
  }

  if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.nodes += 1;

  if (depth <= 0) {
    if (!game.fastHasLegalMove()) {
      const terminal = game.in_check()
        ? (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot)
        : 0;
      if (tt) tt.set(ttKey, terminal);
      return terminal;
    }
    if (game.halfmove >= 100 || game._insufficientMaterial() || visits >= 3) {
      if (tt) tt.set(ttKey, 0);
      return 0;
    }
    const leaf = stonefishV5ProLeaf(game, perspective);
    if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
    if (tt) tt.set(ttKey, leaf);
    return leaf;
  }

  const legal = game.fastMoves();
  if (!legal.length) {
    const terminal = !game.in_check()
      ? 0
      : (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot);
    if (tt) tt.set(ttKey, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial() || visits >= 3) {
    if (tt) tt.set(ttKey, 0);
    return 0;
  }

  const width = STONEFISH_V5_PRO_BRANCH[depth] || 8;
  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
    .slice(0, width);

  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;

  for (const entry of ordered) {
    game.fastApply(entry.move);
    const value = stonefishV5ProMinimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
    game.fastUndo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) {
      cutoff = true;
      break;
    }
  }

  // Cache only fully searched nodes. This deliberately avoids bound-table
  // complexity and guarantees the memoized value is exact.
  if (tt && !cutoff) tt.set(ttKey, best);
  return best;
};

const stonefishV5ProBaseScoreAllMoves = stonefishV5ProScoreAllMoves;
stonefishV5ProScoreAllMoves = function(game) {
  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    return stonefishV5ProBaseScoreAllMoves(game);
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }
};
