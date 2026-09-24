// Stonefish_v5_pro.js
// Stonefish_v5 Pro — adaptive points + threat awareness + two extra searched plies.
//
// v5 Pro keeps v5's unified points architecture, then adds:
// - blended context-sensitive weights (opening, attack, defence, conversion, endgame, pawn race),
// - threat geometry (pins/skewers, loose pieces, overloaded defenders, king-zone pressure),
// - initiative, coordination, counterplay suppression, conversion and pawn-race intelligence,
// - confidence-aware scoring and dynamic heritage trust,
// - a selective five-ply alpha-beta search: exactly two plies beyond v5's three-ply tactical horizon.
//
// Search results come from normal legal play only. No benchmark-specific result logic lives here.

const STONEFISH_V5_PRO_MATE = STONEFISH_V5_MATE * 2;
const STONEFISH_V5_PRO_ROOT_CANDIDATES = 8;
const STONEFISH_V5_PRO_BRANCH = [0, 8, 8, 10, 12];
const STONEFISH_V5_PRO_DIRS_BISHOP = [[1,1],[1,-1],[-1,1],[-1,-1]];
const STONEFISH_V5_PRO_DIRS_ROOK = [[1,0],[-1,0],[0,1],[0,-1]];
const STONEFISH_V5_PRO_KNIGHT = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const STONEFISH_V5_PRO_START_NONPAWN = 6520;

function stonefishV5ProClamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }

function stonefishV5ProNonPawnMaterial(game) {
  let total = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const type = Math.abs(game.boardState[sq]);
    if (type >= 2 && type <= 5) total += STONEFISH_V5_PIECE[type] || 0;
  }
  return total;
}

function stonefishV5ProAttackCount(game, sq, side) {
  const b = game.boardState;
  const file = sq & 7;
  const rank = sq >> 3;
  let count = 0;

  const pawnRank = rank - side;
  if (pawnRank >= 0 && pawnRank < 8) {
    if (file > 0 && b[pawnRank * 8 + file - 1] === side) count += 1;
    if (file < 7 && b[pawnRank * 8 + file + 1] === side) count += 1;
  }

  for (const [df, dr] of STONEFISH_V5_PRO_KNIGHT) {
    const f = file + df, r = rank + dr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8 && b[r * 8 + f] === side * 2) count += 1;
  }

  for (const [df, dr] of STONEFISH_V5_PRO_DIRS_BISHOP) {
    let f = file + df, r = rank + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const p = b[r * 8 + f];
      if (p) {
        if (p === side * 3 || p === side * 5) count += 1;
        break;
      }
      f += df; r += dr;
    }
  }

  for (const [df, dr] of STONEFISH_V5_PRO_DIRS_ROOK) {
    let f = file + df, r = rank + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const p = b[r * 8 + f];
      if (p) {
        if (p === side * 4 || p === side * 5) count += 1;
        break;
      }
      f += df; r += dr;
    }
  }

  for (const [df, dr] of STONEFISH_V5_PRO_DIRS_BISHOP.concat(STONEFISH_V5_PRO_DIRS_ROOK)) {
    const f = file + df, r = rank + dr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8 && b[r * 8 + f] === side * 6) count += 1;
  }
  return count;
}

function stonefishV5ProKingZonePressure(game, attacker) {
  const kingSq = game.kingSq[-attacker];
  const kf = kingSq & 7, kr = kingSq >> 3;
  let pressure = 0;
  for (let df = -1; df <= 1; df += 1) for (let dr = -1; dr <= 1; dr += 1) {
    const f = kf + df, r = kr + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    const sq = r * 8 + f;
    pressure += stonefishV5ProAttackCount(game, sq, attacker);
  }
  return pressure;
}

function stonefishV5ProLooseAndCoordination(game, perspective) {
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (!p || Math.abs(p) === 6) continue;
    const side = p > 0 ? 1 : -1;
    const value = STONEFISH_V5_PIECE[Math.abs(p)] || 0;
    const attackers = stonefishV5ProAttackCount(game, sq, -side);
    const defenders = stonefishV5ProAttackCount(game, sq, side);
    let pieceScore = defenders > 0 ? Math.min(40, 8 + defenders * 6) : 0;
    if (attackers > 0) {
      if (defenders === 0) pieceScore -= value * 0.22;
      else if (attackers > defenders) pieceScore -= value * 0.11 * Math.min(2, attackers - defenders);
      else pieceScore -= value * 0.025;
    }
    score += side === perspective ? pieceScore : -pieceScore;
  }
  return score;
}

