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

// In a legal position that is not currently in check, a non-king move can only
// expose its own king if the moving piece was shielding a rook/bishop/queen ray.
// Find those absolutely pinned FROM-squares once. Two 32-bit masks avoid array
// allocation. En-passant remains on the full legality path because removing the
// captured pawn can uncover a second ray.
function stonefishRuntimeKingSafety(game) {
  const us = game.side;
  const king = game.kingSq[us];
  if (game._isAttacked(king, -us)) return { inCheck: true, lo: 0, hi: 0 };

  const b = game.boardState;
  const kf = king & 7;
  const kr = king >> 3;
  let lo = 0;
  let hi = 0;

  for (let d = 0; d < SF_ALL_DIRS.length; d += 2) {
    const df = SF_ALL_DIRS[d];
    const dr = SF_ALL_DIRS[d + 1];
    let f = kf + df;
    let r = kr + dr;
    let blocker = -1;

    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = r * 8 + f;
      const piece = b[sq];
      if (!piece) {
        f += df;
        r += dr;
        continue;
      }

      const pieceSide = piece > 0 ? 1 : -1;
      if (blocker < 0) {
        if (pieceSide !== us) break;
        blocker = sq;
        f += df;
        r += dr;
        continue;
      }

      if (pieceSide === us) break;
      const type = Math.abs(piece);
      const diagonal = df !== 0 && dr !== 0;
      const slider = type === 5 || (diagonal ? type === 3 : type === 4);
      if (slider) {
        if (blocker < 32) lo |= (1 << blocker);
        else hi |= (1 << (blocker - 32));
      }
      break;
    }
  }

  return { inCheck: false, lo, hi };
}

function stonefishRuntimeIsPinned(safety, sq) {
  return sq < 32
    ? (safety.lo & (1 << sq)) !== 0
    : (safety.hi & (1 << (sq - 32))) !== 0;
}

// Keep _pseudoMoves() and its order exactly as released. In check, or for kings,
// en-passant and pinned pieces, retain the original full make/test/restore path.
// Every other pseudo move is necessarily legal with respect to the unmoving king.
Chess.prototype.fastMoves = function() {
  const pseudo = this._pseudoMoves();
  const legal = [];
  const safety = stonefishRuntimeKingSafety(this);

  if (safety.inCheck) {
    for (let i = 0; i < pseudo.length; i += 1) {
      if (this._testLegalRaw(pseudo[i])) legal.push(pseudo[i]);
    }
    return legal;
  }

  for (let i = 0; i < pseudo.length; i += 1) {
    const move = pseudo[i];
    if (
      move.piece !== 6 &&
      !(move.flags & 2) &&
      !stonefishRuntimeIsPinned(safety, move.from)
    ) {
      legal.push(move);
    } else if (this._testLegalRaw(move)) {
      legal.push(move);
    }
  }
  return legal;
};

