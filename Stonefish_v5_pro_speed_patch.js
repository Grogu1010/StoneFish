// Stonefish v5 Pro speed/strength layer.
//
// Base: the proven fast candidate that scored 100-0-0 vs v5 at well under v5
// think time. This revision keeps that root architecture and only makes the
// selective beam smarter in danger positions.
//
// Improvements over the fast baseline:
// - passed-pawn captures and blockades are promoted inside move ordering,
// - the beam widens only when an advanced enemy passer is genuinely dangerous,
// - checked leaf positions receive one forced-evasion extension instead of a
//   static evaluation while still in check.

const STONEFISH_V5_PRO_SPEED_CACHE_LIMIT = 50000;
const STONEFISH_V5_PRO_SPEED_SEMIFINALISTS = 8;
const STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES = 4;
const STONEFISH_V5_PRO_SPEED_BRANCH = [0, 2, 3, 3, 5];
const STONEFISH_V5_PRO_HERITAGE_FLOOR = 0.82;
const STONEFISH_V5_PRO_POSITION_CACHE = new Map();
const STONEFISH_V5_PRO_CONTEXT_CACHE = new Map();
const STONEFISH_V5_PRO_ADAPTIVE_CACHE = new Map();

function stonefishV5ProSpeedCacheSet(cache, key, value) {
  if (cache.size >= STONEFISH_V5_PRO_SPEED_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function stonefishV5ProCachedPositionScore(game, perspective) {
  const key = perspective + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_POSITION_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_POSITION_CACHE,
    key,
    stonefishV5PositionScore(game, perspective)
  );
}

if (!Chess.prototype.fastHasLegalMove) {
  Chess.prototype.fastHasLegalMove = function() {
    const pseudo = this._pseudoMoves();
    for (let i = 0; i < pseudo.length; i += 1) if (this._testLegalRaw(pseudo[i])) return true;
    return false;
  };
}

const stonefishV5ProSpeedBaseContexts = stonefishV5ProContexts;
stonefishV5ProContexts = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_CONTEXT_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_CONTEXT_CACHE, key, stonefishV5ProSpeedBaseContexts(game, perspective));
};

const stonefishV5ProSpeedBaseAdaptive = stonefishV5ProAdaptivePosition;
stonefishV5ProAdaptivePosition = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_ADAPTIVE_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_ADAPTIVE_CACHE, key, stonefishV5ProSpeedBaseAdaptive(game, perspective));
};

stonefishV5ProLeaf = function(game, perspective) {
  let score = stonefishV5ProCachedPositionScore(game, perspective);
  const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
  const ourThreat = stonefishV5EnemyPasserThreat(game, -perspective);
  if (enemyThreat >= 2200) score -= enemyThreat * 1.35;
  else if (enemyThreat >= 900) score -= enemyThreat * 0.55;
  if (ourThreat >= 2200) score += ourThreat * 0.42;
  else if (ourThreat >= 900) score += ourThreat * 0.18;
  return score;
};

function stonefishV5ProSpeedMoveOrder(game, move) {
  let score = stonefishV5ProMoveOrder(game, move);
  const us = game.side;
  const enemy = -us;
  const passers = stonefishV5PassedPawnInfo(game, enemy);

  for (let i = 0; i < passers.length; i += 1) {
    const passer = passers[i];
    if (passer.distance > 3) continue;
    const danger = stonefishV5PasserDanger(passer.distance);
    const nextSq = passer.sq + enemy * 8;
    const promotionSq = (enemy === 1 ? 7 : 0) * 8 + passer.file;

    if (move.to === passer.sq && move.captured === 1) score += danger * 8;
    if (move.to === nextSq) score += danger * 4;
    if (move.to === promotionSq) score += danger * 6;
  }
  return score;
}

let STONEFISH_V5_PRO_ACTIVE_TT = null;
let STONEFISH_V5_PRO_LAST_SEARCH_STATS = null;

function stonefishV5ProTTKey(game, depth, perspective, plyFromRoot) {
  return perspective + '|' + depth + '|' + plyFromRoot + '|' + game.halfmove + '|' + game.fastPositionKey();
}

