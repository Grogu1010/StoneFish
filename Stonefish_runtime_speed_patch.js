// StoneFish shared runtime speed layer.
//
// Goal: reduce repeated work without changing search depth, candidate widths,
// scoring weights, move ordering, or model decisions.
//
// This layer is deliberately model-agnostic. It memoizes only deterministic
// board facts (legal moves, checks, mate-in-one tests, static position features)
// and caches the exact position-key string while a board is unchanged.

const STONEFISH_RUNTIME_CACHE_LIMIT = 75000;
const STONEFISH_RUNTIME_FAST_MOVES_CACHE = new Map();
const STONEFISH_RUNTIME_CHECK_CACHE = new Map();
const STONEFISH_RUNTIME_MATE_CACHE = new Map();
const STONEFISH_RUNTIME_IN_CHECK_CACHE = new Map();
const STONEFISH_RUNTIME_INSUFFICIENT_CACHE = new Map();
const STONEFISH_RUNTIME_FEATURE_CACHE = new Map();

function stonefishRuntimeCacheSet(cache, key, value, limit = STONEFISH_RUNTIME_CACHE_LIMIT) {
  if (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function stonefishRuntimeMoveCode(move) {
  const raw = move && move._raw ? move._raw : move;
  return raw.from
    | (raw.to << 6)
    | ((raw.promotion || 0) << 12)
    | ((raw.flags || 0) << 15);
}

// fastPositionKey() is called many times on an unchanged board by v3-v5 Pro.
// Keep the exact original string; only avoid rebuilding it until make/undo.
const stonefishRuntimeBasePositionKey = Chess.prototype.fastPositionKey;
Chess.prototype.fastPositionKey = function() {
  if (this._stonefishRuntimePositionKey !== undefined && this._stonefishRuntimePositionKey !== null) {
    return this._stonefishRuntimePositionKey;
  }
  const key = stonefishRuntimeBasePositionKey.call(this);
  this._stonefishRuntimePositionKey = key;
  return key;
};

const stonefishRuntimeBaseReset = Chess.prototype.reset;
Chess.prototype.reset = function() {
  this._stonefishRuntimePositionKey = null;
  return stonefishRuntimeBaseReset.call(this);
};

const stonefishRuntimeBaseApplyRaw = Chess.prototype._applyRaw;
Chess.prototype._applyRaw = function(move, trackRepetition) {
  this._stonefishRuntimePositionKey = null;
  return stonefishRuntimeBaseApplyRaw.call(this, move, trackRepetition);
};

const stonefishRuntimeBaseUndoRaw = Chess.prototype._undoRaw;
Chess.prototype._undoRaw = function() {
  this._stonefishRuntimePositionKey = null;
  const move = stonefishRuntimeBaseUndoRaw.call(this);
  this._stonefishRuntimePositionKey = null;
  return move;
};

// Legal move generation is deterministic for board + side + castling + ep.
// Return a fresh array because callers sort/filter it; raw move records are
// immutable throughout StoneFish search, so sharing those records is safe.
const stonefishRuntimeBaseFastMoves = Chess.prototype.fastMoves;
Chess.prototype.fastMoves = function() {
  const key = this.fastPositionKey();
  const cached = STONEFISH_RUNTIME_FAST_MOVES_CACHE.get(key);
  if (cached !== undefined) return cached.slice();

  const legal = stonefishRuntimeBaseFastMoves.call(this);
  stonefishRuntimeCacheSet(STONEFISH_RUNTIME_FAST_MOVES_CACHE, key, legal.slice());
  return legal;
};

// Several callers only need to know whether at least one legal move exists.
// Stop on the first legal move instead of building the complete legal list.
Chess.prototype.fastHasLegalMove = function() {
  const key = this.fastPositionKey();
  const cached = STONEFISH_RUNTIME_FAST_MOVES_CACHE.get(key);
  if (cached !== undefined) return cached.length > 0;

  const pseudo = this._pseudoMoves();
  for (let i = 0; i < pseudo.length; i += 1) {
    if (this._testLegalRaw(pseudo[i])) return true;
  }

  stonefishRuntimeCacheSet(STONEFISH_RUNTIME_FAST_MOVES_CACHE, key, []);
  return false;
};

// fastMobility temporarily changes side/ep without make/undo. Preserve the
// parent's cached key explicitly so fastMoves() sees the temporary position.
Chess.prototype.fastMobility = function(side) {
  const oldSide = this.side;
  const oldEp = this.ep;
  const oldKey = this._stonefishRuntimePositionKey;
  this.side = side;
  this.ep = -1;
  this._stonefishRuntimePositionKey = null;
  const count = this.fastMoves().length;
  this.side = oldSide;
  this.ep = oldEp;
  this._stonefishRuntimePositionKey = oldKey === undefined ? null : oldKey;
  return count;
};

// Check/mate probes are repeated heavily by tactical scoring and move ordering.
const stonefishRuntimeBaseGivesCheck = Chess.prototype.fastGivesCheck;
Chess.prototype.fastGivesCheck = function(move) {
  const raw = move && move._raw ? move._raw : move;
  const key = this.fastPositionKey() + '|' + stonefishRuntimeMoveCode(raw);
  const cached = STONEFISH_RUNTIME_CHECK_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishRuntimeCacheSet(
    STONEFISH_RUNTIME_CHECK_CACHE,
    key,
    stonefishRuntimeBaseGivesCheck.call(this, raw)
  );
};

Chess.prototype.fastIsMateMove = function(move) {
  const raw = move && move._raw ? move._raw : move;
  const parentKey = this.fastPositionKey();
  const key = parentKey + '|' + stonefishRuntimeMoveCode(raw);
  const cached = STONEFISH_RUNTIME_MATE_CACHE.get(key);
  if (cached !== undefined) return cached;

  if (!this.fastGivesCheck(raw)) {
    return stonefishRuntimeCacheSet(STONEFISH_RUNTIME_MATE_CACHE, key, false);
  }

  this.fastApply(raw);
  const mate = !this.fastHasLegalMove();
  this.fastUndo();
  return stonefishRuntimeCacheSet(STONEFISH_RUNTIME_MATE_CACHE, key, mate);
};

const stonefishRuntimeBaseInCheck = Chess.prototype.in_check;
Chess.prototype.in_check = function() {
  const key = this.fastPositionKey();
  const cached = STONEFISH_RUNTIME_IN_CHECK_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishRuntimeCacheSet(
    STONEFISH_RUNTIME_IN_CHECK_CACHE,
    key,
    stonefishRuntimeBaseInCheck.call(this)
  );
};

const stonefishRuntimeBaseInsufficient = Chess.prototype._insufficientMaterial;
Chess.prototype._insufficientMaterial = function() {
  const key = this.fastPositionKey();
  const cached = STONEFISH_RUNTIME_INSUFFICIENT_CACHE.get(key);
  if (cached !== undefined) return cached;
  return stonefishRuntimeCacheSet(
    STONEFISH_RUNTIME_INSUFFICIENT_CACHE,
    key,
    stonefishRuntimeBaseInsufficient.call(this)
  );
};

function stonefishRuntimeMemoPositionSide(name, fn) {
  return function(game, side) {
    const key = name + '|' + side + '|' + game.fastPositionKey();
    const cached = STONEFISH_RUNTIME_FEATURE_CACHE.get(key);
    if (cached !== undefined) return cached;
    return stonefishRuntimeCacheSet(STONEFISH_RUNTIME_FEATURE_CACHE, key, fn(game, side));
  };
}

function stonefishRuntimeMemoPositionPerspective(name, fn) {
  return function(game, perspective) {
    const key = name + '|' + perspective + '|' + game.fastPositionKey();
    const cached = STONEFISH_RUNTIME_FEATURE_CACHE.get(key);
    if (cached !== undefined) return cached;
    return stonefishRuntimeCacheSet(STONEFISH_RUNTIME_FEATURE_CACHE, key, fn(game, perspective));
  };
}

// Cache expensive v4 board features. They depend only on the exact board state
// and side, not on search depth, randomness, or game-history counters.
if (typeof stonefishV4Material === 'function') {
  stonefishV4Material = stonefishRuntimeMemoPositionSide('v4Material', stonefishV4Material);
}
if (typeof stonefishV4Development === 'function') {
  stonefishV4Development = stonefishRuntimeMemoPositionSide('v4Development', stonefishV4Development);
}
if (typeof stonefishV4KingFreedom === 'function') {
  stonefishV4KingFreedom = stonefishRuntimeMemoPositionSide('v4KingFreedom', stonefishV4KingFreedom);
}
if (typeof stonefishV4KingProtection === 'function') {
  stonefishV4KingProtection = stonefishRuntimeMemoPositionSide('v4KingProtection', stonefishV4KingProtection);
}
if (typeof stonefishV4CenterControl === 'function') {
  stonefishV4CenterControl = stonefishRuntimeMemoPositionSide('v4CenterControl', stonefishV4CenterControl);
}
if (typeof stonefishV4PawnStructure === 'function') {
  stonefishV4PawnStructure = stonefishRuntimeMemoPositionSide('v4PawnStructure', stonefishV4PawnStructure);
}
if (typeof stonefishV4RookActivity === 'function') {
  stonefishV4RookActivity = stonefishRuntimeMemoPositionSide('v4RookActivity', stonefishV4RookActivity);
}
if (typeof stonefishV4KingPlacement === 'function') {
  stonefishV4KingPlacement = stonefishRuntimeMemoPositionSide('v4KingPlacement', stonefishV4KingPlacement);
}
if (typeof stonefishV4BoardControl === 'function') {
  stonefishV4BoardControl = stonefishRuntimeMemoPositionSide('v4BoardControl', stonefishV4BoardControl);
}
if (typeof stonefishV4HangingMax === 'function') {
  stonefishV4HangingMax = stonefishRuntimeMemoPositionSide('v4HangingMax', stonefishV4HangingMax);
}

// v5 repeatedly scans the same position for material and passer information.
if (typeof stonefishV5Material === 'function') {
  stonefishV5Material = stonefishRuntimeMemoPositionSide('v5Material', stonefishV5Material);
}
if (typeof stonefishV5PassedPawnInfo === 'function') {
  const stonefishRuntimeBasePassedPawnInfo = stonefishV5PassedPawnInfo;
  stonefishV5PassedPawnInfo = function(game, side) {
    const key = 'v5PassedPawnInfo|' + side + '|' + game.fastPositionKey();
    const cached = STONEFISH_RUNTIME_FEATURE_CACHE.get(key);
    if (cached !== undefined) return cached;
    return stonefishRuntimeCacheSet(
      STONEFISH_RUNTIME_FEATURE_CACHE,
      key,
      stonefishRuntimeBasePassedPawnInfo(game, side)
    );
  };
}
if (typeof stonefishV5PasserStatus === 'function') {
  const stonefishRuntimeBasePasserStatus = stonefishV5PasserStatus;
  stonefishV5PasserStatus = function(game, pawnSide, perspective) {
    const key = 'v5PasserStatus|' + pawnSide + '|' + perspective + '|' + game.fastPositionKey();
    const cached = STONEFISH_RUNTIME_FEATURE_CACHE.get(key);
    if (cached !== undefined) return cached;
    return stonefishRuntimeCacheSet(
      STONEFISH_RUNTIME_FEATURE_CACHE,
      key,
      stonefishRuntimeBasePasserStatus(game, pawnSide, perspective)
    );
  };
}
if (typeof stonefishV5EnemyPasserThreat === 'function') {
  stonefishV5EnemyPasserThreat = stonefishRuntimeMemoPositionPerspective('v5EnemyPasserThreat', stonefishV5EnemyPasserThreat);
}
if (typeof stonefishV5PositionScore === 'function') {
  stonefishV5PositionScore = stonefishRuntimeMemoPositionPerspective('v5PositionScoreFinal', stonefishV5PositionScore);
}

// Pro geometry is especially attack-count heavy. Memoizing exact attack counts
// keeps the same geometry while avoiding repeated ray scans in root prepasses.
if (typeof stonefishV5ProAttackCount === 'function') {
  const stonefishRuntimeBaseProAttackCount = stonefishV5ProAttackCount;
  stonefishV5ProAttackCount = function(game, sq, side) {
    const key = 'v5ProAttackCount|' + sq + '|' + side + '|' + game.fastPositionKey();
    const cached = STONEFISH_RUNTIME_FEATURE_CACHE.get(key);
    if (cached !== undefined) return cached;
    return stonefishRuntimeCacheSet(
      STONEFISH_RUNTIME_FEATURE_CACHE,
      key,
      stonefishRuntimeBaseProAttackCount(game, sq, side)
    );
  };
}
if (typeof stonefishV5ProKingZonePressure === 'function') {
  stonefishV5ProKingZonePressure = stonefishRuntimeMemoPositionSide('v5ProKingZonePressure', stonefishV5ProKingZonePressure);
}
if (typeof stonefishV5ProLooseAndCoordination === 'function') {
  stonefishV5ProLooseAndCoordination = stonefishRuntimeMemoPositionPerspective('v5ProLooseCoord', stonefishV5ProLooseAndCoordination);
}
if (typeof stonefishV5ProRayTactics === 'function') {
  stonefishV5ProRayTactics = stonefishRuntimeMemoPositionPerspective('v5ProRayTactics', stonefishV5ProRayTactics);
}
if (typeof stonefishV5ProCounterplay === 'function') {
  stonefishV5ProCounterplay = stonefishRuntimeMemoPositionPerspective('v5ProCounterplay', stonefishV5ProCounterplay);
}