function stonefishV5ProRayTacticsForSide(game, side) {
  const b = game.boardState;
  let score = 0;
  for (let from = 0; from < 64; from += 1) {
    const p = b[from];
    if (!p || (p > 0 ? 1 : -1) !== side) continue;
    const type = Math.abs(p);
    if (type !== 3 && type !== 4 && type !== 5) continue;
    const dirs = type === 3 ? STONEFISH_V5_PRO_DIRS_BISHOP : type === 4 ? STONEFISH_V5_PRO_DIRS_ROOK : STONEFISH_V5_PRO_DIRS_BISHOP.concat(STONEFISH_V5_PRO_DIRS_ROOK);
    const ff = from & 7, fr = from >> 3;
    for (const [df, dr] of dirs) {
      let f = ff + df, r = fr + dr;
      let firstEnemy = null;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const sq = r * 8 + f;
        const q = b[sq];
        if (!q) { f += df; r += dr; continue; }
        const qSide = q > 0 ? 1 : -1;
        if (qSide === side) break;
        if (firstEnemy === null) {
          firstEnemy = Math.abs(q);
          f += df; r += dr;
          continue;
        }
        const secondType = Math.abs(q);
        const firstValue = STONEFISH_V5_PIECE[firstEnemy] || 0;
        const secondValue = STONEFISH_V5_PIECE[secondType] || STONEFISH_V5_PRO_MATE;
        if (secondType === 6 || secondValue > firstValue) score += Math.min(220, 35 + firstValue * 0.24);
        break;
      }
    }
  }
  return score;
}

function stonefishV5ProRayTactics(game, perspective) {
  return stonefishV5ProRayTacticsForSide(game, perspective) - stonefishV5ProRayTacticsForSide(game, -perspective);
}

function stonefishV5ProNearestPasserDistance(game, side) {
  let best = 8;
  for (const passer of stonefishV5PassedPawnInfo(game, side)) best = Math.min(best, passer.distance);
  return best;
}

function stonefishV5ProContexts(game, perspective) {
  const phase = stonefishV5ProClamp(stonefishV5ProNonPawnMaterial(game) / STONEFISH_V5_PRO_START_NONPAWN);
  const endgame = 1 - phase;
  const opening = phase * stonefishV5ProClamp((18 - game.fullmove) / 18);
  const lead = stonefishV5Material(game, perspective) - stonefishV5Material(game, -perspective);
  const attackPressure = stonefishV5ProKingZonePressure(game, perspective);
  const defencePressure = stonefishV5ProKingZonePressure(game, -perspective);
  const attack = stonefishV5ProClamp(attackPressure / 9);
  const defence = stonefishV5ProClamp(defencePressure / 9);
  const conversion = stonefishV5ProClamp((lead - 120) / 650);
  const ourPasser = stonefishV5ProNearestPasserDistance(game, perspective);
  const theirPasser = stonefishV5ProNearestPasserDistance(game, -perspective);
  const pawnRace = ourPasser <= 3 && theirPasser <= 3 ? 1 : (ourPasser <= 2 || theirPasser <= 2 ? 0.65 : 0);
  return { phase, endgame, opening, attack, defence, conversion, pawnRace, lead, attackPressure, defencePressure };
}

function stonefishV5ProAdaptivePosition(game, perspective) {
  const c = stonefishV5ProContexts(game, perspective);
  let score = stonefishV5PositionScore(game, perspective);

  const mobility = game.fastMobility(perspective) - game.fastMobility(-perspective);
  const development = stonefishV4Development(game, perspective) - stonefishV4Development(game, -perspective);
  const kingProtection = stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, -perspective);
  const kingFreedom = stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, -perspective);
  const kingPlacement = stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, -perspective);
  const boardControl = stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, -perspective);
  const passers = stonefishV5PassedPawns(game, perspective) - stonefishV5PassedPawns(game, -perspective);

  score += mobility * (2 + c.attack * 2.5 + c.defence * 1.5);
  score += development * (9 * c.opening);
  score += kingProtection * (5 + 18 * c.defence + 8 * c.attack);
  score += kingFreedom * (3 + 10 * c.endgame);
  score += kingPlacement * (5 + 17 * c.endgame);
  score += boardControl * (1.5 + 4 * c.attack);
  score += passers * (18 + 45 * c.endgame + 65 * c.pawnRace);
  score += stonefishV5ProLooseAndCoordination(game, perspective) * (1.0 + 0.35 * c.defence);
  score += stonefishV5ProRayTactics(game, perspective) * (1.0 + 0.55 * c.attack);
  score += (c.attackPressure - c.defencePressure) * (24 + 22 * c.attack + 18 * c.defence);

  // In winning positions, value clean simplification and suppression of counterplay.
  if (c.conversion > 0) {
    const enemyMobility = game.fastMobility(-perspective);
    score -= enemyMobility * 2.5 * c.conversion;
    score += (stonefishV5Material(game, perspective) - stonefishV5Material(game, -perspective)) * 0.18 * c.conversion;
  }
  return score;
}