function stonefishV5ProCheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot) {
  const maximizing = game.side === perspective;
  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProSpeedMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
    .slice(0, Math.min(6, legal.length));
  let best = maximizing ? -Infinity : Infinity;

  for (const entry of ordered) {
    game.fastApply(entry.move);
    let value;
    if (!game.fastHasLegalMove()) {
      value = game.in_check()
        ? (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot + 1 : STONEFISH_V5_PRO_MATE - plyFromRoot - 1)
        : 0;
    } else {
      value = stonefishV5ProLeaf(game, perspective);
    }
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
  const tt = STONEFISH_V5_PRO_ACTIVE_TT;
  const key = tt ? stonefishV5ProTTKey(game, depth, perspective, plyFromRoot) : null;
  if (tt) {
    const hit = tt.get(key);
    if (hit !== undefined) {
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.ttHits += 1;
      return hit;
    }
  }
  if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.nodes += 1;

  if (depth <= 0) {
    if (game.in_check()) {
      const legal = game.fastMoves();
      if (!legal.length) {
        const terminal = game.side === perspective
          ? -STONEFISH_V5_PRO_MATE + plyFromRoot
          : STONEFISH_V5_PRO_MATE - plyFromRoot;
        if (tt) tt.set(key, terminal);
        return terminal;
      }
      const extended = stonefishV5ProCheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot);
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
      return extended;
    }
    if (!game.fastHasLegalMove()) {
      if (tt) tt.set(key, 0);
      return 0;
    }
    if (game.halfmove >= 100 || game._insufficientMaterial()) {
      if (tt) tt.set(key, 0);
      return 0;
    }
    const leaf = stonefishV5ProLeaf(game, perspective);
    if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
    if (tt) tt.set(key, leaf);
    return leaf;
  }

  const legal = game.fastMoves();
  if (!legal.length) {
    const terminal = !game.in_check()
      ? 0
      : (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot);
    if (tt) tt.set(key, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) {
    if (tt) tt.set(key, 0);
    return 0;
  }

  let width = STONEFISH_V5_PRO_SPEED_BRANCH[depth] || 2;
  const danger = stonefishV5EnemyPasserThreat(game, game.side);
  if (game.in_check()) width = Math.max(width, 6);
  else if (danger >= 2200) width += 2;
  else if (danger >= 900) width += 1;
  width = Math.min(width, legal.length);

  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProSpeedMoveOrder(game, move) }))
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

  if (tt && !cutoff) tt.set(key, best);
  return best;
};

function stonefishV5ProConversionUrgency(game, raw, perspective) {
  if (game.halfmove < 45) return 0;
  const lead = stonefishV5Material(game, perspective) - stonefishV5Material(game, -perspective);
  if (lead < 120) return 0;
  const reset = raw.piece === 1 || raw.captured;
  const urgency = Math.max(0, game.halfmove - 45);
  if (reset) return 1800 + urgency * 210;
  if (game.halfmove >= 70) return -urgency * 85;
  return 0;
}

function stonefishV5ProFastScoutScore(game, raw, bookMove, heritageMove, perspective) {
  let score = 0;
  const capture = STONEFISH_V5_PIECE[raw.captured] || 0;
  score += capture * 15 - (STONEFISH_V5_PIECE[raw.piece] || 0) * (raw.captured ? 0.15 : 0);
  if (raw.promotion) score += ((STONEFISH_V5_PIECE[raw.promotion] || 0) - 100) * 18 + 2400;
  if (raw.flags & (4 | 8)) score += 260;
  if (bookMove && stonefishV5SameMove(raw, bookMove)) score += 3600;
  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) score += 3000;
  score += stonefishV5ProConversionUrgency(game, raw, perspective);

  if (game.fastGivesCheck(raw)) {
    score += 900;
    if (game.fastIsMateMove(raw)) return STONEFISH_V5_PRO_MATE * 4;
  }

  game.fastApply(raw);
  const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
  if (enemyThreat >= 300) score -= enemyThreat * 9;
  else if (enemyThreat >= 120) score -= enemyThreat * 3;
  const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
  if (visits > 0) score -= visits * 240000;
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
    heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
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
    const heritageBoost = entry.heritageMatch ? STONEFISH_V5_WEIGHTS.heritage * 1.25 : 0;
    entry.preliminary = entry.tactical + entry.scout * 0.34 + heritageBoost
      + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
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
      entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
        ? 0
        : stonefishV5ProRootKnowledge(game, entry.raw, heritageMove, bookMove, perspective, entry.tactical);
      entry.preliminary = entry.tactical + entry.knowledge
        + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
      entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
      if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) {
        entry.score = entry.deep;
      } else {
        const selective = entry.deep * 1.28 + entry.preliminary * 0.46;
        const heritageFloor = entry.heritageMatch
          ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
          : -Infinity;
        entry.score = Math.max(selective, heritageFloor);
      }
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