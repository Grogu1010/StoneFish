// Stonefish v5 Pro performance layer — semantics-preserving only.
//
// This file MUST NOT change the released Pro model. The root shortlist (8),
// branch widths, five-ply horizon, leaf evaluator, knowledge weights, move
// ordering and tie-breaking are identical to released v5 Pro. Optimizations
// below only remove duplicate calculations and cache pure results.

const STONEFISH_V5_PRO_SPEED_CACHE_LIMIT = 70000;
const STONEFISH_V5_PRO_MOBILITY_CACHE = new Map();
const STONEFISH_V5_PRO_PASSER_INFO_CACHE = new Map();
const STONEFISH_V5_PRO_PASSER_STATUS_CACHE = new Map();
const STONEFISH_V5_PRO_ATTACK_CACHE = new Map();
const STONEFISH_V5_PRO_CONTEXT_CACHE = new Map();
const STONEFISH_V5_PRO_BUNDLE_CACHE = new Map();

function stonefishV5ProSpeedCacheSet(cache, key, value) {
  if (cache.size >= STONEFISH_V5_PRO_SPEED_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

// fastPositionKey is requested repeatedly while a position is unchanged.
// Cache the exact string; invalidate only when make/undo changes the board.
const stonefishV5ProBasePositionKey = Chess.prototype.fastPositionKey;
Chess.prototype.fastPositionKey = function() {
  if (this._stonefishCachedPositionKey !== undefined && this._stonefishCachedPositionKey !== null) {
    return this._stonefishCachedPositionKey;
  }
  const key = stonefishV5ProBasePositionKey.call(this);
  this._stonefishCachedPositionKey = key;
  return key;
};

const stonefishV5ProBaseApplyRaw = Chess.prototype._applyRaw;
Chess.prototype._applyRaw = function(move, trackRepetition) {
  this._stonefishCachedPositionKey = null;
  return stonefishV5ProBaseApplyRaw.call(this, move, trackRepetition);
};

const stonefishV5ProBaseUndoRaw = Chess.prototype._undoRaw;
Chess.prototype._undoRaw = function() {
  this._stonefishCachedPositionKey = null;
  return stonefishV5ProBaseUndoRaw.call(this);
};

// Mobility is pure for a board and requested side. This is one of the hottest
// repeated operations in both v5's base score and Pro's adaptive score.
const stonefishV5ProBaseFastMobility = Chess.prototype.fastMobility;
Chess.prototype.fastMobility = function(side) {
  const key = side + '|' + this.fastPositionKey();
  const hit = STONEFISH_V5_PRO_MOBILITY_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_MOBILITY_CACHE,
    key,
    stonefishV5ProBaseFastMobility.call(this, side)
  );
};

// At depth zero released Pro generated every legal move only to ask whether at
// least one existed. Early-exit legal detection gives the same terminal answer.
if (!Chess.prototype.fastHasLegalMove) {
  Chess.prototype.fastHasLegalMove = function() {
    const pseudo = this._pseudoMoves();
    for (let i = 0; i < pseudo.length; i += 1) {
      if (this._testLegalRaw(pseudo[i])) return true;
    }
    return false;
  };
}

const stonefishV5ProBasePassedPawnInfo = stonefishV5PassedPawnInfo;
stonefishV5PassedPawnInfo = function(game, side) {
  const key = side + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_PASSER_INFO_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_PASSER_INFO_CACHE,
    key,
    stonefishV5ProBasePassedPawnInfo(game, side)
  );
};

const stonefishV5ProBasePasserStatus = stonefishV5PasserStatus;
stonefishV5PasserStatus = function(game, pawnSide, perspective) {
  const key = pawnSide + '|' + perspective + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_PASSER_STATUS_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_PASSER_STATUS_CACHE,
    key,
    stonefishV5ProBasePasserStatus(game, pawnSide, perspective)
  );
};

// Attack-count queries repeat heavily between king-zone pressure and loose-piece
// coordination. Cache their exact integer result for the current position.
const stonefishV5ProBaseAttackCount = stonefishV5ProAttackCount;
stonefishV5ProAttackCount = function(game, sq, side) {
  const key = side + '|' + sq + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_ATTACK_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_ATTACK_CACHE,
    key,
    stonefishV5ProBaseAttackCount(game, sq, side)
  );
};

const stonefishV5ProBaseContexts = stonefishV5ProContexts;
stonefishV5ProContexts = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_CONTEXT_CACHE.get(key);
  if (hit !== undefined) return hit;
  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_CONTEXT_CACHE,
    key,
    stonefishV5ProBaseContexts(game, perspective)
  );
};