function stonefishV5ProCounterplay(game, perspective) {
  const enemy = game.side;
  const moves = game.fastMoves();
  let checks = 0, promotions = 0, heavyCaptures = 0, forcing = 0;
  for (const move of moves) {
    if (move.promotion) promotions += 1;
    if ((STONEFISH_V5_PIECE[move.captured] || 0) >= 320) heavyCaptures += 1;
    if (game.fastGivesCheck(move)) checks += 1;
    if (move.captured || move.promotion) forcing += 1;
  }
  const enemyPasser = stonefishV5ProNearestPasserDistance(game, enemy);
  const passerDanger = enemyPasser <= 1 ? 1100 : enemyPasser === 2 ? 420 : enemyPasser === 3 ? 150 : 0;
  return checks * 95 + promotions * 620 + heavyCaptures * 75 + forcing * 7 + moves.length * 2 + passerDanger;
}

function stonefishV5ProRootKnowledge(game, raw, heritageMove, bookMove, perspective, tactical) {
  // Reuse all of v5's proven knowledge except its fixed heritage vote; Pro adds a context-sensitive one below.
  let points = stonefishV5RootKnowledge(game, raw, null, bookMove, perspective);
  const heritageMatch = heritageMove && stonefishV5SameMove(raw, heritageMove);

  game.fastApply(raw);
  const c = stonefishV5ProContexts(game, perspective);
  const adaptive = stonefishV5ProAdaptivePosition(game, perspective);
  const counterplay = stonefishV5ProCounterplay(game, perspective);
  const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
  const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
  game.fastUndo();

  points += adaptive * 0.72;
  points -= counterplay * (0.72 + c.defence * 0.65 + c.conversion * 0.45);

  if (heritageMatch) {
    const threatScale = enemyThreat >= 300 ? 0.04 : enemyThreat >= 120 ? 0.18 : enemyThreat >= 35 ? 0.48 : 1;
    const noveltyScale = 0.32 + c.phase * 0.68;
    points += STONEFISH_V5_WEIGHTS.heritage * threatScale * noveltyScale;
  }

  // Confidence: reward independent systems agreeing; distrust a pretty positional move when tactics disagree.
  let agreement = 0;
  if (tactical > 25) agreement += 1;
  if (adaptive > 80) agreement += 1;
  if (heritageMatch) agreement += 1;
  if (game.fastGivesCheck(raw) || raw.captured || raw.promotion) agreement += 1;
  if (agreement >= 3) points += 120 + agreement * 25;
  else if (tactical < -120 && adaptive > 120) points -= 160;

  if (visits > 0 && c.lead > 100) points -= 220000;
  if (c.conversion > 0 && raw.captured) points += (STONEFISH_V5_PIECE[raw.captured] || 0) * (0.35 + 0.45 * c.conversion);
  return points;
}

function stonefishV5ProMoveOrder(game, move) {
  let score = (STONEFISH_V5_PIECE[move.captured] || 0) * 16 - (STONEFISH_V5_PIECE[move.piece] || 0);
  if (move.promotion) score += (STONEFISH_V5_PIECE[move.promotion] || 0) * 9;
  if (game.fastGivesCheck(move)) score += 1800;
  if (move.flags & (4 | 8)) score += 80;
  return score;
}

function stonefishV5ProLeaf(game, perspective) {
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  return stonefishV5ProAdaptivePosition(game, perspective);
}