// Existence queries are much hotter than they look: Pro calls them at leaves,
// terminal checks and mate probes. Do not allocate the entire pseudo-move array
// only to inspect its first legal member. Generate candidates in the exact same
// piece/direction order as _pseudoMoves() and return immediately when one legal
// reply exists. Safe non-king, non-EP, non-pinned moves retain the same proven
// no-make shortcut as fastMoves(); all sensitive candidates use _testLegalRaw().
Chess.prototype.fastHasLegalMove = function() {
  const b = this.boardState;
  const us = this.side;
  const safety = stonefishRuntimeKingSafety(this);

  const legalCandidate = (from, to, promotion, flags, pieceType) => {
    if (
      !safety.inCheck &&
      pieceType !== 6 &&
      !(flags & 2) &&
      !stonefishRuntimeIsPinned(safety, from)
    ) return true;
    return this._testLegalRaw({ from, to, promotion: promotion || 0, flags: flags || 0 });
  };

  for (let from = 0; from < 64; from += 1) {
    const piece = b[from];
    if (!piece || (piece > 0 ? 1 : -1) !== us) continue;
    const type = Math.abs(piece);
    const file = from & 7;
    const rank = from >> 3;

    if (type === 1) {
      const step = us === 1 ? 8 : -8;
      const startRank = us === 1 ? 1 : 6;
      const promoRank = us === 1 ? 7 : 0;
      const one = from + step;

      if (one >= 0 && one < 64 && !b[one]) {
        if ((one >> 3) === promoRank) {
          // Promotion choice cannot change whether our own king is safe.
          if (legalCandidate(from, one, 5, 0, type)) return true;
        } else {
          if (legalCandidate(from, one, 0, 0, type)) return true;
          const two = from + step * 2;
          if (rank === startRank && !b[two] && legalCandidate(from, two, 0, 1, type)) return true;
        }
      }

      for (let df = -1; df <= 1; df += 2) {
        const f = file + df;
        if (f < 0 || f > 7) continue;
        const to = from + step + df;
        if (to < 0 || to >= 64) continue;
        const target = b[to];
        if (target && (target > 0 ? 1 : -1) === -us) {
          if ((to >> 3) === promoRank) {
            if (legalCandidate(from, to, 5, 0, type)) return true;
          } else if (legalCandidate(from, to, 0, 0, type)) return true;
        } else if (to === this.ep && legalCandidate(from, to, 0, 2, type)) {
          return true;
        }
      }
      continue;
    }

    if (type === 2) {
      for (let i = 0; i < 8; i += 1) {
        const f = file + SF_KNIGHT_DF[i];
        const r = rank + SF_KNIGHT_DR[i];
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const to = r * 8 + f;
        const target = b[to];
        if ((!target || (target > 0 ? 1 : -1) === -us) && legalCandidate(from, to, 0, 0, type)) return true;
      }
      continue;
    }

    const dirs = type === 3 ? SF_DIAG_DIRS : type === 4 ? SF_ORTH_DIRS : SF_ALL_DIRS;
    for (let i = 0; i < dirs.length; i += 2) {
      const df = dirs[i];
      const dr = dirs[i + 1];
      let f = file + df;
      let r = rank + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const to = r * 8 + f;
        const target = b[to];
        if (!target) {
          if (legalCandidate(from, to, 0, 0, type)) return true;
        } else {
          if ((target > 0 ? 1 : -1) === -us && legalCandidate(from, to, 0, 0, type)) return true;
          break;
        }
        if (type === 6) break;
        f += df;
        r += dr;
      }
    }

    if (type === 6) {
      if (us === 1 && from === 4) {
        if ((this.castling & 1) && b[7] === 4 && !b[5] && !b[6] && !this._isAttacked(4,-1) && !this._isAttacked(5,-1) && !this._isAttacked(6,-1)) return true;
        if ((this.castling & 2) && b[0] === 4 && !b[1] && !b[2] && !b[3] && !this._isAttacked(4,-1) && !this._isAttacked(3,-1) && !this._isAttacked(2,-1)) return true;
      } else if (us === -1 && from === 60) {
        if ((this.castling & 4) && b[63] === -4 && !b[61] && !b[62] && !this._isAttacked(60,1) && !this._isAttacked(61,1) && !this._isAttacked(62,1)) return true;
        if ((this.castling & 8) && b[56] === -4 && !b[57] && !b[58] && !b[59] && !this._isAttacked(60,1) && !this._isAttacked(59,1) && !this._isAttacked(58,1)) return true;
      }
    }
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

// v3 sorts only by captured-piece value. There are just seven possible capture
// types, so a stable fixed-order scan avoids Array.sort/comparator overhead while
// producing exactly the same order (king, queen, rook, bishop, knight, pawn, none).
if (typeof stonefishV3OrderByCapture === 'function') {
  stonefishV3OrderByCapture = function(moves) {
    const ordered = new Array(moves.length);
    let out = 0;
    for (let captured = 6; captured >= 0; captured -= 1) {
      for (let i = 0; i < moves.length; i += 1) {
        if ((moves[i].captured || 0) === captured) ordered[out++] = moves[i];
      }
    }
    return ordered;
  };
}

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

// Pro's adaptive evaluator asks dozens of attack-count questions on one unchanged
// board. Build every square's count in one piece-centric pass per side, including
// the first occupied square on sliding rays so defended pieces match the released
// reverse-ray definition exactly.
function stonefishRuntimeBuildProAttackMap(game, side) {
  const b = game.boardState;
  const attacks = new Uint8Array(64);

  function add(file, rank) {
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) attacks[rank * 8 + file] += 1;
  }

  function ray(file, rank, df, dr) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = r * 8 + f;
      attacks[sq] += 1;
      if (b[sq]) break;
      f += df;
      r += dr;
    }
  }

  for (let from = 0; from < 64; from += 1) {
    const piece = b[from];
    if (!piece || (piece > 0 ? 1 : -1) !== side) continue;
    const type = Math.abs(piece);
    const file = from & 7;
    const rank = from >> 3;

    if (type === 1) {
      add(file - 1, rank + side);
      add(file + 1, rank + side);
      continue;
    }

    if (type === 2) {
      for (let i = 0; i < STONEFISH_V5_PRO_KNIGHT.length; i += 1) {
        add(file + STONEFISH_V5_PRO_KNIGHT[i][0], rank + STONEFISH_V5_PRO_KNIGHT[i][1]);
      }
      continue;
    }

    if (type === 6) {
      for (let i = 0; i < STONEFISH_V5_PRO_DIRS_BISHOP.length; i += 1) {
        add(file + STONEFISH_V5_PRO_DIRS_BISHOP[i][0], rank + STONEFISH_V5_PRO_DIRS_BISHOP[i][1]);
      }
      for (let i = 0; i < STONEFISH_V5_PRO_DIRS_ROOK.length; i += 1) {
        add(file + STONEFISH_V5_PRO_DIRS_ROOK[i][0], rank + STONEFISH_V5_PRO_DIRS_ROOK[i][1]);
      }
      continue;
    }

    if (type === 3 || type === 5) {
      for (let i = 0; i < STONEFISH_V5_PRO_DIRS_BISHOP.length; i += 1) {
        ray(file, rank, STONEFISH_V5_PRO_DIRS_BISHOP[i][0], STONEFISH_V5_PRO_DIRS_BISHOP[i][1]);
      }
    }
    if (type === 4 || type === 5) {
      for (let i = 0; i < STONEFISH_V5_PRO_DIRS_ROOK.length; i += 1) {
        ray(file, rank, STONEFISH_V5_PRO_DIRS_ROOK[i][0], STONEFISH_V5_PRO_DIRS_ROOK[i][1]);
      }
    }
  }

  return attacks;
}

if (typeof stonefishV5ProAttackCount === 'function') {
  stonefishV5ProAttackCount = function(game, sq, side) {
    const map = stonefishRuntimeMemo(
      game,
      'pmap:' + side,
      () => stonefishRuntimeBuildProAttackMap(game, side)
    );
    return map[sq];
  };
}
