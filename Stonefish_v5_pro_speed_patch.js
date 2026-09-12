// Stonefish v5 Pro speed layer.
// Goal: retain a genuine five-ply selective search while keeping wall-clock
// think time at or below normal Stonefish v5.
// IMPORTANT: all memoization here is Pro-local. Normal v5 is left untouched.

const STONEFISH_V5_PRO_SPEED_CACHE_LIMIT = 40000;
const STONEFISH_V5_PRO_SPEED_SEMIFINALISTS = 8;
const STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES = 4;
// Root move is ply 1. depth 4 therefore reaches plies 2-5.
const STONEFISH_V5_PRO_SPEED_BRANCH = [0, 2, 2, 2, 4];
const STONEFISH_V5_PRO_POSITION_CACHE = new Map();
const STONEFISH_V5_PRO_CONTEXT_CACHE = new Map();
const STONEFISH_V5_PRO_ADAPTIVE_CACHE = new Map();
const STONEFISH_V5_PRO_ORDER_CONTEXT_CACHE = new Map();

function stonefishV5ProSpeedCacheSet(cache, key, value) {
  if (cache.size >= STONEFISH_V5_PRO_SPEED_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function stonefishV5ProCachedPositionScore(game, perspective) {
  const key = perspective + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_POSITION_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_POSITION_CACHE, key, stonefishV5PositionScore(game, perspective));
}

if (!Chess.prototype.fastHasLegalMove) {
  Chess.prototype.fastHasLegalMove = function() {
    const pseudo = this._pseudoMoves();
    for (let i = 0; i < pseudo.length; i += 1) if (this._testLegalRaw(pseudo[i])) return true;
    return false;
  };
}

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

// Narrow search only works if quiet moves are ordered sensibly. Cache a tiny
// board context once per node so ordering can value development, king activity,
// passer pushes and emergency blockades without running a full evaluation.
function stonefishV5ProOrderContext(game) {
  const key = game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_ORDER_CONTEXT_CACHE.get(key);
  if (cached !== undefined) return cached;
  let nonPawn = 0;
  const enemyPawnBlocks = [];
  const us = game.side;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (!p) continue;
    const type = Math.abs(p);
    if (type >= 2 && type <= 5) nonPawn += STONEFISH_V5_PIECE[type] || 0;
    if (p === -us) {
      const rank = sq >> 3;
      const progress = -us === 1 ? rank : 7 - rank;
      const distance = 7 - progress;
      if (distance <= 3) {
        const blockSq = sq + (-us) * 8;
        if (blockSq >= 0 && blockSq < 64) enemyPawnBlocks.push({ blockSq, file: sq & 7, distance });
      }
    }
  }
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_ORDER_CONTEXT_CACHE, key, {
    endgame: stonefishV5ProClamp(1 - nonPawn / STONEFISH_V5_PRO_START_NONPAWN),
    enemyPawnBlocks
  });
}

const stonefishV5ProBaseMoveOrder = stonefishV5ProMoveOrder;
stonefishV5ProMoveOrder = function(game, move) {
  let score = stonefishV5ProBaseMoveOrder(game, move);
  const ctx = stonefishV5ProOrderContext(game);
  const side = game.side;
  const fromFile = move.from & 7, fromRank = move.from >> 3;
  const toFile = move.to & 7, toRank = move.to >> 3;
  const type = move.piece;

  // Emergency containment of a near-promotion enemy pawn belongs ahead of
  // ordinary quiet manoeuvres.
  for (let i = 0; i < ctx.enemyPawnBlocks.length; i += 1) {
    const threat = ctx.enemyPawnBlocks[i];
    if (move.to === threat.blockSq) score += threat.distance === 1 ? 2600 : threat.distance === 2 ? 1050 : 360;
    if ((type === 4 || type === 5) && toFile === threat.file) score += threat.distance === 1 ? 420 : 150;
  }

  if (type === 1) {
    const fromProgress = side === 1 ? fromRank : 7 - fromRank;
    const toProgress = side === 1 ? toRank : 7 - toRank;
    const advance = toProgress - fromProgress;
    score += advance * (55 + toProgress * 18);
    if (toProgress >= 5) score += (toProgress - 4) * 240;
  } else if (type === 2 || type === 3) {
    const fromCenter = Math.abs(fromFile - 3.5) + Math.abs(fromRank - 3.5);
    const toCenter = Math.abs(toFile - 3.5) + Math.abs(toRank - 3.5);
    score += (fromCenter - toCenter) * 36;
    const homeRank = side === 1 ? 0 : 7;
    if (fromRank === homeRank && toRank !== homeRank) score += 135;
  } else if (type === 6 && ctx.endgame > 0.45) {
    const fromCenter = Math.abs(fromFile - 3.5) + Math.abs(fromRank - 3.5);
    const toCenter = Math.abs(toFile - 3.5) + Math.abs(toRank - 3.5);
    score += (fromCenter - toCenter) * (65 + 90 * ctx.endgame);
  }

  if (move.flags & (4 | 8)) score += 140;
  return score;
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

function stonefishV5ProFastScoutScore(game, raw, bookMove, heritageMove, perspective) {
  let score = 0;
  const capture = STONEFISH_V5_PIECE[raw.captured] || 0;
  score += capture * 14;
  if (raw.promotion) score += ((STONEFISH_V5_PIECE[raw.promotion] || 0) - 100) * 16 + 1800;
  if (raw.flags & (4 | 8)) score += 260;
  if (bookMove && stonefishV5SameMove(raw, bookMove)) score += 3200;
  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) score += STONEFISH_V5_WEIGHTS.heritage;

  const givesCheck = game.fastGivesCheck(raw);
  if (givesCheck) {
    score += 720;
    if (game.fastIsMateMove(raw)) return STONEFISH_V5_PRO_MATE * 4;
  }

  game.fastApply(raw);
  score += stonefishV5ProCachedPositionScore(game, perspective) * 0.72;
  const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
  if (enemyThreat >= 300) score -= enemyThreat * 8;
  else if (enemyThreat >= 120) score -= enemyThreat * 3;
  const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
  if (visits > 0) score -= visits * 180000;
  game.fastUndo();
  return score;
}

stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const heritageMove = stonefishV5HeritageMove(game);

  const scored = legal.map(raw => ({
    raw,
    tactical: null,
    knowledge: 0,
    scout: stonefishV5ProFastScoutScore(game, raw, bookMove, heritageMove, perspective),
    preliminary: -Infinity,
    deep: null,
    score: -Infinity
  }));

  scored.sort((a, b) => {
    if (Math.abs(b.scout - a.scout) > 1e-9) return b.scout - a.scout;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  const semifinalCount = Math.min(STONEFISH_V5_PRO_SPEED_SEMIFINALISTS, scored.length);
  for (let i = 0; i < semifinalCount; i += 1) {
    const entry = scored[i];
    entry.tactical = stonefishV5TacticalScore(game, entry.raw);
    const heritageBoost = heritageMove && stonefishV5SameMove(entry.raw, heritageMove)
      ? STONEFISH_V5_WEIGHTS.heritage
      : 0;
    entry.preliminary = entry.tactical + entry.scout * 0.32 + heritageBoost;
  }
  for (let i = semifinalCount; i < scored.length; i += 1) scored[i].preliminary = -Infinity;

  scored.sort((a, b) => {
    if (Math.abs(b.preliminary - a.preliminary) > 1e-9) return b.preliminary - a.preliminary;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    const finalistCount = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, semifinalCount);
    for (let i = 0; i < finalistCount; i += 1) {
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
