// StoneFish shared runtime speed layer.
//
// Lossless only: no depth reductions, beam narrowing, score changes, or move
// eligibility changes. The hot path deliberately avoids global per-node hash
// lookups; it only reuses work while the exact current board is unchanged.

// fastPositionKey() is already required by the higher models. Cache the exact
// original string until make/undo instead of rebuilding its 64-square payload.
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
  this._stonefishRuntimeMemo = null;
  this._stonefishRuntimeCacheStack = [];
  return stonefishRuntimeBaseReset.call(this);
};

// Preserve the parent's key and same-state memo across speculative make/undo.
// Real game moves naturally leave one frame on this stack, matching historyStack;
// a real undo restores the exact previous memo as well.
const stonefishRuntimeBaseApplyRaw = Chess.prototype._applyRaw;
Chess.prototype._applyRaw = function(move, trackRepetition) {
  if (!this._stonefishRuntimeCacheStack) this._stonefishRuntimeCacheStack = [];
  this._stonefishRuntimeCacheStack.push({
    positionKey: this._stonefishRuntimePositionKey,
    memo: this._stonefishRuntimeMemo
  });
  this._stonefishRuntimePositionKey = null;
  this._stonefishRuntimeMemo = null;
  return stonefishRuntimeBaseApplyRaw.call(this, move, trackRepetition);
};

const stonefishRuntimeBaseUndoRaw = Chess.prototype._undoRaw;
Chess.prototype._undoRaw = function() {
  const stack = this._stonefishRuntimeCacheStack;
  const frame = stack && stack.length ? stack.pop() : null;
  const move = stonefishRuntimeBaseUndoRaw.call(this);
  if (frame) {
    this._stonefishRuntimePositionKey = frame.positionKey === undefined ? null : frame.positionKey;
    this._stonefishRuntimeMemo = frame.memo || null;
  } else {
    this._stonefishRuntimePositionKey = null;
    this._stonefishRuntimeMemo = null;
  }
  return move;
};

function stonefishRuntimeMemo(game, key, compute) {
  let memo = game._stonefishRuntimeMemo;
  if (!memo) {
    memo = new Map();
    game._stonefishRuntimeMemo = memo;
  }
  if (memo.has(key)) return memo.get(key);
  const value = compute();
  memo.set(key, value);
  return value;
}

// Mate probes only need to know whether ONE legal reply exists. Avoid creating
// and filtering the full legal-move array when the first reply already proves
// the move is not mate.
Chess.prototype.fastHasLegalMove = function() {
  const pseudo = this._pseudoMoves();
  for (let i = 0; i < pseudo.length; i += 1) {
    if (this._testLegalRaw(pseudo[i])) return true;
  }
  return false;
};

Chess.prototype.fastIsMateMove = function(move) {
  const raw = move && move._raw ? move._raw : move;
  if (!this.fastGivesCheck(raw)) return false;
  this.fastApply(raw);
  const mate = !this.fastHasLegalMove();
  this.fastUndo();
  return mate;
};

// v3's third-ply mate test used to generate every legal response after a check.
// It needs only an existence test, so keep the identical score with less work.
if (typeof stonefishV3BestThirdPlyGain === 'function') {
  stonefishV3BestThirdPlyGain = function(game, responses) {
    let best = 0;

    for (let i = 0; i < responses.length; i += 1) {
      const response = responses[i];
      const gain = STONEFISH_V3_VALUES[response.captured];
      if (gain > best) best = gain;

      if (game.fastGivesCheck(response)) {
        game.fastApply(response);
        const mate = !game.fastHasLegalMove();
        game.fastUndo();
        if (mate) return STONEFISH_V3_MATE_SCORE;
      }
    }

    return best;
  };
}

// These board features are genuinely repeated several times before the next
// make/undo (especially inside v5 Pro's adaptive evaluation and move ordering).
// Memo keys are tiny local labels rather than full position hashes.
if (typeof stonefishV4Material === 'function') {
  const base = stonefishV4Material;
  stonefishV4Material = function(game, side) {
    return stonefishRuntimeMemo(game, 'v4mat:' + side, () => base(game, side));
  };
}

if (typeof stonefishV4Development === 'function') {
  const base = stonefishV4Development;
  stonefishV4Development = function(game, side) {
    return stonefishRuntimeMemo(game, 'v4dev:' + side, () => base(game, side));
  };
}

if (typeof stonefishV4KingFreedom === 'function') {
  const base = stonefishV4KingFreedom;
  stonefishV4KingFreedom = function(game, side) {
    return stonefishRuntimeMemo(game, 'v4kf:' + side, () => base(game, side));
  };
}

if (typeof stonefishV4KingProtection === 'function') {
  const base = stonefishV4KingProtection;
  stonefishV4KingProtection = function(game, side) {
    return stonefishRuntimeMemo(game, 'v4kp:' + side, () => base(game, side));
  };
}

if (typeof stonefishV4KingPlacement === 'function') {
  const base = stonefishV4KingPlacement;
  stonefishV4KingPlacement = function(game, side) {
    return stonefishRuntimeMemo(game, 'v4kpl:' + side, () => base(game, side));
  };
}

if (typeof stonefishV4BoardControl === 'function') {
  const base = stonefishV4BoardControl;
  stonefishV4BoardControl = function(game, side) {
    return stonefishRuntimeMemo(game, 'v4bc:' + side, () => base(game, side));
  };
}

if (typeof stonefishV5Material === 'function') {
  const base = stonefishV5Material;
  stonefishV5Material = function(game, side) {
    return stonefishRuntimeMemo(game, 'v5mat:' + side, () => base(game, side));
  };
}

// Pro move ordering asks for the same passer list once per candidate move at a
// node. Build it once per side for that node instead of rescanning the board.
if (typeof stonefishV5PassedPawnInfo === 'function') {
  const base = stonefishV5PassedPawnInfo;
  stonefishV5PassedPawnInfo = function(game, side) {
    return stonefishRuntimeMemo(game, 'v5pass:' + side, () => base(game, side));
  };
}

// Adaptive Pro scoring repeatedly asks attack-count questions for the same
// square/side while the board is unchanged. Ray scans are much costlier than
// this tiny local memo lookup.
if (typeof stonefishV5ProAttackCount === 'function') {
  const base = stonefishV5ProAttackCount;
  stonefishV5ProAttackCount = function(game, sq, side) {
    return stonefishRuntimeMemo(game, 'pac:' + sq + ':' + side, () => base(game, sq, side));
  };
}
