// Stonefish_v5 — unified weighted evaluation + search architecture.
//
// v4/v4.5 are lexicographic engines: v3 first narrows the move set, then each
// positional rule eliminates moves one criterion at a time. v5 is deliberately
// different. Every legal root move receives one numeric score made from tactical
// search, material, development, king safety, mobility, board control, opening
// knowledge, mate-pattern knowledge, draw pressure, and the inverse ideas that
// made v5(testunit1) stronger than balanced v4.5.
//
// The v5(testunit1) lesson retained here is important: opponent checking chances
// and opponent mobility matter from move one. In v5 they are weighted signals,
// not hard tie-break filters.

const STONEFISH_V5_MATE = 10000000;
const STONEFISH_V5_PIECE = [0, 100, 320, 335, 510, 930, 0];
const STONEFISH_V5_EVAL_CACHE = new Map();
const STONEFISH_V5_EVAL_CACHE_LIMIT = 60000;

const STONEFISH_V5_WEIGHTS = {
  material: 1,
  mobility: 5,
  development: 11,
  center: 7,
  minorCentral: 5,
  kingProtection: 9,
  kingFreedom: 3,
  pawnStructure: 8,
  rookActivity: 6,
  kingPlacement: 8,
  boardControl: 2,
  hanging: 42,
  bishopPair: 18,
  passedPawn: 10,
  tempo: 6,

  // Root-move knowledge / intent points.
  v3SafetyBand: 120,
  book: 95,
  castle: 35,
  check: 18,
  promotion: 80,
  matePattern: 6,
  oppCheckRisk: 24,
  oppMobility: 3,
  repetition: 150,
  repetitionAhead: 420,
  fiftyReset: 45,
  fullPosition: 0.40
};

function stonefishV5TrimEvalCache() {
  while (STONEFISH_V5_EVAL_CACHE.size > STONEFISH_V5_EVAL_CACHE_LIMIT) {
    STONEFISH_V5_EVAL_CACHE.delete(STONEFISH_V5_EVAL_CACHE.keys().next().value);
  }
}

function stonefishV5SameMove(a, b) {
  return !!a && !!b && a.from === b.from && a.to === b.to && (a.promotion || 0) === (b.promotion || 0);
}

function stonefishV5Material(game, side) {
  let total = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (p && (p > 0 ? 1 : -1) === side) total += STONEFISH_V5_PIECE[Math.abs(p)] || 0;
  }
  return total;
}

function stonefishV5BishopPair(game, side) {
  let bishops = 0;
  for (let sq = 0; sq < 64; sq += 1) if (game.boardState[sq] === side * 3) bishops += 1;
  return bishops >= 2 ? 1 : 0;
}

function stonefishV5PassedPawnScore(game, side) {
  const b = game.boardState;
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    if (b[sq] !== side) continue;
    const file = sq & 7;
    const rank = sq >> 3;
    let passed = true;
    const fromRank = side === 1 ? rank + 1 : rank - 1;
    const end = side === 1 ? 8 : -1;
    for (let r = fromRank; r !== end && passed; r += side) {
      for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f += 1) {
        if (b[r * 8 + f] === -side) { passed = false; break; }
      }
    }
    if (passed) {
      const progress = side === 1 ? rank - 1 : 6 - rank;
      score += Math.max(0, progress);
    }
  }
  return score;
}

