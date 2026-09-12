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