function stonefishV5ProMinimax(game, depth, perspective, alpha, beta, plyFromRoot) {
  const legal = game.fastMoves();
  if (!legal.length) {
    if (!game.in_check()) return 0;
    return game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return 0;
  if (depth <= 0) return stonefishV5ProLeaf(game, perspective);

  legal.sort((a, b) => stonefishV5ProMoveOrder(game, b) - stonefishV5ProMoveOrder(game, a));
  const width = STONEFISH_V5_PRO_BRANCH[depth] || 8;
  const moves = legal.slice(0, width);
  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    game.fastApply(move);
    const value = stonefishV5ProMinimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
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

function stonefishV5ProFivePlyScore(game, raw, perspective) {
  if (game.fastIsMateMove(raw)) return STONEFISH_V5_PRO_MATE;
  game.fastApply(raw); // ply 1
  const value = stonefishV5ProMinimax(game, 4, perspective, -STONEFISH_V5_PRO_MATE, STONEFISH_V5_PRO_MATE, 1); // plies 2-5
  game.fastUndo();
  return value;
}

function stonefishV5ProScoreAllMoves(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  for (const raw of legal) {
    const tactical = stonefishV5TacticalScore(game, raw);
    const knowledge = Math.abs(tactical) >= STONEFISH_V5_MATE * 1.5 ? 0 : stonefishV5ProRootKnowledge(game, raw, heritageMove, bookMove, perspective, tactical);
    const preliminary = tactical + knowledge;
    scored.push({ raw, tactical, knowledge, preliminary, deep: null, score: preliminary });
  }

  scored.sort((a, b) => b.preliminary - a.preliminary || stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw)));
  const candidates = scored.slice(0, Math.min(STONEFISH_V5_PRO_ROOT_CANDIDATES, scored.length));

  for (const entry of candidates) {
    entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
    if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) entry.score = entry.deep;
    else entry.score = entry.deep * 1.35 + entry.preliminary * 0.38;
  }

  // A non-searched move cannot leapfrog the searched shortlist just because its shallow score uses a different scale.
  for (let i = candidates.length; i < scored.length; i += 1) scored[i].score = -Infinity;

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
}

function getStonefishV5ProMove(game) {
  const scored = stonefishV5ProScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

// Stonefish_v5_pro_speed_patch.js
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

// Stonefish_v5_pro_geometry_patch.js
// Experimental Pro-aware root prepass for v5 Pro.
//
// The failed fast scout was discarding strong quiet released-Pro moves before
// they reached deep search. Instead, rank EVERY legal move with Pro root
// knowledge first (without the expensive three-ply tactical calculation), then
// spend tactical work on only the best root candidates. The final deep blend
// matches released Pro in ordinary positions and uses bounded confidence
// adjustments when strong root evidence sharply contradicts a negative narrow
// deep score. These adjustments add no search nodes.

const STONEFISH_V5_PRO_ROOT_PREPASS = 10;
const STONEFISH_V5_PRO_CONFIDENCE_ROOT = 900;
const STONEFISH_V5_PRO_CONFIDENCE_DEEP = -250;
const STONEFISH_V5_PRO_CONFIDENCE_DEEP_WEIGHT = 1.20;
const STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_ROOT = 1000;
const STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_BONUS = 30;

function stonefishV5ProConfidenceDeepWeight(entry) {
  if (entry.preliminary >= STONEFISH_V5_PRO_CONFIDENCE_ROOT
      && entry.deep <= STONEFISH_V5_PRO_CONFIDENCE_DEEP) {
    return STONEFISH_V5_PRO_CONFIDENCE_DEEP_WEIGHT;
  }
  return 1.35;
}

function stonefishV5ProHeritageConfidenceBonus(entry) {
  if (entry.heritageMatch
      && entry.preliminary >= STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_ROOT
      && entry.deep <= STONEFISH_V5_PRO_CONFIDENCE_DEEP) {
    return STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_BONUS;
  }
  return 0;
}

stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  // Quiet-move-aware first pass: no three-ply tactical search yet.
  for (const raw of legal) {
    const knowledge = stonefishV5ProRootKnowledge(
      game, raw, heritageMove, bookMove, perspective, 0
    );
    scored.push({
      raw,
      tactical: null,
      knowledge,
      scout: knowledge,
      heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
      preliminary: knowledge,
      deep: null,
      score: -Infinity
    });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.knowledge - a.knowledge) > 1e-9) return b.knowledge - a.knowledge;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  const semifinalCount = Math.min(STONEFISH_V5_PRO_ROOT_PREPASS, scored.length);
  for (let i = 0; i < semifinalCount; i += 1) {
    const entry = scored[i];
    entry.tactical = stonefishV5TacticalScore(game, entry.raw);
    // Recompute knowledge with the real tactical signal so confidence logic is
    // identical to released Pro for the moves that survive the prepass.
    entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(
          game, entry.raw, heritageMove, bookMove, perspective, entry.tactical
        );
    entry.preliminary = entry.tactical + entry.knowledge;
  }
  for (let i = semifinalCount; i < scored.length; i += 1) {
    scored[i].preliminary = -Infinity;
  }

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
      entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
      if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) {
        entry.score = entry.deep;
      } else {
        const deepWeight = stonefishV5ProConfidenceDeepWeight(entry);
        entry.score = entry.deep * deepWeight + entry.preliminary * 0.38
          + stonefishV5ProHeritageConfidenceBonus(entry);
      }
    }
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }

  for (let i = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, semifinalCount); i < scored.length; i += 1) {
    scored[i].score = -Infinity;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