// Full scorecard evaluation. This is deliberately rich and is applied to every
// legal ROOT move. Search leaves use a cheaper tactical evaluator so v5 can look
// deeper without repeatedly recalculating every positional feature.
function stonefishV5FullEval(game, perspective) {
  const key = 'F|' + perspective + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_EVAL_CACHE.get(key);
  if (cached !== undefined) return cached;

  const enemy = -perspective;
  let score = 0;
  score += (stonefishV5Material(game, perspective) - stonefishV5Material(game, enemy)) * STONEFISH_V5_WEIGHTS.material;
  score += (game.fastMobility(perspective) - game.fastMobility(enemy)) * STONEFISH_V5_WEIGHTS.mobility;
  score += (stonefishV4Development(game, perspective) - stonefishV4Development(game, enemy)) * STONEFISH_V5_WEIGHTS.development;
  score += (stonefishV4CenterControl(game, perspective) - stonefishV4CenterControl(game, enemy)) * STONEFISH_V5_WEIGHTS.center;
  score += (stonefishV4MinorCentralization(game, perspective) - stonefishV4MinorCentralization(game, enemy)) * STONEFISH_V5_WEIGHTS.minorCentral;
  score += (stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, enemy)) * STONEFISH_V5_WEIGHTS.kingProtection;
  score += (stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, enemy)) * STONEFISH_V5_WEIGHTS.kingFreedom;
  score += (stonefishV4PawnStructure(game, perspective) - stonefishV4PawnStructure(game, enemy)) * STONEFISH_V5_WEIGHTS.pawnStructure;
  score += (stonefishV4RookActivity(game, perspective) - stonefishV4RookActivity(game, enemy)) * STONEFISH_V5_WEIGHTS.rookActivity;
  score += (stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, enemy)) * STONEFISH_V5_WEIGHTS.kingPlacement;
  score += (stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, enemy)) * STONEFISH_V5_WEIGHTS.boardControl;
  score += (stonefishV4HangingMax(game, perspective) - stonefishV4HangingMax(game, enemy)) * STONEFISH_V5_WEIGHTS.hanging;
  score += (stonefishV5BishopPair(game, perspective) - stonefishV5BishopPair(game, enemy)) * STONEFISH_V5_WEIGHTS.bishopPair;
  score += (stonefishV5PassedPawnScore(game, perspective) - stonefishV5PassedPawnScore(game, enemy)) * STONEFISH_V5_WEIGHTS.passedPawn;
  score += (game.side === perspective ? 1 : -1) * STONEFISH_V5_WEIGHTS.tempo;

  stonefishV5TrimEvalCache();
  STONEFISH_V5_EVAL_CACHE.set(key, score);
  return score;
}

function stonefishV5SearchEval(game, perspective) {
  const key = 'S|' + perspective + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_EVAL_CACHE.get(key);
  if (cached !== undefined) return cached;

  const enemy = -perspective;
  let score = stonefishV5Material(game, perspective) - stonefishV5Material(game, enemy);

  // Cheap piece-square activity. Search is mainly tactical, but these terms keep
  // equal-material branches from drifting into obviously passive positions.
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (!p) continue;
    const side = p > 0 ? 1 : -1;
    const sign = side === perspective ? 1 : -1;
    const type = Math.abs(p);
    const file = sq & 7;
    const rank = sq >> 3;
    const centerDistance = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
    if (type === 2 || type === 3) score += sign * (7 - centerDistance) * 3;
    if (type === 1) {
      const progress = side === 1 ? rank - 1 : 6 - rank;
      score += sign * Math.max(0, progress) * 4;
    }
  }

  score += (stonefishV4CenterControl(game, perspective) - stonefishV4CenterControl(game, enemy)) * 4;
  score += (stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, enemy)) * 6;
  score += (stonefishV4HangingMax(game, perspective) - stonefishV4HangingMax(game, enemy)) * 34;

  stonefishV5TrimEvalCache();
  STONEFISH_V5_EVAL_CACHE.set(key, score);
  return score;
}

function stonefishV5TerminalScore(game, perspective, plyFromRoot) {
  const legal = game.fastMoves();
  if (!legal.length) {
    if (game.in_check()) return game.side === perspective ? -STONEFISH_V5_MATE + plyFromRoot : STONEFISH_V5_MATE - plyFromRoot;
    return 0;
  }
  if (game.halfmove >= 100) return 0;
  return null;
}

function stonefishV5MoveOrderScore(game, raw) {
  let score = (STONEFISH_V5_PIECE[raw.captured] || 0) * 8 - (STONEFISH_V5_PIECE[raw.piece] || 0);
  if (raw.promotion) score += (STONEFISH_V5_PIECE[raw.promotion] || 0) + 700;
  if (raw.flags & (4 | 8)) score += 90;
  if (game.fastGivesCheck(raw)) score += 160;
  return score;
}

function stonefishV5OrderedMoves(game, moves) {
  return moves.slice().sort((a, b) => stonefishV5MoveOrderScore(game, b) - stonefishV5MoveOrderScore(game, a));
}