// Compute the released v5 position score and Pro adaptive score together so the
// shared positional terms are evaluated once rather than twice. Algebra and
// weights are identical to Stonefish_v5.js + Stonefish_v5_pro.js.
function stonefishV5ProEvalBundle(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_BUNDLE_CACHE.get(key);
  if (hit !== undefined) return hit;

  const enemy = -perspective;
  const c = stonefishV5ProContexts(game, perspective);

  const ourMaterial = stonefishV5Material(game, perspective);
  const enemyMaterial = stonefishV5Material(game, enemy);
  const material = ourMaterial - enemyMaterial;

  const ourMobility = game.fastMobility(perspective);
  const enemyMobility = game.fastMobility(enemy);
  const mobility = ourMobility - enemyMobility;
  const development = stonefishV4Development(game, perspective) - stonefishV4Development(game, enemy);
  const center = stonefishV4CenterControl(game, perspective) - stonefishV4CenterControl(game, enemy);
  const minorCentral = stonefishV4MinorCentralization(game, perspective) - stonefishV4MinorCentralization(game, enemy);
  const kingProtection = stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, enemy);
  const kingFreedom = stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, enemy);
  const pawnStructure = stonefishV4PawnStructure(game, perspective) - stonefishV4PawnStructure(game, enemy);
  const rookActivity = stonefishV4RookActivity(game, perspective) - stonefishV4RookActivity(game, enemy);
  const kingPlacement = stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, enemy);
  const boardControl = stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, enemy);
  const hanging = stonefishV4HangingMax(game, perspective) - stonefishV4HangingMax(game, enemy);
  const bishopPair = stonefishV5BishopPair(game, perspective) - stonefishV5BishopPair(game, enemy);
  const passers = stonefishV5PassedPawns(game, perspective) - stonefishV5PassedPawns(game, enemy);

  let position = material;
  position += mobility * STONEFISH_V5_WEIGHTS.mobility;
  position += development * STONEFISH_V5_WEIGHTS.development;
  position += center * STONEFISH_V5_WEIGHTS.center;
  position += minorCentral * STONEFISH_V5_WEIGHTS.minorCentral;
  position += kingProtection * STONEFISH_V5_WEIGHTS.kingProtection;
  position += kingFreedom * STONEFISH_V5_WEIGHTS.kingFreedom;
  position += pawnStructure * STONEFISH_V5_WEIGHTS.pawnStructure;
  position += rookActivity * STONEFISH_V5_WEIGHTS.rookActivity;
  position += kingPlacement * STONEFISH_V5_WEIGHTS.kingPlacement;
  position += boardControl * STONEFISH_V5_WEIGHTS.boardControl;
  position += hanging * STONEFISH_V5_WEIGHTS.hanging;
  position += bishopPair * STONEFISH_V5_WEIGHTS.bishopPair;
  position += passers * STONEFISH_V5_WEIGHTS.passedPawn;
  position += stonefishV5PasserStatus(game, perspective, perspective);
  position += stonefishV5PasserStatus(game, enemy, perspective);

  let adaptive = position;
  adaptive += mobility * (2 + c.attack * 2.5 + c.defence * 1.5);
  adaptive += development * (9 * c.opening);
  adaptive += kingProtection * (5 + 18 * c.defence + 8 * c.attack);
  adaptive += kingFreedom * (3 + 10 * c.endgame);
  adaptive += kingPlacement * (5 + 17 * c.endgame);
  adaptive += boardControl * (1.5 + 4 * c.attack);
  adaptive += passers * (18 + 45 * c.endgame + 65 * c.pawnRace);
  adaptive += stonefishV5ProLooseAndCoordination(game, perspective) * (1.0 + 0.35 * c.defence);
  adaptive += stonefishV5ProRayTactics(game, perspective) * (1.0 + 0.55 * c.attack);
  adaptive += (c.attackPressure - c.defencePressure) * (24 + 22 * c.attack + 18 * c.defence);

  if (c.conversion > 0) {
    adaptive -= enemyMobility * 2.5 * c.conversion;
    adaptive += material * 0.18 * c.conversion;
  }

  return stonefishV5ProSpeedCacheSet(
    STONEFISH_V5_PRO_BUNDLE_CACHE,
    key,
    { position, adaptive, contexts: c }
  );
}

