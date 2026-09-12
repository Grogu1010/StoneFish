// Stonefish v5 Pro speed layer.
// Goal: retain a genuine five-ply selective search while keeping wall-clock
// think time at or below normal Stonefish v5.

const STONEFISH_V5_PRO_SPEED_CACHE_LIMIT = 40000;
const STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES = 2;
// depth index -> maximum moves searched. Root move is ply 1, so depth 4
// reaches plies 2-5. Every deep candidate still reaches the full five-ply horizon.
const STONEFISH_V5_PRO_SPEED_BRANCH = [0, 2, 2, 3, 5];
const STONEFISH_V5_PRO_MOBILITY_CACHE = new Map();
const STONEFISH_V5_PRO_PASSER_INFO_CACHE = new Map();
const STONEFISH_V5_PRO_PASSER_STATUS_CACHE = new Map();
const STONEFISH_V5_PRO_CONTEXT_CACHE = new Map();
const STONEFISH_V5_PRO_ADAPTIVE_CACHE = new Map();

function stonefishV5ProSpeedCacheSet(cache, key, value) {
  if (cache.size >= STONEFISH_V5_PRO_SPEED_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

const stonefishV5ProBaseFastMobility = Chess.prototype.fastMobility;
Chess.prototype.fastMobility = function(side) {
  const key = side + '|' + this.fastPositionKey();
  const cached = STONEFISH_V5_PRO_MOBILITY_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_MOBILITY_CACHE, key, stonefishV5ProBaseFastMobility.call(this, side));
};

if (!Chess.prototype.fastHasLegalMove) {
  Chess.prototype.fastHasLegalMove = function() {
    const pseudo = this._pseudoMoves();
    for (let i = 0; i < pseudo.length; i += 1) if (this._testLegalRaw(pseudo[i])) return true;
    return false;
  };
}

const stonefishV5ProBasePassedPawnInfo = stonefishV5PassedPawnInfo;
stonefishV5PassedPawnInfo = function(game, side) {
  const key = side + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_PASSER_INFO_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_PASSER_INFO_CACHE, key, stonefishV5ProBasePassedPawnInfo(game, side));
};

const stonefishV5ProBasePasserStatus = stonefishV5PasserStatus;
stonefishV5PasserStatus = function(game, pawnSide, perspective) {
  const key = pawnSide + '|' + perspective + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_PASSER_STATUS_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_PASSER_STATUS_CACHE, key, stonefishV5ProBasePasserStatus(game, pawnSide, perspective));
};

const stonefishV5ProBaseContexts = stonefishV5ProContexts;
stonefishV5ProContexts = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_CONTEXT_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_CONTEXT_CACHE, key, stonefishV5ProBaseContexts(game, perspective));
};

const stonefishV5ProBaseAdaptivePosition = stonefishV5ProAdaptivePosition;
stonefishV5ProAdaptivePosition = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_ADAPTIVE_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_ADAPTIVE_CACHE, key, stonefishV5ProBaseAdaptivePosition(game, perspective));
};

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
      const terminal = game.in_check() ? (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot) : 0;
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
    const terminal = !game.in_check() ? 0 : (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot);
    if (tt) tt.set(ttKey, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial() || visits >= 3) {
    if (tt) tt.set(ttKey, 0);
    return 0;
  }

  const width = STONEFISH_V5_PRO_SPEED_BRANCH[depth] || 2;
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
    if (beta <= alpha) { cutoff = true; break; }
  }
  if (tt && !cutoff) tt.set(ttKey, best);
  return best;
};

// v5 is the root scout: it already evaluates every legal move with the proven
// three-ply tactical/points system. Pro only spends its expensive +2 plies on
// the two moves v5 judges most serious, then applies Pro's adaptive knowledge.
stonefishV5ProScoreAllMoves = function(game) {
  const v5Scored = stonefishV5ScoreAllMoves(game);
  if (!v5Scored.length) return [];
  const perspective = game.side;
  const legal = v5Scored.map(entry => entry.raw);
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = v5Scored.map(entry => ({
    raw: entry.raw,
    tactical: entry.tactical,
    knowledge: entry.knowledge,
    preliminary: entry.score,
    deep: null,
    score: -Infinity
  }));

  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    const count = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, scored.length);
    for (let i = 0; i < count; i += 1) {
      const entry = scored[i];
      const proKnowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
        ? 0
        : stonefishV5ProRootKnowledge(game, entry.raw, heritageMove, bookMove, perspective, entry.tactical);
      entry.knowledge = proKnowledge;
      entry.preliminary = entry.tactical + proKnowledge;
      entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
      entry.score = Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9
        ? entry.deep
        : entry.deep * 1.35 + entry.preliminary * 0.38;
    }
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