function stonefishV5Quiescence(game, alpha, beta, perspective, depth, plyFromRoot) {
  const legal = game.fastMoves();
  if (!legal.length) {
    if (game.in_check()) return game.side === perspective ? -STONEFISH_V5_MATE + plyFromRoot : STONEFISH_V5_MATE - plyFromRoot;
    return 0;
  }
  if (game.halfmove >= 100) return 0;

  const maximizing = game.side === perspective;
  const stand = stonefishV5SearchEval(game, perspective);
  if (depth <= 0) return stand;

  if (maximizing) {
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
  } else {
    if (stand <= alpha) return stand;
    if (stand < beta) beta = stand;
  }

  const inCheck = game.in_check();
  let tactical = inCheck ? legal : legal.filter(m => m.captured || m.promotion || game.fastGivesCheck(m));
  tactical = stonefishV5OrderedMoves(game, tactical).slice(0, inCheck ? 10 : 6);
  if (!tactical.length) return stand;

  let best = maximizing ? -Infinity : Infinity;
  for (let i = 0; i < tactical.length; i += 1) {
    game.fastApply(tactical[i]);
    const value = stonefishV5Quiescence(game, alpha, beta, perspective, depth - 1, plyFromRoot + 1);
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

function stonefishV5Search(game, depth, alpha, beta, perspective, plyFromRoot) {
  const legal = game.fastMoves();
  if (!legal.length) {
    if (game.in_check()) return game.side === perspective ? -STONEFISH_V5_MATE + plyFromRoot : STONEFISH_V5_MATE - plyFromRoot;
    return 0;
  }
  if (game.halfmove >= 100) return 0;
  if (depth <= 0) return stonefishV5Quiescence(game, alpha, beta, perspective, 1, plyFromRoot);

  const maximizing = game.side === perspective;
  const moves = stonefishV5OrderedMoves(game, legal);
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < moves.length; i += 1) {
    game.fastApply(moves[i]);
    const value = stonefishV5Search(game, depth - 1, alpha, beta, perspective, plyFromRoot + 1);
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

function stonefishV5SearchDepth(game, legalCount) {
  const totalMaterial = stonefishV5Material(game, 1) + stonefishV5Material(game, -1);
  // depth is counted after the root move: 3-ply in crowded positions, 4-ply
  // once the tree thins, and 5-ply in reduced endgames.
  if (totalMaterial <= 1800 && legalCount <= 16) return 4;
  if (game.fullmove >= 12 && legalCount <= 26) return 3;
  return 2;
}

function stonefishV5RootKnowledgePoints(game, raw, bookMove, v3BestSet, perspective) {
  let points = 0;
  const uci = stonefishV45RawUci(game, raw);
  if (v3BestSet.has(uci)) points += STONEFISH_V5_WEIGHTS.v3SafetyBand;
  if (bookMove && stonefishV5SameMove(raw, bookMove)) points += STONEFISH_V5_WEIGHTS.book;
  if (raw.flags & (4 | 8)) points += STONEFISH_V5_WEIGHTS.castle;
  if (raw.promotion) points += (STONEFISH_V5_PIECE[raw.promotion] || 0) * 0.15 + STONEFISH_V5_WEIGHTS.promotion;
  if (game.fastGivesCheck(raw)) points += STONEFISH_V5_WEIGHTS.check;

  // The most useful testunit1 inheritance: suppress opponent checks and mobility
  // immediately, but as points rather than hard elimination filters.
  points += stonefishV45InverseScore(game, raw, 'oppCheckRisk') * STONEFISH_V5_WEIGHTS.oppCheckRisk;
  points += stonefishV45InverseScore(game, raw, 'oppMobility') * STONEFISH_V5_WEIGHTS.oppMobility;
  points += stonefishV45StrictPatternScore(game, raw) * STONEFISH_V5_WEIGHTS.matePattern;

  game.fastApply(raw);
  const ownSide = -game.side;
  const enemySide = game.side;
  points += stonefishV5FullEval(game, perspective) * STONEFISH_V5_WEIGHTS.fullPosition;

  const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
  const lead = stonefishV5Material(game, ownSide) - stonefishV5Material(game, enemySide);
  if (visits > 0) {
    points -= visits * STONEFISH_V5_WEIGHTS.repetition;
    if (lead >= 200) points -= STONEFISH_V5_WEIGHTS.repetitionAhead;
  }
  if (game.halfmove >= 60 && (raw.piece === 1 || raw.captured)) points += STONEFISH_V5_WEIGHTS.fiftyReset;
  game.fastUndo();
  return points;
}

function stonefishV5ScoreAllMoves(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const depth = stonefishV5SearchDepth(game, legal.length);

  // v3 is no longer a gate. Its best tactical band is just one useful signal.
  const v3Best = getStonefishV3BestRawMoves(game);
  const v3BestSet = new Set(v3Best.map(m => stonefishV45RawUci(game, m)));

  // Opening knowledge is also a score contribution, never an unconditional move.
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  for (let i = 0; i < legal.length; i += 1) {
    const raw = legal[i];
    const knowledge = stonefishV5RootKnowledgePoints(game, raw, bookMove, v3BestSet, perspective);
    game.fastApply(raw);
    const terminal = stonefishV5TerminalScore(game, perspective, 1);
    const search = terminal !== null ? terminal : stonefishV5Search(game, depth, -Infinity, Infinity, perspective, 1);
    game.fastUndo();
    scored.push({ raw, score: search + knowledge, search, knowledge });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw);
    const bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
}

function getStonefishV5Move(game) {
  const scored = stonefishV5ScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}