stonefishV5ProAdaptivePosition = function(game, perspective) {
  return stonefishV5ProEvalBundle(game, perspective).adaptive;
};

// Same released root knowledge, but root apply/undo and repeated evaluation are
// fused into one pass. The numerical terms and order of decision signals remain
// unchanged.
stonefishV5ProRootKnowledge = function(game, raw, heritageMove, bookMove, perspective, tactical) {
  let points = 0;
  const heritageMatch = heritageMove && stonefishV5SameMove(raw, heritageMove);
  const givesCheck = game.fastGivesCheck(raw);

  if (bookMove && stonefishV5SameMove(raw, bookMove)) points += STONEFISH_V5_WEIGHTS.book;
  if (raw.flags & (4 | 8)) points += STONEFISH_V5_WEIGHTS.castle;
  if (raw.promotion) points += STONEFISH_V5_WEIGHTS.promotion;
  if (givesCheck) points += STONEFISH_V5_WEIGHTS.check;
  points += stonefishV45InverseScore(game, raw, 'oppCheckRisk') * STONEFISH_V5_WEIGHTS.oppCheckRisk;
  points += stonefishV45InverseScore(game, raw, 'oppMobility') * STONEFISH_V5_WEIGHTS.oppMobility;
  points += stonefishV45StrictPatternScore(game, raw) * STONEFISH_V5_WEIGHTS.matePattern;

  game.fastApply(raw);
  const bundle = stonefishV5ProEvalBundle(game, perspective);
  const c = bundle.contexts;
  const adaptive = bundle.adaptive;
  const counterplay = stonefishV5ProCounterplay(game, perspective);
  const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
  const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
  const ownSide = -game.side;
  const enemySide = game.side;
  const lead = stonefishV5Material(game, ownSide) - stonefishV5Material(game, enemySide);

  points += bundle.position * STONEFISH_V5_WEIGHTS.positional;
  if (visits > 0) {
    points -= visits * STONEFISH_V5_WEIGHTS.repetition;
    if (lead >= 200) points -= STONEFISH_V5_WEIGHTS.repetitionAhead;
  }
  if (game.halfmove >= 60 && (raw.piece === 1 || raw.captured)) points += STONEFISH_V5_WEIGHTS.fiftyReset;
  game.fastUndo();

  points += adaptive * 0.72;
  points -= counterplay * (0.72 + c.defence * 0.65 + c.conversion * 0.45);

  if (heritageMatch) {
    const threatScale = enemyThreat >= 300 ? 0.04 : enemyThreat >= 120 ? 0.18 : enemyThreat >= 35 ? 0.48 : 1;
    const noveltyScale = 0.32 + c.phase * 0.68;
    points += STONEFISH_V5_WEIGHTS.heritage * threatScale * noveltyScale;
  }

  let agreement = 0;
  if (tactical > 25) agreement += 1;
  if (adaptive > 80) agreement += 1;
  if (heritageMatch) agreement += 1;
  if (givesCheck || raw.captured || raw.promotion) agreement += 1;
  if (agreement >= 3) points += 120 + agreement * 25;
  else if (tactical < -120 && adaptive > 120) points -= 160;

  if (visits > 0 && c.lead > 100) points -= 220000;
  if (c.conversion > 0 && raw.captured) {
    points += (STONEFISH_V5_PIECE[raw.captured] || 0) * (0.35 + 0.45 * c.conversion);
  }
  return points;
};

// Released five-ply alpha-beta, preserving exact branch widths and move order.
// Only the depth-zero terminal test and sort bookkeeping are cheaper.
stonefishV5ProMinimax = function(game, depth, perspective, alpha, beta, plyFromRoot) {
  if (depth <= 0) {
    if (!game.fastHasLegalMove()) {
      if (!game.in_check()) return 0;
      return game.side === perspective
        ? -STONEFISH_V5_PRO_MATE + plyFromRoot
        : STONEFISH_V5_PRO_MATE - plyFromRoot;
    }
    if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
    if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return 0;
    return stonefishV5ProLeaf(game, perspective);
  }

  const legal = game.fastMoves();
  if (!legal.length) {
    if (!game.in_check()) return 0;
    return game.side === perspective
      ? -STONEFISH_V5_PRO_MATE + plyFromRoot
      : STONEFISH_V5_PRO_MATE - plyFromRoot;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return 0;

  const width = STONEFISH_V5_PRO_BRANCH[depth] || 8;
  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
    .slice(0, width);

  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;

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
    if (beta <= alpha) break;
  }
  return best;
};
