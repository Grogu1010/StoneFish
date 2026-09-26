// Stonefish_runtime_speed_patch.js
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

// Stonefish_fast_moves_experiment.js
// Pass-9 speed patch: generate the final legal move list directly in the exact
// released pseudo-move order, avoiding the intermediate pseudo array and second walk.
Chess.prototype.fastMoves = function() {
  const b = this.boardState;
  const us = this.side;
  const safety = stonefishRuntimeKingSafety(this);
  const legal = [];

  const emit = (from, to, promotion = 0, flags = 0, pieceType = Math.abs(b[from])) => {
    let captured = b[to];
    if (flags & 2) captured = -us;
    const move = {
      from,
      to,
      promotion,
      flags,
      piece: pieceType,
      captured: captured ? Math.abs(captured) : 0
    };
    if (
      !safety.inCheck &&
      pieceType !== 6 &&
      !(flags & 2) &&
      !stonefishRuntimeIsPinned(safety, from)
    ) {
      legal.push(move);
      return;
    }
    if (this._testLegalRaw(move)) legal.push(move);
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
          emit(from, one, 5, 0, type);
          emit(from, one, 4, 0, type);
          emit(from, one, 3, 0, type);
          emit(from, one, 2, 0, type);
        } else {
          emit(from, one, 0, 0, type);
          const two = from + step * 2;
          if (rank === startRank && !b[two]) emit(from, two, 0, 1, type);
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
            emit(from, to, 5, 0, type);
            emit(from, to, 4, 0, type);
            emit(from, to, 3, 0, type);
            emit(from, to, 2, 0, type);
          } else emit(from, to, 0, 0, type);
        } else if (to === this.ep) {
          emit(from, to, 0, 2, type);
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
        if (!target || (target > 0 ? 1 : -1) === -us) emit(from, to, 0, 0, type);
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
        if (!target) emit(from, to, 0, 0, type);
        else {
          if ((target > 0 ? 1 : -1) === -us) emit(from, to, 0, 0, type);
          break;
        }
        if (type === 6) break;
        f += df;
        r += dr;
      }
    }

    if (type === 6) {
      if (us === 1 && from === 4) {
        if ((this.castling & 1) && b[7] === 4 && !b[5] && !b[6] && !this._isAttacked(4,-1) && !this._isAttacked(5,-1) && !this._isAttacked(6,-1)) emit(4, 6, 0, 4, type);
        if ((this.castling & 2) && b[0] === 4 && !b[1] && !b[2] && !b[3] && !this._isAttacked(4,-1) && !this._isAttacked(3,-1) && !this._isAttacked(2,-1)) emit(4, 2, 0, 8, type);
      } else if (us === -1 && from === 60) {
        if ((this.castling & 4) && b[63] === -4 && !b[61] && !b[62] && !this._isAttacked(60,1) && !this._isAttacked(61,1) && !this._isAttacked(62,1)) emit(60, 62, 0, 4, type);
        if ((this.castling & 8) && b[56] === -4 && !b[57] && !b[58] && !b[59] && !this._isAttacked(60,1) && !this._isAttacked(59,1) && !this._isAttacked(58,1)) emit(60, 58, 0, 8, type);
      }
    }
  }
  return legal;
};

// Stonefish_v5_5_search.js
// Stonefish v5.5 native search core — Guarded PVS.
//
// v5.5 keeps v5 Pro's evaluation/knowledge and retains four serious root
// finalists, matching Pro's candidate coverage while using a much narrower
// internal five-ply tree. True principal-variation probes, safe exact
// transposition reuse and late-move reductions keep the wider root set cheap.
// The separate native Refutation Guard can inject a missed opponent reply into
// this same search; ARMX-preview is no longer part of the search core.

const STONEFISH_V5_5_SEARCH = Object.freeze({
  name: 'Guarded PVS',
  semifinalists: 7,
  rootCandidates: 4,
  rootProbeKeep: 2,
  branch: [0, 1, 2, 2, 4],
  lmrMinDepth: 3,
  lmrAfterMove: 2,
  pvsEpsilon: 1e-6,
  tacticalWeight: 1.10,
  scoutWeight: 0.20,
  heritageMultiplier: 0.75,
  conversionWeight: 0.50,
});

let STONEFISH_V5_5_LAST_SEARCH_STATS = null;
let STONEFISH_V5_5_ACTIVE_TT = null;

function stonefishV55IsTactical(game, move) {
  return Boolean(move.captured || move.promotion || (game.fastGivesCheck && game.fastGivesCheck(move)));
}

function stonefishV55SameRaw(a, b) {
  return Boolean(a && b && a.from === b.from && a.to === b.to
    && (a.promotion || 0) === (b.promotion || 0) && (a.flags || 0) === (b.flags || 0));
}

function stonefishV55RawKey(move) {
  return move ? `${move.from}:${move.to}:${move.promotion || 0}:${move.flags || 0}` : '-';
}

function stonefishV55TTKey(game, depth, perspective, plyFromRoot, injectedMove) {
  return `${perspective}|${depth}|${plyFromRoot}|${game.halfmove}|${stonefishV55RawKey(injectedMove)}|${game.fastPositionKey()}`;
}

function stonefishV55PasserThreat(passers) {
  if (!passers || typeof stonefishV5PasserDanger !== 'function') return 0;
  let danger = 0;
  for (let i = 0; i < passers.length; i += 1) {
    danger = Math.max(danger, stonefishV5PasserDanger(passers[i].distance));
  }
  return danger;
}

function stonefishV55SearchWidth(game, depth, legal, enemyPassers = null) {
  let width = STONEFISH_V5_5_SEARCH.branch[depth] || 1;
  if (game.in_check()) width = Math.max(width, Math.min(5, legal.length));
  const danger = enemyPassers
    ? stonefishV55PasserThreat(enemyPassers)
    : (typeof stonefishV5EnemyPasserThreat === 'function'
      ? stonefishV5EnemyPasserThreat(game, game.side)
      : 0);
  if (danger >= 2200) width += 1;
  return Math.min(width, legal.length);
}

function stonefishV55Terminal(game, perspective, plyFromRoot, legal) {
  if (legal.length) return null;
  if (!game.in_check()) return 0;
  return game.side === perspective
    ? -STONEFISH_V5_PRO_MATE + plyFromRoot
    : STONEFISH_V5_PRO_MATE - plyFromRoot;
}

function stonefishV55Leaf(game, perspective, alpha, beta, plyFromRoot) {
  if (game.in_check()) {
    const legal = game.fastMoves();
    if (!legal.length) return game.side === perspective
      ? -STONEFISH_V5_PRO_MATE + plyFromRoot
      : STONEFISH_V5_PRO_MATE - plyFromRoot;
    return stonefishV55CheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot);
  }
  if (!game.fastHasLegalMove()) return 0;
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.leaves += 1;
  return stonefishV5ProLeaf(game, perspective);
}

function stonefishV55OrderedEntryBefore(a, b) {
  if (a.order > b.order) return true;
  if (a.order < b.order) return false;
  return a.index < b.index;
}

function stonefishV55MoveOrderInfo(game, move, enemyPassers = null) {
  const givesCheck = Boolean(game.fastGivesCheck && game.fastGivesCheck(move));
  if (typeof STONEFISH_V5_PIECE === 'undefined') {
    return { order: stonefishV5ProSpeedMoveOrder(game, move), givesCheck };
  }

  let score = (STONEFISH_V5_PIECE[move.captured] || 0) * 16
    - (STONEFISH_V5_PIECE[move.piece] || 0);
  if (move.promotion) score += (STONEFISH_V5_PIECE[move.promotion] || 0) * 9;
  if (givesCheck) score += 1800;
  if (move.flags & (4 | 8)) score += 80;

  if (enemyPassers && typeof stonefishV5PasserDanger === 'function') {
    const enemy = -game.side;
    for (let i = 0; i < enemyPassers.length; i += 1) {
      const passer = enemyPassers[i];
      if (passer.distance > 3) continue;
      const danger = stonefishV5PasserDanger(passer.distance);
      const nextSq = passer.sq + enemy * 8;
      const promotionSq = (enemy === 1 ? 7 : 0) * 8 + passer.file;
      if (move.to === passer.sq && move.captured === 1) score += danger * 8;
      if (move.to === nextSq) score += danger * 4;
      if (move.to === promotionSq) score += danger * 6;
    }
  } else if (typeof stonefishV5ProSpeedMoveOrder === 'function') {
    score = stonefishV5ProSpeedMoveOrder(game, move);
  }

  return { order: score, givesCheck };
}

function stonefishV55TopOrdered(game, legal, width, injectedMove = null, enemyPassers = null) {
  const selected = [];
  let injectedEntry = null;

  for (let index = 0; index < legal.length; index += 1) {
    const move = legal[index];
    const info = stonefishV55MoveOrderInfo(game, move, enemyPassers);
    const entry = { move, index, order: info.order, givesCheck: info.givesCheck };
    if (injectedMove && stonefishV55SameRaw(move, injectedMove)) injectedEntry = entry;

    if (width <= 0) continue;
    const worst = selected.length ? selected[selected.length - 1] : null;
    if (selected.length >= width && worst && !stonefishV55OrderedEntryBefore(entry, worst)) continue;

    let at = selected.length;
    while (at > 0 && stonefishV55OrderedEntryBefore(entry, selected[at - 1])) at -= 1;
    selected.splice(at, 0, entry);
    if (selected.length > width) selected.pop();
  }

  if (!injectedEntry) return selected;
  if (selected.some(entry => entry.index === injectedEntry.index)) return selected;
  selected.push(injectedEntry);
  return selected;
}

function stonefishV55CheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot) {
  const maximizing = game.side === perspective;
  const enemyPassers = typeof stonefishV5PassedPawnInfo === 'function'
    ? stonefishV5PassedPawnInfo(game, -game.side)
    : null;
  const ordered = stonefishV55TopOrdered(
    game,
    legal,
    Math.min(6, legal.length),
    null,
    enemyPassers
  );
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < ordered.length; i += 1) {
    game.fastApply(ordered[i].move);
    let value;
    if (!game.fastHasLegalMove()) {
      value = game.in_check()
        ? (game.side === perspective
          ? -STONEFISH_V5_PRO_MATE + plyFromRoot + 1
          : STONEFISH_V5_PRO_MATE - plyFromRoot - 1)
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

function stonefishV55Ordered(game, legal, depth, injectedMove) {
  const enemyPassers = typeof stonefishV5PassedPawnInfo === 'function'
    ? stonefishV5PassedPawnInfo(game, -game.side)
    : null;
  const width = stonefishV55SearchWidth(game, depth, legal, enemyPassers);
  return stonefishV55TopOrdered(game, legal, width, injectedMove, enemyPassers);
}

function stonefishV55Minimax(game, depth, perspective, alpha, beta, plyFromRoot, injectedMove = null) {
  if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.nodes += 1;
  if (depth <= 0) return stonefishV55Leaf(game, perspective, alpha, beta, plyFromRoot);

  const tt = STONEFISH_V5_5_ACTIVE_TT;
  const ttKey = tt ? stonefishV55TTKey(game, depth, perspective, plyFromRoot, injectedMove) : null;
  if (tt) {
    const hit = tt.get(ttKey);
    if (hit !== undefined) {
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.ttHits += 1;
      return hit;
    }
  }

  const legal = game.fastMoves();
  const terminal = stonefishV55Terminal(game, perspective, plyFromRoot, legal);
  if (terminal !== null) {
    if (tt) tt.set(ttKey, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) {
    if (tt) tt.set(ttKey, 0);
    return 0;
  }

  const ordered = stonefishV55Ordered(game, legal, depth, injectedMove);
  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;
  let exact = true;

  for (let i = 0; i < ordered.length; i += 1) {
    const move = ordered[i].move;
    const canReduce = depth >= STONEFISH_V5_5_SEARCH.lmrMinDepth
      && i >= STONEFISH_V5_5_SEARCH.lmrAfterMove;
    const tactical = canReduce
      ? Boolean(move.captured || move.promotion || ordered[i].givesCheck)
      : false;
    game.fastApply(move);
    let value;

    if (i === 0) {
      value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
    } else if (canReduce && !tactical) {
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.reductions += 1;
      value = stonefishV55Minimax(game, Math.max(0, depth - 2), perspective, alpha, beta, plyFromRoot + 1, null);
      const challenges = maximizing ? value > alpha : value < beta;
      if (challenges) {
        if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
        value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
      } else {
        exact = false;
      }
    } else {
      const eps = STONEFISH_V5_5_SEARCH.pvsEpsilon;
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.pvsProbes += 1;
      if (maximizing) {
        const probeBeta = Math.min(beta, alpha + eps);
        value = stonefishV55Minimax(game, depth - 1, perspective, alpha, probeBeta, plyFromRoot + 1, null);
        if (value > alpha && value < beta) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
        }
      } else {
        const probeAlpha = Math.max(alpha, beta - eps);
        value = stonefishV55Minimax(game, depth - 1, perspective, probeAlpha, beta, plyFromRoot + 1, null);
        if (value < beta && value > alpha) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
        }
      }
    }

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
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.cutoffs += 1;
      break;
    }
  }

  if (tt && !cutoff && exact) tt.set(ttKey, best);
  return best;
}

function stonefishV55ResetSearchStats() {
  STONEFISH_V5_5_LAST_SEARCH_STATS = {
    nodes: 0,
    leaves: 0,
    reductions: 0,
    pvsProbes: 0,
    researches: 0,
    cutoffs: 0,
    ttHits: 0,
  };
}

function stonefishV55FivePlyWindowScore(game, raw, perspective, alpha, beta, injectedReply = null) {
  const historyDepth = game.historyStack.length;
  stonefishV55ResetSearchStats();
  try {
    game.fastApply(raw);
    const legal = game.fastMoves();
    if (!legal.length) return game.in_check() ? STONEFISH_V5_PRO_MATE - 1 : 0;
    return stonefishV55Minimax(game, 4, perspective, alpha, beta, 1, injectedReply);
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55FivePlyScore(game, raw, perspective, injectedReply = null) {
  return stonefishV55FivePlyWindowScore(
    game,
    raw,
    perspective,
    -STONEFISH_V5_PRO_MATE,
    STONEFISH_V5_PRO_MATE,
    injectedReply
  );
}

function stonefishV55RecomputeFinalScore(entry) {
  if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) return entry.deep;
  const selective = entry.deep * 1.28 + entry.preliminary * 0.46;
  const heritageFloor = entry.heritageMatch
    ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
    : -Infinity;
  return Math.max(selective, heritageFloor);
}

function stonefishV55EntryUci(game, entry) {
  if (entry.uci) return entry.uci;
  entry.uci = stonefishV45RawUci(game, entry.raw);
  return entry.uci;
}

function stonefishV55SortFinalScores(game, ranked) {
  const active = [];
  const inactive = [];
  for (let i = 0; i < ranked.length; i += 1) {
    const entry = ranked[i];
    if (Number.isFinite(entry.score)) active.push(entry);
    else inactive.push(entry);
  }
  active.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return stonefishV55EntryUci(game, a).localeCompare(stonefishV55EntryUci(game, b));
  });
  inactive.sort((a, b) => stonefishV55EntryUci(game, a).localeCompare(stonefishV55EntryUci(game, b)));
  ranked.length = 0;
  ranked.push(...active, ...inactive);
  return ranked;
}

// Same tactical gain arithmetic as final v5, but check status is computed once
// per response instead of once for mate detection and again for the check bonus.
function stonefishV55BestResponseGain(game, responses) {
  let best = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const response = responses[i];
    const givesCheck = Boolean(game.fastGivesCheck && game.fastGivesCheck(response));
    if (givesCheck) {
      game.fastApply(response);
      const mate = game.fastMoves().length === 0;
      game.fastUndo();
      if (mate) return STONEFISH_V5_MATE;
    }

    let gain = STONEFISH_V5_PIECE[response.captured] || 0;
    if (response.promotion) gain += (STONEFISH_V5_PIECE[response.promotion] || 0) - 100;
    if (givesCheck) gain += 18;
    if (gain > best) best = gain;
  }
  return best;
}

// Final-v5-equivalent tactical scorer. It folds the base three-ply pass and the
// later mate/repetition wrapper into one traversal, so the root move and checking
// replies are not repeatedly applied just to answer the same questions.
function stonefishV55TacticalScore(game, raw) {
  const historyDepth = game.historyStack.length;
  let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
  if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

  try {
    game.fastApply(raw);
    const replies = game.fastMoves();
    const rootChecking = game.in_check();
    if (!replies.length && rootChecking) return STONEFISH_V5_MATE * 2;

    let score = 0;
    if (replies.length) {
      let worst = Infinity;
      for (let i = 0; i < replies.length; i += 1) {
        const reply = replies[i];
        const givesCheck = Boolean(game.fastGivesCheck && game.fastGivesCheck(reply));
        let opponentGain = STONEFISH_V5_PIECE[reply.captured] || 0;
        if (reply.promotion) opponentGain += (STONEFISH_V5_PIECE[reply.promotion] || 0) - 100;
        if (givesCheck) opponentGain += 14;

        game.fastApply(reply);
        const responses = game.fastMoves();
        if (givesCheck && !responses.length) return -STONEFISH_V5_MATE;
        const ourGain = stonefishV55BestResponseGain(game, responses);
        game.fastUndo();

        const branch = immediate - opponentGain + ourGain;
        if (branch < worst) worst = branch;
      }
      score = worst;
    }

    if (score >= STONEFISH_V5_MATE) score = STONEFISH_V5_MATE * 0.5;
    if (score <= -STONEFISH_V5_MATE) return -STONEFISH_V5_MATE;

    const rootVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
    if (rootVisits > 0) {
      score -= rootVisits * 1200000;
      score = Math.max(score, STONEFISH_V5_DRAW_FLOOR);
    }

    for (let i = 0; i < replies.length; i += 1) {
      game.fastApply(replies[i]);
      const priorVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
      game.fastUndo();
      if (priorVisits >= 2) {
        score = Math.min(score, STONEFISH_V5_DRAW_FLOOR);
        break;
      }
    }
    return score;
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55ConversionUrgencyFromLead(game, raw, lead) {
  if (game.halfmove < 45) return 0;
  if (lead < 120) return 0;
  const reset = raw.piece === 1 || raw.captured;
  const urgency = Math.max(0, game.halfmove - 45);
  if (reset) return 1800 + urgency * 210;
  if (game.halfmove >= 70) return -urgency * 85;
  return 0;
}

// Exact v5 Pro scout formula with conversion urgency supplied by the root pass.
// A checking move is applied once for both mate detection and passer/repetition
// screening, rather than fastIsMateMove applying it and the scout applying it again.
function stonefishV55FastScoutScore(game, raw, bookMove, heritageMove, perspective, conversion) {
  const historyDepth = game.historyStack.length;
  let score = 0;
  const capture = STONEFISH_V5_PIECE[raw.captured] || 0;
  score += capture * 15 - (STONEFISH_V5_PIECE[raw.piece] || 0) * (raw.captured ? 0.15 : 0);
  if (raw.promotion) score += ((STONEFISH_V5_PIECE[raw.promotion] || 0) - 100) * 18 + 2400;
  if (raw.flags & (4 | 8)) score += 260;
  if (bookMove && stonefishV5SameMove(raw, bookMove)) score += 3600;
  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) score += 3000;
  score += conversion;

  const givesCheck = Boolean(game.fastGivesCheck && game.fastGivesCheck(raw));
  if (givesCheck) score += 900;

  try {
    game.fastApply(raw);
    if (givesCheck && game.fastMoves().length === 0) return STONEFISH_V5_PRO_MATE * 4;

    const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
    if (enemyThreat >= 300) score -= enemyThreat * 9;
    else if (enemyThreat >= 120) score -= enemyThreat * 3;
    const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
    if (visits > 0) score -= visits * 240000;
    return score;
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55ScoutBefore(a, b) {
  if (Math.abs(b.scout - a.scout) > 1e-9) return a.scout > b.scout;
  return a.uci < b.uci;
}

function stonefishV55SelectSemifinalists(scored, limit) {
  const top = [];
  for (let i = 0; i < scored.length; i += 1) {
    const entry = scored[i];
    const last = top.length ? top[top.length - 1] : null;
    if (top.length >= limit && last && !stonefishV55ScoutBefore(entry, last)) continue;
    let at = top.length;
    while (at > 0 && stonefishV55ScoutBefore(entry, top[at - 1])) at -= 1;
    top.splice(at, 0, entry);
    if (top.length > limit) top.pop();
  }
  return top;
}

function stonefishV55FastCandidates(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const heritageMove = stonefishV5HeritageMove(game);
  const conversionLead = game.halfmove >= 45
    ? stonefishV5Material(game, perspective) - stonefishV5Material(game, -perspective)
    : 0;
  const scored = legal.map(raw => {
    const conversion = stonefishV55ConversionUrgencyFromLead(game, raw, conversionLead);
    return {
      raw,
      uci: stonefishV45RawUci(game, raw),
      tactical: null,
      knowledge: 0,
      conversion,
      heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
      scout: stonefishV55FastScoutScore(game, raw, bookMove, heritageMove, perspective, conversion),
      preliminary: -Infinity,
      deep: null,
      score: -Infinity,
    };
  });
  scored.v55Context = { legal, perspective, bookMove, heritageMove };

  const n = Math.min(STONEFISH_V5_5_SEARCH.semifinalists, scored.length);
  const semifinalists = stonefishV55SelectSemifinalists(scored, n);
  const semifinalistSet = new Set(semifinalists);
  const remainder = scored.filter(entry => !semifinalistSet.has(entry));
  scored.length = 0;
  scored.push(...semifinalists, ...remainder);

  for (let i = 0; i < n; i += 1) {
    const entry = scored[i];
    entry.tactical = stonefishV55TacticalScore(game, entry.raw);
    const heritageBoost = entry.heritageMatch
      ? STONEFISH_V5_WEIGHTS.heritage * STONEFISH_V5_5_SEARCH.heritageMultiplier
      : 0;
    entry.preliminary = entry.tactical * STONEFISH_V5_5_SEARCH.tacticalWeight
      + entry.scout * STONEFISH_V5_5_SEARCH.scoutWeight
      + heritageBoost
      + entry.conversion * STONEFISH_V5_5_SEARCH.conversionWeight;
    entry.score = entry.preliminary;
  }
  for (let i = n; i < scored.length; i += 1) {
    scored[i].preliminary = -Infinity;
    scored[i].score = -Infinity;
  }

  const active = scored.slice(0, n);
  const inactive = scored.slice(n);
  active.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return a.uci.localeCompare(b.uci);
  });
  inactive.sort((a, b) => a.uci.localeCompare(b.uci));
  scored.length = 0;
  scored.push(...active, ...inactive);
  return scored;
}

function stonefishV55RootSecondScore(entries) {
  let first = -Infinity;
  let second = -Infinity;
  for (const entry of entries) {
    if (!entry || !Number.isFinite(entry.score)) continue;
    if (entry.score > first) {
      second = first;
      first = entry.score;
    } else if (entry.score > second) {
      second = entry.score;
    }
  }
  return second;
}

function stonefishV55RootProbeThreshold(entry, secondScore) {
  if (!Number.isFinite(secondScore)) return null;
  const heritageFloor = entry.heritageMatch
    ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
    : -Infinity;
  if (heritageFloor >= secondScore - 1e-9) return null;
  if (secondScore <= -STONEFISH_V5_PRO_MATE * 0.9) return null;
  if (secondScore >= STONEFISH_V5_PRO_MATE * 0.9) return secondScore;
  return (secondScore - entry.preliminary * 0.46) / 1.28;
}

function stonefishV55FinishCandidates(game, ranked) {
  if (!ranked.length) return [];
  const context = ranked.v55Context || null;
  const perspective = context ? context.perspective : game.side;
  const legal = context ? context.legal : ranked.map(entry => entry.raw);
  const bookMove = context ? context.bookMove : stonefishV45BookMove(game, 1, legal);
  const heritageMove = context ? context.heritageMove : stonefishV5HeritageMove(game);
  const finalists = Math.min(STONEFISH_V5_5_SEARCH.rootCandidates, ranked.length);
  const oldTT = STONEFISH_V5_5_ACTIVE_TT;
  const rootTT = new Map();
  ranked.v55SearchTT = rootTT;
  STONEFISH_V5_5_ACTIVE_TT = rootTT;

  try {
    for (let i = 0; i < finalists; i += 1) {
      const entry = ranked[i];
      entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
        ? 0
        : stonefishV5ProRootKnowledge(game, entry.raw, heritageMove, bookMove, perspective, entry.tactical);
      entry.preliminary = entry.tactical + entry.knowledge + entry.conversion;
      entry.refutationGuardCriticalReply = null;
      entry.rootProbeOnly = false;
      entry.rootProbeBound = null;
      entry.deep = null;
      entry.score = -Infinity;
    }

    const keep = Math.min(STONEFISH_V5_5_SEARCH.rootProbeKeep, finalists);
    const exact = [];
    for (let i = 0; i < keep; i += 1) {
      const entry = ranked[i];
      entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, null);
      entry.score = stonefishV55RecomputeFinalScore(entry);
      exact.push(entry);
    }

    for (let i = keep; i < finalists; i += 1) {
      const entry = ranked[i];
      const secondScore = stonefishV55RootSecondScore(exact);
      const threshold = stonefishV55RootProbeThreshold(entry, secondScore);
      let needsFullSearch = threshold === null;

      if (!needsFullSearch) {
        const alpha = Math.max(-STONEFISH_V5_PRO_MATE, threshold);
        const beta = Math.min(STONEFISH_V5_PRO_MATE, alpha + STONEFISH_V5_5_SEARCH.pvsEpsilon);
        const probe = stonefishV55FivePlyWindowScore(game, entry.raw, perspective, alpha, beta, null);
        entry.rootProbeBound = probe;
        if (probe > alpha + STONEFISH_V5_5_SEARCH.pvsEpsilon * 0.5) {
          needsFullSearch = true;
        } else {
          entry.rootProbeOnly = true;
          entry.deep = probe;
          entry.score = -Infinity;
        }
      }

      if (needsFullSearch) {
        entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, null);
        entry.score = stonefishV55RecomputeFinalScore(entry);
        exact.push(entry);
      }
    }
  } finally {
    STONEFISH_V5_5_ACTIVE_TT = oldTT;
  }

  for (let i = finalists; i < ranked.length; i += 1) ranked[i].score = -Infinity;
  return stonefishV55SortFinalScores(game, ranked);
}

function stonefishV55VerifyInjectedReply(game, entry, perspective, injectedReply, reusableTT = null) {
  if (!entry || !injectedReply) return entry;
  entry.refutationGuardOriginalDeep = entry.deep;
  entry.refutationGuardCriticalReply = injectedReply;
  const oldTT = STONEFISH_V5_5_ACTIVE_TT;
  STONEFISH_V5_5_ACTIVE_TT = reusableTT || new Map();
  try {
    entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, injectedReply);
  } finally {
    STONEFISH_V5_5_ACTIVE_TT = oldTT;
  }
  entry.score = stonefishV55RecomputeFinalScore(entry);
  entry.refutationGuardVerifiedDeep = entry.deep;
  return entry;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_SEARCH = STONEFISH_V5_5_SEARCH;
  globalThis.stonefishV55Minimax = stonefishV55Minimax;
  globalThis.stonefishV55FivePlyScore = stonefishV55FivePlyScore;
  globalThis.stonefishV55FivePlyWindowScore = stonefishV55FivePlyWindowScore;
  globalThis.stonefishV55TopOrdered = stonefishV55TopOrdered;
  globalThis.stonefishV55FastCandidates = stonefishV55FastCandidates;
  globalThis.stonefishV55FinishCandidates = stonefishV55FinishCandidates;
  globalThis.stonefishV55VerifyInjectedReply = stonefishV55VerifyInjectedReply;
  globalThis.stonefishV55SortFinalScores = stonefishV55SortFinalScores;
}

// Stonefish_v5_5_refutation_guard.js
// Stonefish v5.5 native Refutation Guard.
//
// This is deliberately part of v5.5, NOT ARMX. It preserves the useful idea from
// the old ARMX experiments: look outside the normal selective reply beam for a
// legal opponent resource, then force that reply into the SAME v5.5 search
// horizon. The current v5.5 implementation searches five plies; future versions
// can deepen the guard without renaming the feature. The guard never gives a move
// an optimistic bonus. A candidate can only be lowered after v5.5 itself verifies
// that the omitted reply is genuinely worse.

const STONEFISH_V5_5_REFUTATION_GUARD = Object.freeze({
  name: 'Refutation Guard',
  ply: 5,
  candidates: 1,
  maxScreenedReplies: 5,
  maxVerifiedReplies: 1,
  triggerScoreGap: 520,
  minVerifiedDrop: 24,
});

let STONEFISH_V5_5_LAST_REFUTATION_GUARD = null;

function stonefishV55GuardStaticScore(game, perspective) {
  let score = typeof stonefishV5PositionScore === 'function'
    ? stonefishV5PositionScore(game, perspective)
    : 0;
  if (game.in_check()) score += game.side === perspective ? -180 : 120;
  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    const danger = stonefishV5EnemyPasserThreat(game, perspective);
    if (danger >= 2200) score -= danger * 0.36;
    else if (danger >= 900) score -= danger * 0.16;
  }
  return score;
}

function stonefishV55GuardEntryBefore(a, b) {
  if (a.score < b.score) return true;
  if (a.score > b.score) return false;
  return a.index < b.index;
}

function stonefishV55GuardKeepWorst(screened, entry, limit) {
  if (limit <= 0) return;
  const last = screened.length ? screened[screened.length - 1] : null;
  if (screened.length >= limit && last && !stonefishV55GuardEntryBefore(entry, last)) return;

  let at = screened.length;
  while (at > 0 && stonefishV55GuardEntryBefore(entry, screened[at - 1])) at -= 1;
  screened.splice(at, 0, entry);
  if (screened.length > limit) screened.pop();
}

function stonefishV55GuardNovelReplies(game, rootMove, perspective) {
  const historyDepth = game.historyStack.length;
  try {
    game.fastApply(rootMove);
    const legal = game.fastMoves();
    if (!legal.length) return { legal: 0, beam: 0, replies: [] };

    // Search width and move ordering consume the same enemy-passer geometry.
    // Compute it once here and feed it into both exact native helpers rather than
    // rescanning all 64 squares once per legal reply.
    const enemyPassers = typeof stonefishV5PassedPawnInfo === 'function'
      ? stonefishV5PassedPawnInfo(game, -game.side)
      : null;
    const beam = typeof stonefishV55SearchWidth === 'function'
      ? stonefishV55SearchWidth(game, 4, legal, enemyPassers)
      : Math.min(4, legal.length);
    const orderedBeam = typeof stonefishV55TopOrdered === 'function'
      ? stonefishV55TopOrdered(game, legal, beam, null, enemyPassers)
      : legal
        .map((move, index) => ({ move, index, order: stonefishV5ProSpeedMoveOrder(game, move) }))
        .sort((a, b) => (b.order - a.order) || (a.index - b.index))
        .slice(0, beam);
    const selected = new Set(orderedBeam.map(entry => entry.move));
    const screened = [];

    for (let i = 0; i < legal.length; i += 1) {
      const reply = legal[i];
      if (selected.has(reply)) continue;
      game.fastApply(reply);
      const score = stonefishV55GuardStaticScore(game, perspective);
      game.fastUndo();
      stonefishV55GuardKeepWorst(
        screened,
        { reply, score, index: i },
        STONEFISH_V5_5_REFUTATION_GUARD.maxScreenedReplies
      );
    }

    return {
      legal: legal.length,
      beam,
      replies: screened,
    };
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55ShouldRunGuard(game, finished, perspective) {
  const leader = finished[0] || null;
  if (!leader) return false;
  const runnerUp = finished[1] || null;
  if (!runnerUp || !Number.isFinite(runnerUp.score)) return true;
  if (leader.score - runnerUp.score <= STONEFISH_V5_5_REFUTATION_GUARD.triggerScoreGap) return true;
  if (game.in_check()) return true;
  if (typeof stonefishV5EnemyPasserThreat === 'function') {
    return stonefishV5EnemyPasserThreat(game, perspective) >= 2200;
  }
  return false;
}

function stonefishV55ApplyRefutationGuard(game, finished, perspective = game.side) {
  const metadata = {
    model: STONEFISH_V5_5_REFUTATION_GUARD.name,
    ply: STONEFISH_V5_5_REFUTATION_GUARD.ply,
    eligible: false,
    screened: 0,
    verified: 0,
    reusedSearchTable: false,
    changedMove: false,
    lowered: false,
    originalDeep: null,
    verifiedDeep: null,
    drop: 0,
    criticalReply: null,
  };
  STONEFISH_V5_5_LAST_REFUTATION_GUARD = metadata;
  if (!finished || !finished.length) return metadata;

  const originalLeader = finished[0];
  metadata.eligible = stonefishV55ShouldRunGuard(game, finished, perspective);
  if (!metadata.eligible) return metadata;

  const reusableTT = finished.v55SearchTT instanceof Map ? finished.v55SearchTT : null;
  metadata.reusedSearchTable = Boolean(reusableTT);
  const candidates = finished.slice(0, STONEFISH_V5_5_REFUTATION_GUARD.candidates);
  for (const entry of candidates) {
    if (!entry || !Number.isFinite(entry.deep)) continue;
    const scan = stonefishV55GuardNovelReplies(game, entry.raw, perspective);
    metadata.screened += scan.replies.length;
    if (!scan.replies.length) continue;

    for (let i = 0; i < Math.min(STONEFISH_V5_5_REFUTATION_GUARD.maxVerifiedReplies, scan.replies.length); i += 1) {
      const criticalReply = scan.replies[i].reply;
      const originalDeep = entry.deep;
      const originalScore = entry.score;

      if (typeof stonefishV55VerifyInjectedReply === 'function') {
        stonefishV55VerifyInjectedReply(game, entry, perspective, criticalReply, reusableTT);
      } else {
        entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, criticalReply);
        entry.score = stonefishV55RecomputeFinalScore(entry);
      }
      metadata.verified += 1;

      // Adding an extra legal opponent reply can only make the root candidate
      // worse. Preserve that minimax invariant even if selective-search noise
      // happens to return a numerically higher value on the verification pass.
      const verifiedDeep = Math.min(originalDeep, entry.deep);
      const drop = originalDeep - verifiedDeep;
      if (drop < STONEFISH_V5_5_REFUTATION_GUARD.minVerifiedDrop) {
        entry.deep = originalDeep;
        entry.score = originalScore;
        entry.refutationGuardCriticalReply = null;
        entry.refutationGuardVerifiedDeep = null;
        continue;
      }

      entry.refutationGuardOriginalDeep = originalDeep;
      entry.refutationGuardCriticalReply = criticalReply;
      entry.deep = verifiedDeep;
      entry.score = stonefishV55RecomputeFinalScore(entry);
      entry.refutationGuardVerifiedDeep = verifiedDeep;
      metadata.lowered = true;
      metadata.originalDeep = originalDeep;
      metadata.verifiedDeep = verifiedDeep;
      metadata.drop = drop;
      metadata.criticalReply = criticalReply;
      break;
    }
  }

  if (metadata.lowered) stonefishV55SortFinalScores(game, finished);
  metadata.changedMove = Boolean(
    finished[0] && originalLeader && !stonefishV5SameMove(finished[0].raw, originalLeader.raw)
  );
  STONEFISH_V5_5_LAST_REFUTATION_GUARD = metadata;
  return metadata;
}

function stonefishV55LastRefutationGuard() {
  return STONEFISH_V5_5_LAST_REFUTATION_GUARD;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_REFUTATION_GUARD = STONEFISH_V5_5_REFUTATION_GUARD;
  globalThis.stonefishV55ApplyRefutationGuard = stonefishV55ApplyRefutationGuard;
  globalThis.stonefishV55LastRefutationGuard = stonefishV55LastRefutationGuard;
}

// Shared v5.5 fast-path refinements. These are defined after the native search
// core is loaded so they can replace duplicate board probes without changing any
// scoring constants, candidate widths, or evaluation semantics.
const STONEFISH_V5_5_REPEAT_HISTORY_CACHE = new WeakMap();

function stonefishV55HistoryHasTwofold(game) {
  const marker = `${game.historyStack.length}|${game.positionCounts.size}|${game.fullmove}|${game.halfmove}`;
  const cached = STONEFISH_V5_5_REPEAT_HISTORY_CACHE.get(game);
  if (cached && cached.marker === marker) return cached.value;
  let value = false;
  for (const count of game.positionCounts.values()) {
    if (count >= 2) { value = true; break; }
  }
  STONEFISH_V5_5_REPEAT_HISTORY_CACHE.set(game, { marker, value });
  return value;
}

stonefishV55BestResponseGain = function(game, responses) {
  let best = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const response = responses[i];
    const givesCheck = Boolean(game.fastGivesCheck && game.fastGivesCheck(response));
    if (givesCheck) {
      game.fastApply(response);
      const mate = !game.fastHasLegalMove();
      game.fastUndo();
      if (mate) return STONEFISH_V5_MATE;
    }

    let gain = STONEFISH_V5_PIECE[response.captured] || 0;
    if (response.promotion) gain += (STONEFISH_V5_PIECE[response.promotion] || 0) - 100;
    if (givesCheck) gain += 18;
    if (gain > best) best = gain;
  }
  return best;
};

stonefishV55TacticalScore = function(game, raw) {
  const historyDepth = game.historyStack.length;
  const checkReplyRepetition = stonefishV55HistoryHasTwofold(game);
  let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
  if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

  try {
    game.fastApply(raw);
    const replies = game.fastMoves();
    const rootChecking = game.in_check();
    if (!replies.length && rootChecking) return STONEFISH_V5_MATE * 2;

    const rootVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
    let repeatedReply = false;
    let score = 0;

    if (replies.length) {
      let worst = Infinity;
      for (let i = 0; i < replies.length; i += 1) {
        const reply = replies[i];
        let opponentGain = STONEFISH_V5_PIECE[reply.captured] || 0;
        if (reply.promotion) opponentGain += (STONEFISH_V5_PIECE[reply.promotion] || 0) - 100;

        game.fastApply(reply);
        const givesCheck = game.in_check();
        if (givesCheck) opponentGain += 14;
        if (checkReplyRepetition && (game.positionCounts.get(game.fastPositionKey()) || 0) >= 2) repeatedReply = true;

        const responses = game.fastMoves();
        if (givesCheck && !responses.length) return -STONEFISH_V5_MATE;
        const ourGain = stonefishV55BestResponseGain(game, responses);
        game.fastUndo();

        const branch = immediate - opponentGain + ourGain;
        if (branch < worst) worst = branch;
      }
      score = worst;
    }

    if (score >= STONEFISH_V5_MATE) score = STONEFISH_V5_MATE * 0.5;
    if (score <= -STONEFISH_V5_MATE) return -STONEFISH_V5_MATE;

    if (rootVisits > 0) {
      score -= rootVisits * 1200000;
      score = Math.max(score, STONEFISH_V5_DRAW_FLOOR);
    }
    if (repeatedReply) score = Math.min(score, STONEFISH_V5_DRAW_FLOOR);
    return score;
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
};

stonefishV55FastScoutScore = function(game, raw, bookMove, heritageMove, perspective, conversion) {
  const historyDepth = game.historyStack.length;
  let score = 0;
  const capture = STONEFISH_V5_PIECE[raw.captured] || 0;
  score += capture * 15 - (STONEFISH_V5_PIECE[raw.piece] || 0) * (raw.captured ? 0.15 : 0);
  if (raw.promotion) score += ((STONEFISH_V5_PIECE[raw.promotion] || 0) - 100) * 18 + 2400;
  if (raw.flags & (4 | 8)) score += 260;
  if (bookMove && stonefishV5SameMove(raw, bookMove)) score += 3600;
  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) score += 3000;
  score += conversion;

  try {
    game.fastApply(raw);
    const givesCheck = game.in_check();
    if (givesCheck) {
      score += 900;
      if (!game.fastHasLegalMove()) return STONEFISH_V5_PRO_MATE * 4;
    }

    const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
    if (enemyThreat >= 300) score -= enemyThreat * 9;
    else if (enemyThreat >= 120) score -= enemyThreat * 3;
    const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
    if (visits > 0) score -= visits * 240000;
    return score;
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
};

// Stonefish_v5_5_native.js
// Native v5.5: full legal-move alpha-beta and capture quiescence.
// Both variants call the same host and evaluation. An optional per-game reply
// policy supplies learned priorities and an effort request; the control uses
// the unchanged default budget.
const SF55C = {
  maxDepth: 4, nodes: 1200, multiPV: 3, qDepth: 5,
  piece: [0, 100, 325, 335, 510, 975, 0], mate: STONEFISH_V5_PRO_MATE,
};
const SF55C_PST = Array.from({length: 7}, () => new Int16Array(64));
const SF55C_EG = Array.from({length: 7}, () => new Int16Array(64));
for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7, r = sq >> 3;
  const center = 7 - Math.abs(2*f-7) - Math.abs(2*r-7);
  const fileCenter = 7 - Math.abs(2*f-7);
  SF55C_PST[1][sq] = r*7 + fileCenter*3 + (r >= 3 && f >= 2 && f <= 5 ? 14 : 0);
  SF55C_EG[1][sq] = r*r*5 + fileCenter;
  SF55C_PST[2][sq] = center*7 - (r === 0 ? 15 : 0);
  SF55C_EG[2][sq] = center*5;
  SF55C_PST[3][sq] = center*4 + r*3;
  SF55C_EG[3][sq] = center*3;
  SF55C_PST[4][sq] = r === 6 ? 30 : r*2;
  SF55C_EG[4][sq] = center*2;
  SF55C_PST[5][sq] = center*2 - (r > 2 ? 8 : 0);
  SF55C_EG[5][sq] = center*3;
  SF55C_PST[6][sq] = -center*5 - r*12 + (r === 0 && (f === 6 || f === 2) ? 45 : 0);
  SF55C_EG[6][sq] = center*8;
}

function sf55cEvaluateJS(g) {
  const b=g.boardState;
  let mg=0,eg=0,phase=0,wb=0,bb=0;
  const wp=new Int8Array(8),bp=new Int8Array(8);
  const whiteP=[],blackP=[];
  for(let sq=0;sq<64;sq++) {
    const p=b[sq]; if(!p)continue;
    const s=p>0?1:-1,t=Math.abs(p),ps=s>0?sq:(sq^56);
    mg+=s*(SF55C.piece[t]+SF55C_PST[t][ps]);
    eg+=s*(SF55C.piece[t]+SF55C_EG[t][ps]);
    phase+=t===2||t===3?1:t===4?2:t===5?4:0;
    if(t===1) {if(s>0){wp[sq&7]++;whiteP.push(sq);}else{bp[sq&7]++;blackP.push(sq);}}
    if(t===3){if(s>0)wb++;else bb++;}
  }
  const pawnScore=(pawns, own, opp, enemy, side)=>{
    let a=0,c=0;
    for(const sq of pawns){
      const f=sq&7,r=side>0?sq>>3:7-(sq>>3);
      if(own[f]>1){a-=12;c-=16;}
      if(!(f>0&&own[f-1])&&!(f<7&&own[f+1])){a-=11;c-=15;}
      let passed=true;
      for(const esq of enemy) if(Math.abs((esq&7)-f)<=1&&(side>0?esq>sq:esq<sq)){passed=false;break;}
      if(passed){
        a += [0,0,8,17,35,65,110,0][r];
        c += [0,0,15,32,65,120,210,0][r];
        if(r>=4){
          const prom=(side>0?56:0)+f;
          const ek=g.kingSq[-side],ok=g.kingSq[side];
          const ed=Math.max(Math.abs((ek&7)-f),Math.abs((ek>>3)-(prom>>3)));
          const od=Math.max(Math.abs((ok&7)-f),Math.abs((ok>>3)-(prom>>3)));
          c+=(ed-od)*r*3;
        }
      }
    }
    return [a,c];
  };
  const a=pawnScore(whiteP,wp,bp,blackP,1),c=pawnScore(blackP,bp,wp,whiteP,-1);
  mg+=a[0]-c[0];eg+=a[1]-c[1];
  if(wb>=2){mg+=30;eg+=45;}if(bb>=2){mg-=30;eg-=45;}
  for(let sq=0;sq<64;sq++){
    const p=b[sq];if(!p)continue;const t=Math.abs(p),s=p>0?1:-1,f=sq&7;
    if(t===4){const own=s>0?wp:bp,opp=s>0?bp:wp;if(!own[f]){mg+=s*(opp[f]?15:30);eg+=s*15;}}
    if(t===6){const step=s*8;let shield=0;for(let df=-1;df<=1;df++){if(f+df<0||f+df>7)continue;const x=sq+step+df;if(x>=0&&x<64&&b[x]===s)shield++;}mg+=s*shield*12;}
  }
  phase=Math.min(24,phase);
  let score=(mg*phase+eg*(24-phase))/24;
  // Help convert bare-king endings instead of endlessly checking from afar.
  if(phase<=4&&Math.abs(eg)>400){
    const winner=eg>0?1:-1,loser=g.kingSq[-winner],king=g.kingSq[winner];
    const edge=Math.max(Math.abs(2*(loser&7)-7),Math.abs(2*(loser>>3)-7));
    const proximity=14-Math.abs((king&7)-(loser&7))-Math.abs((king>>3)-(loser>>3));
    score+=winner*(edge*10+proximity*6);
  }
  return Math.round(score*g.side)+8;
}

function sf55cMoveId(m){return m.from|(m.to<<6)|((m.promotion||0)<<12);}
function sf55cOrder(ctx,m,tt,ply){
  const id=sf55cMoveId(m);
  if(id===tt)return 10000000;
  if(m.promotion)return 200000+SF55C.piece[m.promotion];
  if(m.captured)return 100000+SF55C.piece[m.captured]*16-SF55C.piece[m.piece];
  if(ctx.killers[ply]===id)return 90000;
  const history=ctx.history[id]||0;
  return history+(ctx.replyPolicy&&(ply&1)?ctx.replyPolicy.priority(m):0);
}

function sf55cInsufficient(g) {
  let minors = 0, knights = 0, color = -1, mixed = false;
  for (let sq = 0; sq < 64; sq++) {
    const piece = Math.abs(g.boardState[sq]);
    if (piece === 1 || piece === 4 || piece === 5) return false;
    if (piece === 2) { minors++; knights++; }
    if (piece === 3) {
      minors++;
      const squareColor = ((sq & 7) + (sq >> 3)) & 1;
      if (color !== -1 && color !== squareColor) mixed = true;
      color = squareColor;
    }
  }
  return minors <= 1 || (!knights && !mixed);
}
// Same exact repetition identity, formed without a long chain of strings.
// Keep the shared make/undo cache so every caller observes the original key.
function sf55cPositionKey(g) {
  if (g._stonefishRuntimePositionKey != null) return g._stonefishRuntimePositionKey;
  const b = g.boardState;
  const board = String.fromCharCode(
    b[0]+70, b[1]+70, b[2]+70, b[3]+70, b[4]+70, b[5]+70, b[6]+70, b[7]+70,
    b[8]+70, b[9]+70, b[10]+70, b[11]+70, b[12]+70, b[13]+70, b[14]+70, b[15]+70,
    b[16]+70, b[17]+70, b[18]+70, b[19]+70, b[20]+70, b[21]+70, b[22]+70, b[23]+70,
    b[24]+70, b[25]+70, b[26]+70, b[27]+70, b[28]+70, b[29]+70, b[30]+70, b[31]+70,
    b[32]+70, b[33]+70, b[34]+70, b[35]+70, b[36]+70, b[37]+70, b[38]+70, b[39]+70,
    b[40]+70, b[41]+70, b[42]+70, b[43]+70, b[44]+70, b[45]+70, b[46]+70, b[47]+70,
    b[48]+70, b[49]+70, b[50]+70, b[51]+70, b[52]+70, b[53]+70, b[54]+70, b[55]+70,
    b[56]+70, b[57]+70, b[58]+70, b[59]+70, b[60]+70, b[61]+70, b[62]+70, b[63]+70);
  return g._stonefishRuntimePositionKey = (g.side === 1 ? 'w|' : 'b|') + board + '|' + g.castling + '|' + g.ep;
}

// Packed native identities are exact: four board squares per code unit,
// plus one code unit for side, castling rights and en passant.
function sf55cPackedPositionKey(g){
  const b=g.boardState;
  return String.fromCharCode(((b[0]+6)|(b[1]+6)<<4|(b[2]+6)<<8|(b[3]+6)<<12),
    ((b[4]+6)|(b[5]+6)<<4|(b[6]+6)<<8|(b[7]+6)<<12),
    ((b[8]+6)|(b[9]+6)<<4|(b[10]+6)<<8|(b[11]+6)<<12),
    ((b[12]+6)|(b[13]+6)<<4|(b[14]+6)<<8|(b[15]+6)<<12),
    ((b[16]+6)|(b[17]+6)<<4|(b[18]+6)<<8|(b[19]+6)<<12),
    ((b[20]+6)|(b[21]+6)<<4|(b[22]+6)<<8|(b[23]+6)<<12),
    ((b[24]+6)|(b[25]+6)<<4|(b[26]+6)<<8|(b[27]+6)<<12),
    ((b[28]+6)|(b[29]+6)<<4|(b[30]+6)<<8|(b[31]+6)<<12),
    ((b[32]+6)|(b[33]+6)<<4|(b[34]+6)<<8|(b[35]+6)<<12),
    ((b[36]+6)|(b[37]+6)<<4|(b[38]+6)<<8|(b[39]+6)<<12),
    ((b[40]+6)|(b[41]+6)<<4|(b[42]+6)<<8|(b[43]+6)<<12),
    ((b[44]+6)|(b[45]+6)<<4|(b[46]+6)<<8|(b[47]+6)<<12),
    ((b[48]+6)|(b[49]+6)<<4|(b[50]+6)<<8|(b[51]+6)<<12),
    ((b[52]+6)|(b[53]+6)<<4|(b[54]+6)<<8|(b[55]+6)<<12),
    ((b[56]+6)|(b[57]+6)<<4|(b[58]+6)<<8|(b[59]+6)<<12),
    ((b[60]+6)|(b[61]+6)<<4|(b[62]+6)<<8|(b[63]+6)<<12),
    (g.side===1?1:0)|(g.castling<<1)|((g.ep+1)<<5));
}
function sf55cPackHistoryKey(key){
  const tail=key.slice(67).split('|');
  return String.fromCharCode(((key.charCodeAt(2)-64)|(key.charCodeAt(3)-64)<<4|(key.charCodeAt(4)-64)<<8|(key.charCodeAt(5)-64)<<12),
    ((key.charCodeAt(6)-64)|(key.charCodeAt(7)-64)<<4|(key.charCodeAt(8)-64)<<8|(key.charCodeAt(9)-64)<<12),
    ((key.charCodeAt(10)-64)|(key.charCodeAt(11)-64)<<4|(key.charCodeAt(12)-64)<<8|(key.charCodeAt(13)-64)<<12),
    ((key.charCodeAt(14)-64)|(key.charCodeAt(15)-64)<<4|(key.charCodeAt(16)-64)<<8|(key.charCodeAt(17)-64)<<12),
    ((key.charCodeAt(18)-64)|(key.charCodeAt(19)-64)<<4|(key.charCodeAt(20)-64)<<8|(key.charCodeAt(21)-64)<<12),
    ((key.charCodeAt(22)-64)|(key.charCodeAt(23)-64)<<4|(key.charCodeAt(24)-64)<<8|(key.charCodeAt(25)-64)<<12),
    ((key.charCodeAt(26)-64)|(key.charCodeAt(27)-64)<<4|(key.charCodeAt(28)-64)<<8|(key.charCodeAt(29)-64)<<12),
    ((key.charCodeAt(30)-64)|(key.charCodeAt(31)-64)<<4|(key.charCodeAt(32)-64)<<8|(key.charCodeAt(33)-64)<<12),
    ((key.charCodeAt(34)-64)|(key.charCodeAt(35)-64)<<4|(key.charCodeAt(36)-64)<<8|(key.charCodeAt(37)-64)<<12),
    ((key.charCodeAt(38)-64)|(key.charCodeAt(39)-64)<<4|(key.charCodeAt(40)-64)<<8|(key.charCodeAt(41)-64)<<12),
    ((key.charCodeAt(42)-64)|(key.charCodeAt(43)-64)<<4|(key.charCodeAt(44)-64)<<8|(key.charCodeAt(45)-64)<<12),
    ((key.charCodeAt(46)-64)|(key.charCodeAt(47)-64)<<4|(key.charCodeAt(48)-64)<<8|(key.charCodeAt(49)-64)<<12),
    ((key.charCodeAt(50)-64)|(key.charCodeAt(51)-64)<<4|(key.charCodeAt(52)-64)<<8|(key.charCodeAt(53)-64)<<12),
    ((key.charCodeAt(54)-64)|(key.charCodeAt(55)-64)<<4|(key.charCodeAt(56)-64)<<8|(key.charCodeAt(57)-64)<<12),
    ((key.charCodeAt(58)-64)|(key.charCodeAt(59)-64)<<4|(key.charCodeAt(60)-64)<<8|(key.charCodeAt(61)-64)<<12),
    ((key.charCodeAt(62)-64)|(key.charCodeAt(63)-64)<<4|(key.charCodeAt(64)-64)<<8|(key.charCodeAt(65)-64)<<12),
    (key[0]==='w'?1:0)|(Number(tail[0])<<1)|((Number(tail[1])+1)<<5));
}

// Stable ordering evaluates each priority once without modifying move objects.
function sf55cOrderMoves(moves,ctx,tt,ply){
 if(moves.length<2)return;
 const orderPriorities=ctx.orderPriorities||(ctx.orderPriorities=[]);
 let priorities=orderPriorities[ply];
 if(!priorities||priorities.length<moves.length)priorities=orderPriorities[ply]=new Int32Array(moves.length);
 priorities[0]=sf55cOrder(ctx,moves[0],tt,ply);
 for(let i=1;i<moves.length;i++){
  const move=moves[i],priority=sf55cOrder(ctx,move,tt,ply);let j=i-1;
  while(j>=0&&priorities[j]<priority){moves[j+1]=moves[j];priorities[j+1]=priorities[j];j--;}
  moves[j+1]=move;priorities[j+1]=priority;
 }
}

// A pawn, rook or queen rules out insufficient material. Carry this count
// through make/undo, and still inspect minor-only endings in full.
function sf55cMaterialMoveDelta(move){
 return (move.captured===1||move.captured===4||move.captured===5?1:0)
  +(move.piece===1&&move.promotion&&(move.promotion===2||move.promotion===3)?1:0);
}

// Search-local make/undo keeps the exact Chess state transitions while avoiding
// generic history/cache-frame allocation at every speculative node. Real game
// history and runtime memo fields remain untouched throughout the search.
function sf55cEnsureUndo(ctx){
 if(ctx.undoCaptured)return;
 ctx.undoCaptured=new Int8Array(64);
 ctx.undoCastling=new Int8Array(64);
 ctx.undoEp=new Int8Array(64);
 ctx.undoHalfmove=new Int32Array(64);
 ctx.undoFullmove=new Int32Array(64);
 ctx.undoKingW=new Int8Array(64);
 ctx.undoKingB=new Int8Array(64);
 ctx.undoSide=new Int8Array(64);
 ctx.moveStack=new Array(64);
}
function sf55cApply(g,ctx,move,ply){
 sf55cEnsureUndo(ctx);
 const b=g.boardState,side=g.side;
 const capturedPiece=move.flags&2?b[move.to+(side===1?-8:8)]:b[move.to];
 ctx.undoCaptured[ply]=capturedPiece;
 ctx.undoCastling[ply]=g.castling;
 ctx.undoEp[ply]=g.ep;
 ctx.undoHalfmove[ply]=g.halfmove;
 ctx.undoFullmove[ply]=g.fullmove;
 ctx.undoKingW[ply]=g.kingSq[1];
 ctx.undoKingB[ply]=g.kingSq[-1];
 ctx.undoSide[ply]=side;
 ctx.moveStack[ply]=move;
 const moving=b[move.from];
 b[move.to]=moving;b[move.from]=0;
 if(move.flags&2)b[move.to+(side===1?-8:8)]=0;
 if(move.promotion)b[move.to]=side*move.promotion;
 if(Math.abs(moving)===6){
  g.kingSq[side]=move.to;
  if(side===1)g.castling&=~3;else g.castling&=~12;
  if(move.flags&4){const rf=side===1?7:63,rt=side===1?5:61;b[rt]=b[rf];b[rf]=0;}
  else if(move.flags&8){const rf=side===1?0:56,rt=side===1?3:59;b[rt]=b[rf];b[rf]=0;}
 }
 if(move.from===0||move.to===0)g.castling&=~2;
 if(move.from===7||move.to===7)g.castling&=~1;
 if(move.from===56||move.to===56)g.castling&=~8;
 if(move.from===63||move.to===63)g.castling&=~4;
 g.ep=-1;
 if(Math.abs(moving)===1&&Math.abs(move.to-move.from)===16)g.ep=(move.from+move.to)>>1;
 g.halfmove=(Math.abs(moving)===1||capturedPiece)?0:g.halfmove+1;
 if(side===-1)g.fullmove++;
 g.side=-side;
 if(g._sf55cKernelSearchActive)g._sf55cKernelDirty=true;
}
function sf55cUndo(g,ctx,move,ply){
 const side=ctx.undoSide[ply],b=g.boardState,capturedPiece=ctx.undoCaptured[ply];
 g.side=side;g.castling=ctx.undoCastling[ply];g.ep=ctx.undoEp[ply];
 g.halfmove=ctx.undoHalfmove[ply];g.fullmove=ctx.undoFullmove[ply];
 g.kingSq[1]=ctx.undoKingW[ply];g.kingSq[-1]=ctx.undoKingB[ply];
 b[move.from]=side*move.piece;b[move.to]=capturedPiece;
 if(move.flags&2){b[move.to]=0;b[move.to+(side===1?-8:8)]=capturedPiece;}
 if(move.flags&4){const rf=side===1?7:63,rt=side===1?5:61;b[rf]=b[rt];b[rt]=0;}
 else if(move.flags&8){const rf=side===1?0:56,rt=side===1?3:59;b[rf]=b[rt];b[rt]=0;}
 ctx.moveStack[ply]=null;
 if(g._sf55cKernelSearchActive)g._sf55cKernelDirty=true;
}

function sf55cDraw(g,ctx,key) {
  if(g.halfmove>=100)return true;
  // A third occurrence needs eight reversible plies. Public history keys keep
  // their original representation; convert them once when this search needs it.
  if(g.halfmove>=8&&key){
    let counts=g.positionCounts;
    if(key.length===17){
      if(!ctx.compactCounts)ctx.compactCounts=new Map(Array.from(g.positionCounts,([k,v])=>[sf55cPackHistoryKey(k),v]));
      counts=ctx.compactCounts;
    }
    const pathId=ctx.positionIds.get(key);
    const pathCount=ctx.pathCounts
      ?(pathId===undefined?0:(ctx.pathCounts[pathId]||0))
      :(ctx.path?(ctx.path.get(key)||0):0);
    if((counts.get(key)||0)+pathCount+1>=3)return true;
  }
  return !(ctx.material>0)&&sf55cInsufficient(g);
}

function sf55cEnter(ctx,key) {
  if (key === null) return;
  if(ctx.pathSignature===undefined){ctx.pathSignature=0;ctx.pathSignatureStack=[];ctx.pathSignatureIds=new Map();}
  let id=ctx.positionIds.get(key);
  if(id===undefined){id=ctx.positionIds.size+1;ctx.positionIds.set(key,id);}
  if(ctx.pathCounts)ctx.pathCounts[id]=(ctx.pathCounts[id]||0)+1;
  else if(ctx.path)ctx.path.set(key,(ctx.path.get(key)||0)+1);
  const parent=ctx.pathSignature,pair=parent*16384+id;
  let signature=ctx.pathSignatureIds.get(pair);
  if(signature===undefined){signature=ctx.pathSignatureIds.size+1;ctx.pathSignatureIds.set(pair,signature);}
  ctx.pathSignatureStack.push(parent);
  ctx.pathSignature=signature;
}
function sf55cExit(ctx,key) {
  if (key === null) return;
  const id=ctx.positionIds.get(key);
  if(ctx.pathCounts)ctx.pathCounts[id]--;
  else if(ctx.path){
    const count=ctx.path.get(key)-1;
    if(count)ctx.path.set(key,count);else ctx.path.delete(key);
  }
  ctx.pathSignature=ctx.pathSignatureStack.pop();
}

// Capture/promotion-only legal generation for quiet quiescence nodes. Keep the
// normal move order, including all four underpromotions and en passant.
function sf55cTacticalMovesJS(g) {
  const board = g.boardState, side = g.side, moves = [];
  const safety = stonefishRuntimeKingSafety(g);
  const emit = (from, to, piece, promotion = 0, flags = 0) => {
    const move = { from, to, piece, promotion, flags,
      captured: flags & 2 ? 1 : Math.abs(board[to]) };
    if ((!safety.inCheck && piece !== 6 && !(flags & 2)
      && !stonefishRuntimeIsPinned(safety, from)) || g._testLegalRaw(move)) moves.push(move);
  };
  for (let from = 0; from < 64; from++) {
    const value = board[from];
    if (!value || (value > 0 ? 1 : -1) !== side) continue;
    const piece = Math.abs(value), file = from & 7, rank = from >> 3;
    if (piece === 1) {
      const step = side * 8, promotionRank = side === 1 ? 7 : 0;
      const forward = from + step;
      if (forward >= 0 && forward < 64 && (forward >> 3) === promotionRank && !board[forward]) {
        for (const promotion of [5, 4, 3, 2]) emit(from, forward, piece, promotion);
      }
      for (let df = -1; df <= 1; df += 2) {
        const to = from + step + df;
        if (file + df < 0 || file + df > 7 || to < 0 || to >= 64) continue;
        if (board[to] * side < 0) {
          if ((to >> 3) === promotionRank) {
            for (const promotion of [5, 4, 3, 2]) emit(from, to, piece, promotion);
          } else emit(from, to, piece);
        } else if (to === g.ep) emit(from, to, piece, 0, 2);
      }
      continue;
    }
    if (piece === 2) {
      for (let i = 0; i < 8; i++) {
        const f = file + SF_KNIGHT_DF[i], r = rank + SF_KNIGHT_DR[i];
        if (f >= 0 && f < 8 && r >= 0 && r < 8 && board[r * 8 + f] * side < 0)
          emit(from, r * 8 + f, piece);
      }
      continue;
    }
    const directions = piece === 3 ? SF_DIAG_DIRS : piece === 4 ? SF_ORTH_DIRS : SF_ALL_DIRS;
    for (let i = 0; i < directions.length; i += 2) {
      let f = file + directions[i], r = rank + directions[i + 1];
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const to = r * 8 + f;
        if (board[to]) { if (board[to] * side < 0) emit(from, to, piece); break; }
        if (piece === 6) break;
        f += directions[i]; r += directions[i + 1];
      }
    }
  }
  return moves;
}
function sf55cQ(g,ctx,alpha,beta,ply,remaining){
  ctx.nodes++;
  const check=sf55cInCheck(g);
  // Captures and pawn moves cannot repeat an earlier position. Avoid building
  // board keys in these common quiescence nodes.
  const key=g.halfmove ? sf55cPackedPositionKey(g) : null;
  let moves=check ? sf55cLegalMoves(g,ctx,ply) : null;
  if(check && !moves.length)return -SF55C.mate+ply;
  if(sf55cDraw(g,ctx,key))return 0;
  if(ctx.nodes>ctx.limit&&ctx.depth>2){
    if(!check && !sf55cHasLegalMove(g))return 0;
    ctx.abort=true;return sf55cEvaluate(g);
  }
  let stand=check?-SF55C.mate:sf55cEvaluate(g);
  if(ply>20)return !check && !sf55cHasLegalMove(g) ? 0 : sf55cEvaluate(g);
  if(!check){
    if(stand>=beta || remaining<=0)return sf55cHasLegalMove(g) ? stand : 0;
    if(stand>alpha)alpha=stand;
    moves=sf55cTacticalMoves(g,ctx,ply);
    if(!moves.length)return sf55cHasLegalMove(g) ? stand : 0;
  }
  sf55cOrderMoves(moves,ctx,0,ply);
  sf55cEnter(ctx,key);
  try {
    for(const m of moves){
      if(!check&&!m.promotion&&stand+SF55C.piece[m.captured]+160<alpha)continue;
      let score;
      const materialDelta=sf55cMaterialMoveDelta(m);ctx.material-=materialDelta;sf55cApply(g,ctx,m,ply+1);
      try {score=-sf55cQ(g,ctx,-beta,-alpha,ply+1,remaining-1);}finally{sf55cUndo(g,ctx,m,ply+1);ctx.material+=materialDelta;}
      if(ctx.abort)break;
      if(score>stand)stand=score;if(score>alpha)alpha=score;if(alpha>=beta)break;
    }
  }finally{sf55cExit(ctx,key);}
  return stand;
}

function sf55cSearch(g,ctx,depth,alpha,beta,ply){
  if(depth<=0)return sf55cQ(g,ctx,alpha,beta,ply,SF55C.qDepth);
  // A learned low-priority quiet reply may receive a reduced null-window
  // probe. Verify at full depth whenever that probe favors the opponent.
  // With no learned policy this path is completely inactive.
  if(ctx.replyPolicy&&depth===1&&ply>=2&&!(ply&1)&&beta-alpha<=1){
    const state=g.historyStack[g.historyStack.length-1];
    const move=ctx.moveStack&&ctx.moveStack[ply]||state&&state.move;
    if(move&&!move.captured&&!move.promotion&&move.piece!==6&&!sf55cInCheck(g)
      &&ctx.replyPolicy.isLowPriority(move)){
      const probe=sf55cQ(g,ctx,alpha,beta,ply,SF55C.qDepth);
      if(ctx.abort||probe>=beta)return probe;
    }
  }
  ctx.nodes++;
  const key=sf55cPackedPositionKey(g);
  // Halfmove clock, mate distance, and the speculative repetition path are part
  // of the cache identity. A value from another history cannot hide a draw.
  const ttMeta=g.halfmove+(ply<<7)+(ctx.pathSignature<<13);
  const ttBucket=ctx.tt.get(key);
  let hit=-1;
  if(ttBucket)for(let i=0;i<ttBucket.length;i+=5){if(ttBucket[i]===ttMeta){hit=i;break;}}
  const original=alpha;
  // A stored entry can only come from a non-terminal, non-draw node. While the
  // node budget is still live, the exact same TT cutoff can therefore happen
  // before legal-move generation. Over-budget nodes retain the original order:
  // terminal -> draw -> abort -> TT.
  const budgetLive=ctx.nodes<=ctx.limit||ctx.depth<=2;
  if(budgetLive&&hit>=0&&ttBucket[hit+1]>=depth){
    const hitScore=ttBucket[hit+2],hitFlag=ttBucket[hit+4];
    if(hitFlag===0)return hitScore;
    if(hitFlag===1&&hitScore>=beta)return hitScore;
    if(hitFlag===-1&&hitScore<=alpha)return hitScore;
  }
  const check=sf55cInCheck(g),moves=sf55cLegalMoves(g,ctx,ply);
  if(!moves.length)return check?-SF55C.mate+ply:0;
  if(sf55cDraw(g,ctx,key))return 0;
  if(!budgetLive){ctx.abort=true;return sf55cEvaluate(g);}
  sf55cOrderMoves(moves,ctx,hit>=0?ttBucket[hit+3]:0,ply);
  let best=-Infinity,bestMove=0,index=0;
  sf55cEnter(ctx,key);
  try {
    for(const m of moves){
      let score;
      const materialDelta=sf55cMaterialMoveDelta(m);ctx.material-=materialDelta;sf55cApply(g,ctx,m,ply+1);
      try {
        if(index===0)score=-sf55cSearch(g,ctx,depth-1,-beta,-alpha,ply+1);
        else{
          const quietLate=!check&&!m.captured&&!m.promotion&&!sf55cInCheck(g);
          const learnedFastReduction=Boolean(
            typeof process!=='undefined'&&process.env&&ctx.replyPolicy&&(ply&1)
              &&(process.env.ARMX_POLICY_LMR==='1'
                ||(process.env.ARMX_FAST_SCREEN==='1'&&process.env.ARMX_FAST_POLICY_LMR==='1'))
              &&depth>=3&&index>=2&&quietLate&&ctx.replyPolicy.isLowPriority(m)
          );
          const reduce=learnedFastReduction?Math.min(2,depth-1):(depth>=3&&index>=4&&quietLate?1:0);
          score=-sf55cSearch(g,ctx,depth-1-reduce,-alpha-1,-alpha,ply+1);
          if(!ctx.abort&&score>alpha&&(reduce||score<beta))score=-sf55cSearch(g,ctx,depth-1,-beta,-alpha,ply+1);
        }
      }finally{sf55cUndo(g,ctx,m,ply+1);ctx.material+=materialDelta;}
      if(ctx.abort)break;
      if(score>best){best=score;bestMove=sf55cMoveId(m);}
      if(score>alpha)alpha=score;
      if(alpha>=beta){if(!m.captured){ctx.killers[ply]=bestMove;ctx.history[bestMove]=(ctx.history[bestMove]||0)+depth*depth;}break;}
      index++;
    }
  }finally{sf55cExit(ctx,key);}
  if(!ctx.abort){
    let bucket=ctx.tt.get(key);if(!bucket){bucket=[];ctx.tt.set(key,bucket);}
    let slot=-1;
    for(let i=0;i<bucket.length;i+=5){if(bucket[i]===ttMeta){slot=i;break;}}
    if(slot<0){slot=bucket.length;bucket.length+=5;}
    bucket[slot]=ttMeta;bucket[slot+1]=depth;bucket[slot+2]=best;bucket[slot+3]=bestMove;
    bucket[slot+4]=best<=original?-1:best>=beta?1:0;
  }
  return best;
}


function sf55cPublicHistoryCodes(g,historyKey){
  let cache=g._sf55cPublicHistoryCodeCache;
  if(!cache)cache=g._sf55cPublicHistoryCodeCache=new Map();
  let codes=cache.get(historyKey);
  if(codes)return codes;
  const packed=historyKey.length===17?historyKey:sf55cPackHistoryKey(historyKey);
  codes=new Uint16Array(17);
  for(let i=0;i<17;i++)codes[i]=packed.charCodeAt(i);
  cache.set(historyKey,codes);
  return codes;
}

function sf55cReplyPolicyNodeLimit(replyPolicy,requested){
  // Preview's earned budget can already reach SF55C.nodes + 8400. Full ARMX's
  // maxExtraNodes is additional to that Preview ceiling, not a replacement
  // ceiling that would silently erase Preview-earned search.
  const extraCap=Number.isFinite(replyPolicy&&replyPolicy.maxExtraNodes)
    ?Math.max(0,Math.min(120000,Math.round(replyPolicy.maxExtraNodes))):0;
  const maximum=SF55C.nodes+8400+extraCap;
  return Number.isFinite(requested)
    ?Math.max(SF55C.nodes,Math.min(maximum,Math.round(requested))):SF55C.nodes;
}
function sf55cReplyPolicyDepthLimit(replyPolicy,requested){
  const extraCap=Number.isFinite(replyPolicy&&replyPolicy.maxExtraDepth)
    ?Math.max(2,Math.min(6,Math.round(replyPolicy.maxExtraDepth))):2;
  return Number.isFinite(requested)
    ?Math.max(SF55C.maxDepth,Math.min(SF55C.maxDepth+extraCap,Math.round(requested))):SF55C.maxDepth;
}

function sf55cNativeAcceleratedHost(g,replyPolicy){
  const k=SF55C_KERNEL;
  if(!k||!k.api.search_all||!k.scores||!k.policyWeights||!replyPolicy)return null;
  k.board.set(g.boardState);
  k.policyWeights.fill(0);
  if(replyPolicy.weights)k.policyWeights.set(replyPolicy.weights);

  // Preserve the frozen Preview hot path. Full-ARMX-only controls are absent
  // from ARMX Preview, so ordinary v5.5 should not pay generalized-policy
  // plumbing overhead on every move.
  const extendedPolicy=Number.isFinite(replyPolicy.rootWidth)
    ||Number.isFinite(replyPolicy.maxExtraNodes)
    ||Number.isFinite(replyPolicy.maxExtraDepth);
  if(!extendedPolicy){
    const limit=Number.isFinite(replyPolicy.searchBudget)
      ?Math.max(SF55C.nodes,Math.min(SF55C.nodes+8400,Math.round(replyPolicy.searchBudget))):SF55C.nodes;
    const depthLimit=Number.isFinite(replyPolicy.maxDepth)
      ?Math.max(SF55C.maxDepth,Math.min(SF55C.maxDepth+2,Math.round(replyPolicy.maxDepth))):SF55C.maxDepth;
    let publicHistoryCount=0;
    if(k.publicKeys&&k.publicCounts){
      for(const [historyKey,countValue] of g.positionCounts){
        if(publicHistoryCount>=512)break;
        const codes=sf55cPublicHistoryCodes(g,historyKey);
        const offset=publicHistoryCount*17;
        for(let i=0;i<17;i++)k.publicKeys[offset+i]=codes[i];
        k.publicCounts[publicHistoryCount]=countValue;
        publicHistoryCount++;
      }
    }
    const count=k.api.search_all(
      g.side,g.castling,g.ep,g.kingSq[1],g.kingSq[-1],g.halfmove,
      depthLimit,limit,SF55C.qDepth,1,publicHistoryCount);
    const finished=new Array(count);
    for(let i=0;i<count;i++){
      const m=k.moves[i],raw={from:m&63,to:(m>>>6)&63,piece:(m>>>12)&7,
        captured:(m>>>15)&7,promotion:(m>>>18)&7,flags:m>>>21};
      const exact=!k.exact||k.exact[i]!==0;
      const score=exact?k.scores[i]:-Infinity;
      finished[i]={raw,uci:stonefishV45RawUci(g,raw),score,deep:exact?k.scores[i]:null,
        preliminary:exact?k.scores[i]:null,tactical:0,knowledge:0,conversion:0,exact};
    }
    finished.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
    return {finished,fastLeader:finished.length?finished[0].raw:null,
      refutationGuard:{eligible:false,verified:false,nativeFullWidth:true,compiledSearch:true},
      nodes:k.api.search_nodes?k.api.search_nodes():limit,
      depth:k.api.search_depth?k.api.search_depth():depthLimit,
      searchBudget:limit,depthLimit};
  }

  const limit=sf55cReplyPolicyNodeLimit(replyPolicy,replyPolicy.searchBudget);
  const depthLimit=sf55cReplyPolicyDepthLimit(replyPolicy,replyPolicy.maxDepth);
  let publicHistoryCount=0;
  if(k.publicKeys&&k.publicCounts){
    for(const [historyKey,countValue] of g.positionCounts){
      if(publicHistoryCount>=512)break;
      const codes=sf55cPublicHistoryCodes(g,historyKey);
      const offset=publicHistoryCount*17;
      for(let i=0;i<17;i++)k.publicKeys[offset+i]=codes[i];
      k.publicCounts[publicHistoryCount]=countValue;
      publicHistoryCount++;
    }
  }
  const rootWidth=replyPolicy&&Number.isFinite(replyPolicy.rootWidth)
    ?Math.max(SF55C.multiPV,Math.min(12,Math.round(replyPolicy.rootWidth))):SF55C.multiPV;
  const supportsRequestedWidth = rootWidth > SF55C.multiPV && !!k.api.search_all_width;
  const searchAll = supportsRequestedWidth
    ? k.api.search_all_width : k.api.search_all;
  const count = supportsRequestedWidth
    ? searchAll(
      g.side,g.castling,g.ep,g.kingSq[1],g.kingSq[-1],g.halfmove,
      depthLimit,limit,SF55C.qDepth,1,publicHistoryCount,rootWidth)
    : searchAll(
      g.side,g.castling,g.ep,g.kingSq[1],g.kingSq[-1],g.halfmove,
      depthLimit,limit,SF55C.qDepth,1,publicHistoryCount);
  const finished=new Array(count);
  for(let i=0;i<count;i++){
    const m=k.moves[i],raw={from:m&63,to:(m>>>6)&63,piece:(m>>>12)&7,
      captured:(m>>>15)&7,promotion:(m>>>18)&7,flags:m>>>21};
    const exact=!k.exact||k.exact[i]!==0;
    const score=exact?k.scores[i]:-Infinity;
    finished[i]={raw,uci:stonefishV45RawUci(g,raw),score,deep:exact?k.scores[i]:null,
      preliminary:exact?k.scores[i]:null,tactical:0,knowledge:0,conversion:0,exact};
  }
  finished.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  const result={finished,fastLeader:finished.length?finished[0].raw:null,
    refutationGuard:{eligible:false,verified:false,nativeFullWidth:true,compiledSearch:true},
    nodes:k.api.search_nodes?k.api.search_nodes():limit,
    depth:k.api.search_depth?k.api.search_depth():depthLimit,
    searchBudget:limit,depthLimit,
    requestedRootWidth:rootWidth,
    rootWidth:supportsRequestedWidth?rootWidth:SF55C.multiPV};
  return result;
}

function sf55cHost(g,replyPolicy=null){
  if(replyPolicy&&!(typeof process!=='undefined'&&process.env&&process.env.ARMX_COMPILED_EXPERIMENT==='0')){
    const accelerated=sf55cNativeAcceleratedHost(g,replyPolicy);
    if(accelerated){globalThis.SF55C_LAST=accelerated;return accelerated;}
  }
  sf55cSyncKernelConfig();
  g._sf55cKernelSearchActive=true;g._sf55cKernelDirty=true;
  const legal=sf55cLegalMoves(g);if(!legal.length){g._sf55cKernelSearchActive=false;g._sf55cKernelDirty=true;return {finished:[],fastLeader:null,refutationGuard:null};}
  const requested=replyPolicy&&replyPolicy.searchBudget;
  const limit=sf55cReplyPolicyNodeLimit(replyPolicy,requested);
  const requestedDepth=replyPolicy&&replyPolicy.maxDepth;
  const depthLimit=sf55cReplyPolicyDepthLimit(replyPolicy,requestedDepth);
  const rootWidth=replyPolicy&&Number.isFinite(replyPolicy.rootWidth)
    ?Math.max(SF55C.multiPV,Math.min(12,Math.round(replyPolicy.rootWidth))):SF55C.multiPV;
  const ctx={nodes:0,limit,depth:0,abort:false,tt:new Map(),pathCounts:[],pathSignature:0,pathSignatureStack:[],pathSignatureIds:new Map(),positionIds:new Map(),killers:[],history:new Int32Array(32768),orderPriorities:[],moveBuffers:[],replyPolicy,rootWidth};
  ctx.material=0;for(const piece of g.boardState){const type=Math.abs(piece);if(type===1||type===4||type===5)ctx.material++;}
  let roots=legal.map(raw=>({raw,uci:stonefishV45RawUci(g,raw),score:0,deep:0,preliminary:0,tactical:0,knowledge:0,conversion:0}));
  for(const e of roots){sf55cApply(g,ctx,e.raw,1);try{e.score=-sf55cEvaluate(g);}finally{sf55cUndo(g,ctx,e.raw,1);}}
  roots.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  let complete=roots;
  for(let depth=1;depth<=depthLimit;depth++){
    ctx.depth=depth;
    const next=[];let threshold=-SF55C.mate;
    for(const previous of complete){
      const e={...previous};const materialDelta=sf55cMaterialMoveDelta(e.raw);ctx.material-=materialDelta;sf55cApply(g,ctx,e.raw,1);
      try{e.score=-sf55cSearch(g,ctx,depth-1,-SF55C.mate,-threshold,1);}finally{sf55cUndo(g,ctx,e.raw,1);ctx.material+=materialDelta;}
      if(ctx.abort)break;
      e.exact=e.score>threshold || threshold===-SF55C.mate;
      e.deep=e.score;e.preliminary=e.score;
      next.push(e);next.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
      if(next.length>=rootWidth)threshold=next[rootWidth-1].score;
    }
    if(ctx.abort)break;
    complete=next;
    if(Math.abs(complete[0].score)>SF55C.mate-100)break;
  }
  // Only completed, exact root scores are eligible for opponent adaptation.
  // Keep scores in centipawns; forced mates share the existing host's mate scale.
  for(const e of complete){if(!e.exact){e.score=-Infinity;e.deep=null;}}
  complete.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  const result={finished:complete,fastLeader:complete[0].raw,refutationGuard:{eligible:false,verified:false,nativeFullWidth:true}};
  result.nodes=ctx.nodes;result.depth=ctx.depth-(ctx.abort?1:0);
  result.searchBudget=ctx.limit;
  result.depthLimit=depthLimit;
  result.rootWidth=rootWidth;
  globalThis.SF55C_LAST=result;
  g._sf55cKernelSearchActive=false;g._sf55cKernelDirty=true;
  return result;
}

globalThis.SF55C=SF55C;

// BEGIN GENERATED V55 WASM
// Zig 0.14.1; SHA-256 e3b92ee9736634e0c2350715891b8393f2518767efdd0f500bc74bb9a8597a0a
const SF55C_WASM_BYTES=new Uint8Array([
  0,97,115,109,1,0,0,0,1,102,13,96,0,1,127,96,3,127,127,127,1,127,96,9,127,127,127,127,127,127,127,127,127,0,96,2,127,127,1,127,96,5,127,127,127,127,127,1,127,96,4,127,127,127,127,1,127,96,3,127,127,126,1,127,
  96,11,127,127,127,127,127,127,127,127,127,127,127,1,127,96,4,127,127,127,127,0,96,1,127,1,127,96,3,127,127,127,0,96,6,127,127,127,127,127,127,1,127,96,2,127,127,0,3,32,31,0,0,0,1,2,3,3,4,5,6,6,0,0,
  0,0,0,0,0,1,7,3,8,9,10,11,12,10,4,9,9,5,5,3,1,0,48,6,9,1,127,1,65,192,172,189,1,11,7,222,1,16,6,109,101,109,111,114,121,2,0,9,98,111,97,114,100,95,112,116,114,0,0,10,99,111,110,102,
  105,103,95,112,116,114,0,1,9,109,111,118,101,115,95,112,116,114,0,2,8,101,118,97,108,117,97,116,101,0,3,8,105,110,95,99,104,101,99,107,0,5,8,103,101,110,101,114,97,116,101,0,7,10,115,99,111,114,101,115,95,112,116,114,
  0,11,9,101,120,97,99,116,95,112,116,114,0,12,10,112,111,108,105,99,121,95,112,116,114,0,13,15,112,117,98,108,105,99,95,107,101,121,115,95,112,116,114,0,14,17,112,117,98,108,105,99,95,99,111,117,110,116,115,95,112,116,114,0,
  15,12,115,101,97,114,99,104,95,110,111,100,101,115,0,16,12,115,101,97,114,99,104,95,100,101,112,116,104,0,17,20,115,101,97,114,99,104,95,101,118,97,108,117,97,116,101,95,102,97,115,116,0,18,10,115,101,97,114,99,104,95,97,108,
  108,0,19,10,172,145,2,31,8,0,65,240,137,128,128,0,11,8,0,65,176,138,128,128,0,11,8,0,65,208,166,128,128,0,11,202,9,4,1,127,1,123,15,127,1,124,35,128,128,128,128,0,65,208,4,107,34,3,36,128,128,128,128,0,
  32,3,65,176,4,106,65,16,106,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,34,4,253,11,4,0,32,3,32,4,253,11,4,176,4,32,3,65,144,4,106,65,16,106,32,4,253,11,4,0,32,3,32,4,253,11,4,
  144,4,65,0,33,5,65,0,33,6,65,0,33,7,65,0,33,8,65,0,33,9,65,0,33,10,65,0,33,11,65,0,33,12,3,64,2,64,32,12,65,240,137,128,128,0,106,44,0,0,34,13,69,13,0,65,1,33,14,32,13,32,13,192,
  65,7,117,34,15,115,32,15,107,34,16,65,255,1,113,34,15,65,8,116,32,12,32,12,65,56,115,32,13,65,0,74,34,17,27,65,2,116,114,34,18,65,204,152,128,128,0,106,40,2,0,32,15,65,2,116,65,176,138,128,128,0,106,40,
  2,0,34,19,106,65,1,65,127,32,17,27,34,17,108,32,6,106,33,6,32,18,65,204,138,128,128,0,106,40,2,0,32,19,106,32,17,108,32,5,106,33,5,2,64,2,64,2,64,32,16,65,254,1,113,65,2,70,13,0,65,2,33,14,
  32,15,65,4,71,13,1,11,32,14,32,7,106,33,7,12,1,11,32,15,65,5,70,65,2,116,32,7,106,33,7,32,15,65,1,71,13,0,32,12,65,7,113,33,15,2,64,32,13,65,1,72,13,0,32,3,65,144,2,106,32,10,65,2,
  116,106,32,12,54,2,0,32,3,65,176,4,106,32,15,65,2,116,106,34,13,32,13,40,2,0,65,1,106,54,2,0,32,10,65,1,106,33,10,12,2,11,32,3,65,16,106,32,11,65,2,116,106,32,12,54,2,0,32,3,65,144,4,106,
  32,15,65,2,116,106,34,13,32,13,40,2,0,65,1,106,54,2,0,32,11,65,1,106,33,11,12,1,11,32,15,65,3,71,13,0,2,64,32,13,65,1,72,13,0,32,8,65,1,106,33,8,12,1,11,32,9,65,1,106,33,9,11,32,
  12,65,1,106,34,12,65,192,0,71,13,0,11,32,3,65,8,106,32,3,65,144,2,106,32,10,32,3,65,176,4,106,32,3,65,16,106,32,11,65,1,32,1,32,2,16,132,128,128,128,0,32,3,32,3,65,16,106,32,11,32,3,65,144,
  4,106,32,3,65,144,2,106,32,10,65,127,32,2,32,1,16,132,128,128,128,0,32,3,40,2,8,32,3,40,2,0,107,32,5,106,34,12,65,30,106,32,12,32,8,65,1,74,34,13,27,34,12,65,98,106,32,12,32,9,65,1,74,34,
  15,27,33,16,32,3,40,2,12,32,3,40,2,4,107,32,6,106,34,12,65,45,106,32,12,32,13,27,34,12,65,83,106,32,12,32,15,27,33,17,65,0,33,12,3,64,2,64,32,12,65,240,137,128,128,0,106,44,0,0,34,13,69,13,
  0,65,1,65,127,32,13,65,0,74,34,6,27,33,15,32,12,65,7,113,33,14,2,64,2,64,32,13,32,13,65,31,117,34,5,115,32,5,107,65,124,106,14,3,1,2,0,2,11,32,12,32,15,65,3,116,106,33,13,65,0,33,5,2,
  64,32,14,69,13,0,32,13,65,127,106,65,63,75,13,0,32,15,32,13,65,239,137,128,128,0,106,44,0,0,70,33,5,11,2,64,32,13,65,63,75,13,0,32,5,32,15,32,13,65,240,137,128,128,0,106,44,0,0,70,106,33,5,11,
  2,64,32,14,65,7,70,13,0,32,13,65,1,106,65,63,75,13,0,32,5,32,15,32,13,65,241,137,128,128,0,106,44,0,0,70,106,33,5,11,32,15,32,5,108,65,12,108,32,16,106,33,16,12,1,11,32,3,65,176,4,106,32,3,
  65,144,4,106,32,6,27,32,14,65,2,116,34,13,106,40,2,0,13,0,65,15,65,30,32,3,65,144,4,106,32,3,65,176,4,106,32,6,27,32,13,106,40,2,0,27,32,15,108,32,16,106,33,16,32,15,65,15,108,32,17,106,33,17,
  11,32,12,65,1,106,34,12,65,192,0,71,13,0,11,32,16,32,7,65,24,32,7,65,24,72,27,34,12,108,32,17,65,24,32,12,107,108,106,183,68,0,0,0,0,0,0,56,64,163,33,20,2,64,32,7,65,4,74,13,0,32,17,32,
  17,65,31,117,34,12,115,32,12,107,65,144,3,77,13,0,32,20,32,2,32,1,32,17,65,0,74,34,12,27,34,13,65,7,113,34,15,65,1,116,65,121,106,34,14,32,14,65,31,117,34,14,115,32,14,107,34,14,32,13,65,3,117,34,
  13,65,1,116,65,121,106,34,7,32,7,65,31,117,34,7,115,32,7,107,34,7,32,14,32,7,74,27,65,10,108,65,14,32,1,32,2,32,12,27,34,14,65,3,117,32,13,107,34,13,32,13,65,31,117,34,13,115,32,13,107,32,14,65,
  7,113,32,15,107,34,13,32,13,65,31,117,34,13,115,32,13,107,106,107,65,6,108,106,34,13,65,0,32,13,107,32,12,27,183,160,33,20,11,2,64,2,64,32,20,32,0,183,162,68,0,0,0,0,0,0,224,63,160,156,34,20,153,68,
  0,0,0,0,0,0,224,65,99,69,13,0,32,20,170,33,12,12,1,11,65,128,128,128,128,120,33,12,11,32,3,65,208,4,106,36,128,128,128,128,0,32,12,65,8,106,11,169,4,1,12,127,32,0,66,0,55,2,0,2,64,32,2,65,
  1,72,13,0,65,0,33,9,32,7,65,3,117,65,7,65,0,32,6,65,0,74,34,10,27,34,6,107,34,11,32,11,65,31,117,34,11,115,32,11,107,33,12,32,8,65,3,117,32,6,107,34,6,32,6,65,31,117,34,6,115,32,6,107,
  33,13,32,7,65,7,113,33,14,32,8,65,7,113,33,15,32,5,65,1,72,33,16,65,0,33,17,65,0,33,18,3,64,2,64,32,3,32,1,32,18,65,2,116,106,40,2,0,34,19,65,7,113,34,7,65,2,116,106,34,8,40,2,0,
  65,2,72,13,0,32,0,32,9,65,112,106,34,9,54,2,4,32,0,32,17,65,116,106,34,17,54,2,0,11,2,64,2,64,2,64,32,7,69,13,0,32,8,65,124,106,40,2,0,13,2,32,7,65,7,70,13,1,11,32,8,65,4,106,
  40,2,0,13,1,11,32,0,32,9,65,113,106,34,9,54,2,4,32,0,32,17,65,117,106,34,17,54,2,0,11,2,64,2,64,32,16,13,0,32,4,33,8,32,5,33,6,2,64,32,10,69,13,0,32,4,33,8,32,5,33,11,3,64,
  2,64,32,8,40,2,0,34,20,65,7,113,32,7,107,34,6,32,6,65,31,117,34,6,115,32,6,107,65,1,75,13,0,32,20,32,19,74,13,4,11,32,8,65,4,106,33,8,32,11,65,127,106,34,11,13,0,12,2,11,11,3,64,2,
  64,32,8,40,2,0,34,20,65,7,113,32,7,107,34,11,32,11,65,31,117,34,11,115,32,11,107,65,1,75,13,0,32,20,32,19,72,13,3,11,32,8,65,4,106,33,8,32,6,65,127,106,34,6,13,0,11,11,32,0,32,9,32,19,
  65,3,117,34,8,65,7,32,8,107,32,10,27,34,8,65,2,116,34,6,65,128,137,128,128,0,106,40,2,0,106,34,9,54,2,4,32,0,32,17,32,6,65,224,136,128,128,0,106,40,2,0,106,34,17,54,2,0,32,8,65,4,72,13,
  0,32,0,32,9,32,8,32,15,32,7,107,34,6,32,6,65,31,117,34,6,115,32,6,107,34,6,32,13,32,6,32,13,74,27,32,14,32,7,107,34,7,32,7,65,31,117,34,7,115,32,7,107,34,7,32,12,32,7,32,12,74,27,107,
  108,65,3,108,106,34,9,54,2,4,11,32,18,65,1,106,34,18,32,2,71,13,0,11,11,11,15,0,32,1,65,0,32,0,107,16,134,128,128,128,0,11,202,16,1,12,127,32,0,65,7,113,33,2,2,64,2,64,32,0,65,3,117,34,
  3,32,1,107,34,4,65,7,75,13,0,32,4,65,3,116,33,5,2,64,32,2,69,13,0,65,1,33,4,32,2,32,5,106,65,239,137,128,128,0,106,44,0,0,32,1,70,13,2,32,2,65,7,70,13,1,11,65,1,33,4,32,2,32,
  5,106,65,241,137,128,128,0,106,44,0,0,32,1,70,13,1,11,32,3,65,2,106,33,6,32,2,65,1,106,33,7,32,1,65,1,116,33,5,2,64,32,2,65,7,70,13,0,32,6,65,7,75,13,0,65,1,33,4,32,5,32,6,65,
  3,116,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,32,3,65,1,106,33,8,32,2,65,2,106,33,9,2,64,32,2,65,5,75,34,10,13,0,32,8,65,7,75,13,0,65,1,33,4,32,5,32,8,65,3,116,32,9,
  106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,32,3,65,127,106,33,11,2,64,32,10,13,0,32,11,65,7,75,13,0,65,1,33,4,32,5,32,11,65,3,116,32,9,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,32,
  3,65,126,106,33,9,2,64,32,2,65,7,70,13,0,32,9,65,7,75,13,0,65,1,33,4,32,5,32,9,65,3,116,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,2,65,127,106,34,12,32,9,114,65,7,
  75,13,0,65,1,33,4,32,5,32,9,65,3,116,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,2,65,126,106,34,9,32,3,65,127,106,114,65,7,75,13,0,65,1,33,4,32,5,32,11,65,3,116,32,9,
  106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,65,1,33,4,2,64,32,9,32,3,65,1,106,114,65,7,75,13,0,32,5,32,8,65,3,116,32,9,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,12,32,3,
  65,2,106,114,65,7,75,13,0,65,1,33,4,32,5,32,6,65,3,116,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,32,1,65,5,108,33,13,2,64,32,2,65,7,70,13,0,32,3,65,1,106,65,7,75,13,0,2,
  64,32,0,65,249,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,5,75,13,1,32,3,65,1,106,65,6,75,13,1,32,0,65,130,138,128,128,0,106,45,0,0,34,5,13,0,32,2,65,4,75,13,1,32,3,65,1,106,65,5,
  75,13,1,32,0,65,139,138,128,128,0,106,45,0,0,34,5,13,0,32,2,65,3,75,13,1,32,3,65,1,106,65,4,75,13,1,32,0,65,148,138,128,128,0,106,45,0,0,34,5,13,0,32,2,65,2,75,13,1,32,3,65,1,106,
  65,3,75,13,1,32,0,65,157,138,128,128,0,106,45,0,0,34,5,13,0,32,2,65,1,75,13,1,32,3,65,1,106,65,2,75,13,1,32,0,65,166,138,128,128,0,106,45,0,0,34,5,13,0,32,2,13,1,32,3,65,1,106,65,
  1,75,13,1,32,0,65,175,138,128,128,0,106,45,0,0,34,5,69,13,1,11,65,1,33,4,32,13,32,5,192,34,5,70,13,1,32,1,65,3,108,32,5,70,13,1,11,2,64,32,2,65,7,70,13,0,32,3,65,127,106,65,7,75,
  13,0,2,64,32,0,65,233,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,5,75,13,1,32,3,65,126,106,65,6,75,13,1,32,0,65,226,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,4,75,13,1,32,3,65,125,
  106,65,5,75,13,1,32,0,65,219,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,3,75,13,1,32,3,65,124,106,65,4,75,13,1,32,0,65,212,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,2,75,13,1,32,3,
  65,123,106,65,3,75,13,1,32,0,65,205,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,1,75,13,1,32,3,65,122,106,65,2,75,13,1,32,0,65,198,137,128,128,0,106,45,0,0,34,5,13,0,32,2,13,1,32,3,65,
  121,106,65,1,75,13,1,32,0,65,191,137,128,128,0,106,45,0,0,34,5,69,13,1,11,65,1,33,4,32,13,32,5,192,34,5,70,13,1,32,1,65,3,108,32,5,70,13,1,11,32,2,65,127,106,33,4,32,3,65,3,116,32,2,
  114,65,247,137,128,128,0,106,33,6,32,3,33,5,2,64,3,64,32,4,65,7,75,13,1,32,5,65,6,74,13,1,32,3,65,127,72,13,1,32,4,65,127,106,33,4,32,5,65,1,106,33,5,32,6,44,0,0,33,9,32,6,65,7,
  106,33,6,32,9,69,13,0,11,65,1,33,4,32,13,32,9,70,13,1,32,1,65,3,108,32,9,70,13,1,11,32,2,65,127,106,33,9,32,3,65,3,116,32,2,114,65,231,137,128,128,0,106,33,5,65,0,33,4,32,3,65,8,74,
  33,10,2,64,3,64,32,9,32,4,106,65,7,75,13,1,32,3,32,4,106,65,1,72,13,1,32,10,13,1,32,4,65,127,106,33,4,32,5,44,0,0,33,6,32,5,65,119,106,33,5,32,6,69,13,0,11,65,1,33,4,32,13,32,
  6,70,13,1,32,1,65,3,108,32,6,70,13,1,11,32,0,65,120,113,33,5,2,64,32,2,65,7,70,13,0,32,3,65,7,75,13,0,2,64,32,2,32,5,106,34,4,65,241,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,
  5,75,13,1,32,3,65,7,75,13,1,32,4,65,242,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,4,75,13,1,32,3,65,7,75,13,1,32,4,65,243,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,3,75,13,1,
  32,3,65,7,75,13,1,32,4,65,244,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,2,75,13,1,32,3,65,7,75,13,1,32,4,65,245,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,1,75,13,1,32,3,65,7,
  75,13,1,32,4,65,246,137,128,128,0,106,45,0,0,34,6,13,0,32,2,13,1,32,3,65,7,75,13,1,32,4,65,247,137,128,128,0,106,45,0,0,34,6,69,13,1,11,65,1,33,4,32,13,32,6,192,34,6,70,13,1,32,1,
  65,2,116,32,6,70,13,1,11,32,2,65,127,106,33,4,32,5,65,240,137,128,128,0,106,33,6,2,64,3,64,32,4,32,3,114,65,7,75,13,1,32,6,32,4,106,33,5,32,4,65,127,106,33,4,32,5,44,0,0,34,5,69,13,
  0,11,65,1,33,4,32,13,32,5,70,13,1,32,1,65,2,116,32,5,70,13,1,11,32,3,65,3,116,32,2,114,65,248,137,128,128,0,106,33,5,32,3,65,127,72,33,9,32,3,33,4,2,64,3,64,32,9,13,1,32,4,65,6,
  74,13,1,32,4,65,1,106,33,4,32,5,44,0,0,33,6,32,5,65,8,106,33,5,32,6,69,13,0,11,65,1,33,4,32,13,32,6,70,13,1,32,1,65,2,116,32,6,70,13,1,11,32,3,65,3,116,32,2,114,65,232,137,128,
  128,0,106,33,5,32,3,65,8,74,33,9,32,3,33,4,2,64,3,64,32,4,65,1,72,13,1,32,9,13,1,32,4,65,127,106,33,4,32,5,44,0,0,33,6,32,5,65,120,106,33,5,32,6,69,13,0,11,65,1,33,4,32,13,
  32,6,70,13,1,32,1,65,2,116,32,6,70,13,1,11,32,1,65,6,108,33,1,2,64,32,2,65,7,70,34,5,13,0,32,3,65,1,106,65,7,75,13,0,65,1,33,4,32,1,32,8,65,3,116,32,7,106,65,240,137,128,128,0,
  106,44,0,0,70,13,1,11,2,64,32,5,13,0,32,3,65,127,106,65,7,75,13,0,65,1,33,4,32,1,32,11,65,3,116,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,65,1,33,4,2,64,32,12,32,3,65,1,
  106,114,65,7,75,13,0,32,1,32,8,65,3,116,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,12,32,3,65,127,106,114,65,7,75,13,0,65,1,33,4,32,1,32,11,65,3,116,32,12,106,65,240,137,128,
  128,0,106,44,0,0,70,13,1,11,2,64,32,2,65,7,70,13,0,32,3,65,7,75,13,0,65,1,33,4,32,1,32,0,65,120,113,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,12,32,3,114,65,7,75,
  13,0,65,1,33,4,32,1,32,0,65,120,113,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,65,1,33,4,2,64,32,3,65,1,106,65,7,75,13,0,32,1,32,8,65,3,116,32,2,114,65,240,137,128,128,0,106,44,
  0,0,70,13,1,11,2,64,32,3,65,127,106,65,7,75,13,0,65,1,33,4,32,1,32,11,65,3,116,32,2,114,65,240,137,128,128,0,106,44,0,0,70,13,1,11,65,0,33,4,11,32,4,11,144,25,5,9,127,2,126,12,127,1,
  126,15,127,65,0,32,0,54,2,212,182,128,128,0,65,0,32,3,54,2,216,182,128,128,0,65,0,32,4,54,2,220,182,128,128,0,65,0,65,0,58,0,208,182,128,128,0,65,0,65,0,54,2,224,182,128,128,0,65,7,65,0,32,0,
  65,1,70,34,3,27,33,5,65,1,65,6,32,3,27,33,6,32,1,65,2,113,33,7,32,1,65,1,113,33,8,32,1,65,8,113,33,9,32,1,65,4,113,33,10,32,0,65,4,116,33,11,65,0,32,0,107,33,12,32,0,65,3,116,
  34,13,172,33,14,66,0,33,15,65,0,33,16,65,0,33,17,65,0,33,18,2,64,3,64,2,64,32,15,167,34,19,65,240,137,128,128,0,106,34,20,44,0,0,34,1,69,13,0,65,1,65,127,32,1,65,0,74,27,32,0,71,13,0,
  32,19,65,3,118,33,21,32,19,65,7,113,33,22,2,64,2,64,2,64,32,1,32,1,192,65,7,117,34,3,115,32,3,107,65,255,1,113,34,23,65,127,106,14,2,1,0,2,11,32,21,65,2,106,33,24,32,22,65,1,106,33,4,2,
  64,32,22,65,7,70,34,20,13,0,32,19,65,47,75,13,0,2,64,32,24,65,3,116,32,4,106,34,1,65,240,137,128,128,0,106,44,0,0,34,3,69,13,0,65,1,65,127,32,3,65,0,74,27,32,12,71,13,1,11,32,19,32,1,
  65,0,65,0,16,136,128,128,128,0,13,5,11,32,21,65,1,106,33,25,32,22,65,2,106,33,3,2,64,32,22,65,5,75,34,26,13,0,32,19,65,55,75,13,0,2,64,32,25,65,3,116,32,3,106,34,1,65,240,137,128,128,0,106,
  44,0,0,34,27,69,13,0,65,1,65,127,32,27,65,0,74,27,32,12,71,13,1,11,32,19,32,1,65,0,65,0,16,136,128,128,128,0,13,5,11,32,19,65,184,127,106,33,1,32,21,65,127,106,33,27,2,64,32,26,13,0,32,1,
  65,64,73,13,0,2,64,32,27,65,3,116,32,3,106,34,3,65,240,137,128,128,0,106,44,0,0,34,26,69,13,0,65,1,65,127,32,26,65,0,74,27,32,12,71,13,1,11,32,19,32,3,65,0,65,0,16,136,128,128,128,0,13,5,
  11,32,19,65,176,127,106,33,3,32,21,65,126,106,33,26,2,64,32,20,13,0,32,3,65,64,73,13,0,2,64,32,26,65,3,116,32,4,106,34,4,65,240,137,128,128,0,106,44,0,0,34,20,69,13,0,65,1,65,127,32,20,65,0,
  74,27,32,12,71,13,1,11,32,19,32,4,65,0,65,0,16,136,128,128,128,0,13,5,11,2,64,32,22,65,127,106,34,4,65,7,75,34,20,13,0,32,3,65,64,73,13,0,2,64,32,26,65,3,116,32,4,106,34,3,65,240,137,128,
  128,0,106,44,0,0,34,26,69,13,0,65,1,65,127,32,26,65,0,74,27,32,12,71,13,1,11,32,19,32,3,65,0,65,0,16,136,128,128,128,0,13,5,11,2,64,32,22,65,126,106,34,3,65,7,75,34,26,13,0,32,1,65,64,
  73,13,0,2,64,32,27,65,3,116,32,3,106,34,1,65,240,137,128,128,0,106,44,0,0,34,27,69,13,0,65,1,65,127,32,27,65,0,74,27,32,12,71,13,1,11,32,19,32,1,65,0,65,0,16,136,128,128,128,0,13,5,11,2,
  64,32,26,13,0,32,19,65,55,75,13,0,2,64,32,25,65,3,116,32,3,106,34,1,65,240,137,128,128,0,106,44,0,0,34,3,69,13,0,65,1,65,127,32,3,65,0,74,27,32,12,71,13,1,11,32,19,32,1,65,0,65,0,16,
  136,128,128,128,0,13,5,11,32,20,13,2,32,19,65,47,75,13,2,2,64,32,24,65,3,116,32,4,106,34,1,65,240,137,128,128,0,106,44,0,0,34,3,69,13,0,65,1,65,127,32,3,65,0,74,27,32,12,71,13,3,11,32,19,
  32,1,65,0,65,0,16,136,128,128,128,0,69,13,2,12,4,11,32,18,32,13,106,33,3,2,64,32,15,32,14,124,34,28,167,34,1,65,63,75,13,0,32,1,65,240,137,128,128,0,106,45,0,0,13,0,65,0,33,4,2,64,32,1,
  65,3,118,34,20,32,5,71,13,0,32,19,32,3,65,5,65,0,16,136,128,128,128,0,13,5,32,19,32,3,65,4,65,0,16,136,128,128,128,0,13,5,65,2,33,4,32,19,32,3,65,3,65,0,16,136,128,128,128,0,13,5,11,32,
  19,32,3,32,4,65,0,16,136,128,128,128,0,13,4,32,21,32,6,71,13,0,32,20,32,5,70,13,0,32,11,32,19,106,65,240,137,128,128,0,106,45,0,0,13,0,32,19,32,18,32,11,106,65,0,65,1,16,136,128,128,128,0,13,
  4,11,2,64,32,22,69,13,0,32,28,66,191,127,124,66,64,84,13,0,32,3,65,127,106,33,4,32,1,65,127,106,33,20,2,64,32,1,65,239,137,128,128,0,106,44,0,0,34,26,69,13,0,65,1,65,127,32,26,65,0,74,27,32,
  12,71,13,0,65,0,33,26,2,64,32,20,65,3,118,32,5,71,13,0,32,19,32,4,65,5,65,0,16,136,128,128,128,0,13,6,32,19,32,4,65,4,65,0,16,136,128,128,128,0,13,6,65,2,33,26,32,19,32,4,65,3,65,0,
  16,136,128,128,128,0,13,6,11,32,19,32,4,32,26,65,0,16,136,128,128,128,0,69,13,1,12,5,11,32,20,32,2,71,13,0,32,19,32,4,65,0,65,2,16,136,128,128,128,0,13,4,11,32,22,65,7,70,13,1,32,28,66,65,
  124,66,64,84,13,1,32,3,65,1,106,33,3,32,1,65,1,106,33,4,2,64,32,1,65,241,137,128,128,0,106,44,0,0,34,1,69,13,0,65,1,65,127,32,1,65,0,74,27,32,12,71,13,0,65,0,33,1,2,64,32,4,65,3,
  118,32,5,71,13,0,32,19,32,3,65,5,65,0,16,136,128,128,128,0,13,5,32,19,32,3,65,4,65,0,16,136,128,128,128,0,13,5,65,2,33,1,32,19,32,3,65,3,65,0,16,136,128,128,128,0,13,5,11,32,19,32,3,32,
  1,65,0,16,136,128,128,128,0,69,13,2,12,4,11,32,4,32,2,71,13,1,32,19,32,3,65,0,65,2,16,136,128,128,128,0,69,13,1,12,3,11,2,64,32,23,65,4,70,65,3,116,34,29,65,8,65,16,32,23,65,3,70,27,
  34,30,79,13,0,32,18,65,3,118,33,31,32,16,65,7,113,33,32,65,0,65,0,40,2,212,182,128,128,0,107,33,33,65,0,41,3,232,182,128,128,0,66,126,32,15,137,131,33,28,65,0,40,2,216,182,128,128,0,33,34,65,0,45,
  0,208,182,128,128,0,33,35,65,0,40,2,224,182,128,128,0,33,36,65,0,40,2,220,182,128,128,0,33,37,3,64,32,29,65,2,116,34,1,65,132,136,128,128,0,106,40,2,0,33,25,32,1,65,128,136,128,128,0,106,40,2,0,33,
  27,2,64,2,64,2,64,32,37,65,1,70,13,0,32,25,65,9,116,32,27,65,6,116,106,33,38,32,32,32,27,106,34,26,32,31,32,25,106,34,4,65,3,116,106,34,1,65,6,116,33,24,32,27,32,25,65,3,116,106,33,39,32,36,
  33,40,3,64,32,26,65,7,75,13,3,32,4,65,0,72,13,3,32,4,65,7,74,13,3,32,1,65,240,137,128,128,0,106,34,41,45,0,0,34,42,13,2,32,20,45,0,0,33,3,32,20,65,0,58,0,0,32,1,65,240,137,128,128,
  0,106,34,42,32,3,58,0,0,32,1,32,34,32,3,32,3,192,65,7,117,34,41,115,32,41,107,65,255,1,113,34,43,65,6,70,27,33,41,2,64,2,64,32,35,65,1,113,69,13,0,32,41,32,33,32,28,66,1,32,1,173,134,132,
  16,137,128,128,128,0,33,41,12,1,11,32,41,32,33,16,134,128,128,128,0,33,41,11,32,20,32,3,58,0,0,32,42,65,0,58,0,0,2,64,32,41,13,0,32,37,65,2,70,13,9,65,0,32,40,65,1,106,34,36,54,2,224,182,
  128,128,0,32,40,65,2,116,65,208,166,128,128,0,106,32,24,32,43,65,12,116,114,32,19,114,54,2,0,32,36,33,40,11,32,4,32,25,106,33,4,32,26,32,27,106,33,26,32,24,32,38,106,33,24,32,1,32,39,106,33,1,32,23,
  65,6,71,13,0,12,3,11,11,32,22,32,27,106,34,4,65,8,73,32,21,32,25,106,34,1,65,127,74,113,32,1,65,8,72,113,33,3,2,64,32,23,65,6,71,13,0,32,3,69,13,2,32,1,65,3,116,32,4,106,34,1,65,240,
  137,128,128,0,106,34,41,45,0,0,34,42,69,13,2,12,1,11,32,3,69,13,1,32,32,32,27,106,32,31,32,25,106,65,3,116,106,33,1,32,31,32,25,65,1,116,106,33,3,32,27,32,25,65,3,116,106,33,24,32,32,32,27,65,
  1,116,106,33,4,3,64,32,1,65,240,137,128,128,0,106,34,41,45,0,0,34,42,13,1,32,4,65,7,75,13,2,32,3,65,0,72,13,2,32,1,32,24,106,33,1,32,4,32,27,106,33,4,32,3,65,7,74,33,26,32,3,32,25,
  106,33,3,32,26,13,2,12,0,11,11,65,1,65,127,32,42,192,34,4,65,0,74,27,32,12,71,13,0,32,20,45,0,0,33,3,32,20,65,0,58,0,0,32,41,32,3,58,0,0,32,1,32,34,32,3,32,3,192,65,7,117,34,26,
  115,32,26,107,65,255,1,113,34,24,65,6,70,27,33,26,2,64,2,64,32,35,65,1,113,69,13,0,32,26,32,33,32,28,66,1,32,1,173,134,132,16,137,128,128,128,0,33,26,12,1,11,32,26,32,33,16,134,128,128,128,0,33,26,
  11,32,20,32,3,58,0,0,32,41,32,42,58,0,0,32,26,13,0,32,37,65,2,70,13,5,65,0,32,36,65,1,106,34,3,54,2,224,182,128,128,0,32,36,65,2,116,65,208,166,128,128,0,106,32,1,65,6,116,32,4,32,4,65,
  31,117,34,1,115,32,1,107,65,15,116,114,32,24,65,12,116,114,32,19,114,54,2,0,32,3,33,36,11,32,29,65,2,106,34,29,32,30,73,13,0,11,11,2,64,2,64,2,64,2,64,32,0,65,1,71,13,0,32,15,66,4,82,13,
  0,32,23,65,6,71,13,0,32,8,69,13,3,65,0,45,0,247,137,128,128,0,65,255,1,113,65,4,71,13,3,65,0,45,0,245,137,128,128,0,65,255,1,113,13,3,65,0,45,0,246,137,128,128,0,65,255,1,113,13,3,2,64,65,
  0,45,0,208,182,128,128,0,69,13,0,65,4,65,127,65,0,41,3,232,182,128,128,0,34,28,16,137,128,128,128,0,13,4,65,5,65,127,32,28,16,137,128,128,128,0,13,4,65,6,65,127,32,28,16,137,128,128,128,0,33,1,12,3,
  11,65,4,65,127,16,134,128,128,128,0,69,13,1,12,3,11,32,0,65,127,71,13,3,32,15,66,60,82,13,3,32,23,65,6,71,13,3,2,64,32,10,69,13,0,65,0,45,0,175,138,128,128,0,65,255,1,113,65,252,1,71,13,0,
  65,0,45,0,173,138,128,128,0,65,255,1,113,13,0,65,0,45,0,174,138,128,128,0,65,255,1,113,13,0,65,0,41,3,232,182,128,128,0,33,28,2,64,2,64,65,0,45,0,208,182,128,128,0,69,13,0,65,60,65,1,32,28,16,
  137,128,128,128,0,13,2,65,61,65,1,32,28,16,137,128,128,128,0,33,1,12,1,11,65,60,65,1,16,134,128,128,128,0,13,1,65,61,65,1,16,134,128,128,128,0,33,1,11,32,1,13,0,65,62,65,1,32,28,16,138,128,128,128,
  0,13,0,65,60,65,62,65,0,65,4,16,136,128,128,128,0,13,6,11,32,9,69,13,3,65,0,45,0,168,138,128,128,0,65,255,1,113,65,252,1,71,13,3,65,0,45,0,169,138,128,128,0,65,255,1,113,13,3,65,0,45,0,170,
  138,128,128,0,65,255,1,113,13,3,65,0,45,0,171,138,128,128,0,65,255,1,113,13,3,65,0,41,3,232,182,128,128,0,33,28,2,64,2,64,65,0,45,0,208,182,128,128,0,69,13,0,65,60,65,1,32,28,16,137,128,128,128,0,
  13,5,65,59,65,1,32,28,16,137,128,128,128,0,33,1,12,1,11,65,60,65,1,16,134,128,128,128,0,13,4,65,59,65,1,16,134,128,128,128,0,33,1,11,32,1,13,3,65,58,65,1,32,28,16,138,128,128,128,0,13,3,65,60,
  65,58,65,0,65,8,16,136,128,128,128,0,13,5,12,3,11,65,5,65,127,16,134,128,128,128,0,13,1,65,6,65,127,16,134,128,128,128,0,33,1,11,32,1,13,0,65,4,65,6,65,0,65,4,16,136,128,128,128,0,13,3,11,32,
  7,69,13,0,65,0,45,0,240,137,128,128,0,65,255,1,113,65,4,71,13,0,65,0,45,0,241,137,128,128,0,65,255,1,113,13,0,65,0,45,0,242,137,128,128,0,65,255,1,113,13,0,65,0,45,0,243,137,128,128,0,65,255,1,
  113,13,0,2,64,2,64,65,0,45,0,208,182,128,128,0,69,13,0,65,4,65,127,65,0,41,3,232,182,128,128,0,34,28,16,137,128,128,128,0,13,2,65,3,65,127,32,28,16,137,128,128,128,0,13,2,65,2,65,127,32,28,16,137,
  128,128,128,0,33,1,12,1,11,65,4,65,127,16,134,128,128,128,0,13,1,65,3,65,127,16,134,128,128,128,0,13,1,65,2,65,127,16,134,128,128,128,0,33,1,11,32,1,13,0,65,4,65,2,65,0,65,8,16,136,128,128,128,0,
  13,2,11,32,16,65,1,106,33,16,32,15,66,62,86,33,17,32,18,65,1,106,33,18,32,15,66,1,124,34,15,66,192,0,82,13,0,11,11,65,0,65,0,40,2,224,182,128,128,0,65,0,40,2,220,182,128,128,0,65,2,70,27,65,
  1,32,17,65,1,113,27,11,226,5,3,7,127,1,126,7,127,65,1,32,1,65,240,137,128,128,0,106,44,0,0,34,4,32,4,65,31,117,34,5,115,32,5,107,32,3,65,2,113,34,6,27,33,7,65,0,33,8,32,0,65,240,137,128,
  128,0,106,44,0,0,33,5,2,64,2,64,65,0,40,2,220,182,128,128,0,34,9,65,1,71,13,0,32,7,32,2,114,69,13,1,11,65,0,33,10,65,0,41,3,232,182,128,128,0,33,11,2,64,65,0,45,0,208,182,128,128,0,34,
  12,69,13,0,32,11,66,126,32,0,173,137,131,66,1,32,1,173,134,132,33,11,11,32,0,65,240,137,128,128,0,106,65,0,58,0,0,32,1,65,240,137,128,128,0,106,65,0,40,2,212,182,128,128,0,34,13,32,2,108,32,5,32,2,
  27,58,0,0,65,127,33,8,2,64,32,6,69,13,0,32,1,32,13,65,3,116,107,34,8,65,240,137,128,128,0,106,34,6,45,0,0,33,10,32,6,65,0,58,0,0,32,12,69,13,0,32,11,66,126,32,8,173,137,131,33,11,11,2,
  64,2,64,2,64,2,64,32,3,65,12,113,69,13,0,65,5,65,3,32,3,65,4,113,34,6,27,65,61,65,59,32,6,27,32,13,65,1,70,34,14,27,34,15,65,240,137,128,128,0,106,32,3,65,29,116,65,31,117,65,7,113,65,63,
  65,56,32,6,27,32,14,27,34,6,65,240,137,128,128,0,106,34,14,45,0,0,34,16,58,0,0,32,14,65,0,58,0,0,2,64,32,12,13,0,32,1,65,0,40,2,216,182,128,128,0,32,5,32,5,65,31,117,34,12,115,32,12,107,
  34,17,65,6,70,27,33,14,65,0,32,13,107,33,18,12,3,11,32,1,65,0,40,2,216,182,128,128,0,32,5,32,5,65,31,117,34,12,115,32,12,107,34,17,65,6,70,27,33,14,32,11,66,126,32,6,173,137,131,66,1,32,15,173,
  134,132,33,11,65,0,32,13,107,33,18,32,6,33,13,12,1,11,65,0,33,16,32,1,65,0,40,2,216,182,128,128,0,32,5,32,5,65,31,117,34,6,115,32,6,107,34,17,65,6,70,27,33,14,65,0,32,13,107,33,18,65,127,33,
  15,65,127,33,13,65,127,33,6,32,12,69,13,1,11,32,14,32,18,32,11,16,137,128,128,128,0,33,12,12,1,11,32,14,32,18,16,134,128,128,128,0,33,12,32,6,33,13,11,2,64,32,13,65,0,72,13,0,32,13,65,240,137,128,
  128,0,106,32,16,58,0,0,32,15,65,240,137,128,128,0,106,65,0,58,0,0,11,2,64,32,8,65,0,72,13,0,32,8,65,240,137,128,128,0,106,32,10,58,0,0,11,32,0,65,240,137,128,128,0,106,32,5,58,0,0,32,1,65,
  240,137,128,128,0,106,32,4,58,0,0,65,0,33,8,32,12,13,0,65,1,33,8,32,9,65,2,70,13,0,65,0,33,8,65,0,65,0,40,2,224,182,128,128,0,34,5,65,1,106,54,2,224,182,128,128,0,32,5,65,2,116,65,208,
  166,128,128,0,106,32,1,65,6,116,32,2,65,18,116,114,32,3,65,21,116,114,32,7,65,15,116,114,32,17,65,12,116,114,32,0,114,54,2,0,11,32,8,11,155,7,3,3,127,2,126,2,127,2,64,2,64,32,0,65,3,117,32,1,
  107,34,3,65,7,75,13,0,32,3,65,3,116,33,4,2,64,32,0,65,7,113,34,5,69,13,0,65,1,33,3,32,5,32,4,106,65,239,137,128,128,0,106,44,0,0,32,1,70,13,2,32,5,65,7,70,13,1,11,65,1,33,3,32,
  5,32,4,106,65,241,137,128,128,0,106,44,0,0,32,1,70,13,1,11,32,1,65,1,116,33,3,32,0,65,3,116,65,160,241,129,128,0,106,41,3,0,33,6,2,64,3,64,32,6,80,13,1,32,6,122,33,7,32,6,66,127,124,32,
  6,131,33,6,32,3,32,7,167,65,240,137,128,128,0,106,44,0,0,71,13,0,11,65,1,15,11,32,1,65,6,108,33,8,32,1,65,5,108,33,5,2,64,32,0,65,6,116,34,4,65,160,245,129,128,0,106,41,3,0,32,2,131,34,
  6,80,13,0,65,1,33,3,32,5,32,6,122,34,6,167,65,240,137,128,128,0,106,44,0,0,34,9,70,13,1,32,1,65,3,108,32,9,70,13,1,32,6,32,0,65,3,116,65,160,149,130,128,0,106,49,0,0,82,13,0,32,8,32,
  9,70,13,1,11,2,64,32,4,65,168,245,129,128,0,106,41,3,0,32,2,131,34,6,80,13,0,65,1,33,3,32,5,32,6,121,167,65,63,115,34,9,65,240,137,128,128,0,106,44,0,0,34,4,70,13,1,32,1,65,3,108,32,4,
  70,13,1,32,9,32,0,65,3,116,65,161,149,130,128,0,106,45,0,0,71,13,0,32,8,32,4,70,13,1,11,2,64,32,0,65,6,116,34,4,65,176,245,129,128,0,106,41,3,0,32,2,131,34,6,80,13,0,65,1,33,3,32,5,
  32,6,122,34,6,167,65,240,137,128,128,0,106,44,0,0,34,9,70,13,1,32,1,65,3,108,32,9,70,13,1,32,6,32,0,65,3,116,65,162,149,130,128,0,106,49,0,0,82,13,0,32,8,32,9,70,13,1,11,2,64,32,4,65,
  184,245,129,128,0,106,41,3,0,32,2,131,34,6,80,13,0,65,1,33,3,32,5,32,6,121,167,65,63,115,34,9,65,240,137,128,128,0,106,44,0,0,34,4,70,13,1,32,1,65,3,108,32,4,70,13,1,32,9,32,0,65,3,116,
  65,163,149,130,128,0,106,45,0,0,71,13,0,32,8,32,4,70,13,1,11,2,64,32,0,65,6,116,34,4,65,192,245,129,128,0,106,41,3,0,32,2,131,34,6,80,13,0,65,1,33,3,32,5,32,6,122,34,6,167,65,240,137,128,
  128,0,106,44,0,0,34,9,70,13,1,32,1,65,2,116,32,9,70,13,1,32,6,32,0,65,3,116,65,164,149,130,128,0,106,49,0,0,82,13,0,32,8,32,9,70,13,1,11,2,64,32,4,65,200,245,129,128,0,106,41,3,0,32,
  2,131,34,6,80,13,0,65,1,33,3,32,5,32,6,121,167,65,63,115,34,9,65,240,137,128,128,0,106,44,0,0,34,4,70,13,1,32,1,65,2,116,32,4,70,13,1,32,9,32,0,65,3,116,65,165,149,130,128,0,106,45,0,0,
  71,13,0,32,8,32,4,70,13,1,11,2,64,32,0,65,6,116,34,4,65,208,245,129,128,0,106,41,3,0,32,2,131,34,6,80,13,0,65,1,33,3,32,5,32,6,122,34,6,167,65,240,137,128,128,0,106,44,0,0,34,9,70,13,
  1,32,1,65,2,116,32,9,70,13,1,32,6,32,0,65,3,116,65,166,149,130,128,0,106,49,0,0,82,13,0,32,8,32,9,70,13,1,11,2,64,32,4,65,216,245,129,128,0,106,41,3,0,32,2,131,34,6,80,13,0,65,1,33,
  3,32,5,32,6,121,167,65,63,115,34,9,65,240,137,128,128,0,106,44,0,0,34,4,70,13,1,32,1,65,2,116,32,4,70,13,1,32,9,32,0,65,3,116,65,167,149,130,128,0,106,45,0,0,71,13,0,32,8,32,4,70,13,1,
  11,65,0,33,3,11,32,3,11,40,0,2,64,65,0,45,0,208,182,128,128,0,69,13,0,32,0,32,1,32,2,16,137,128,128,128,0,15,11,32,0,32,1,16,134,128,128,128,0,11,8,0,65,240,182,128,128,0,11,8,0,65,240,198,
  128,128,0,11,8,0,65,240,214,128,128,0,11,8,0,65,224,215,128,128,0,11,8,0,65,224,223,129,128,0,11,11,0,65,0,40,2,224,239,129,128,0,11,11,0,65,0,40,2,228,239,129,128,0,11,135,18,5,1,127,1,123,17,127,
  2,123,1,124,35,128,128,128,128,0,65,224,2,107,34,3,36,128,128,128,128,0,32,3,65,192,2,106,65,16,106,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,34,4,253,11,4,0,32,3,32,4,253,11,4,192,2,
  32,3,65,160,2,106,65,16,106,32,4,253,11,4,0,32,3,32,4,253,11,4,160,2,32,3,65,32,106,65,16,106,65,0,253,0,4,208,136,128,128,0,253,11,4,0,32,3,65,0,253,0,4,192,136,128,128,0,253,11,4,32,32,3,
  65,24,106,66,127,55,3,0,32,3,65,16,106,66,127,55,3,0,32,3,66,127,55,3,8,32,3,66,127,55,3,0,65,0,33,5,65,0,33,6,65,0,33,7,65,0,33,8,65,0,33,9,65,0,33,10,65,0,33,11,65,0,33,12,
  65,0,33,13,65,0,33,14,3,64,2,64,32,14,65,240,137,128,128,0,106,44,0,0,34,15,69,13,0,65,1,33,16,32,15,32,15,192,65,7,117,34,17,115,32,17,107,34,18,65,255,1,113,34,17,65,6,116,32,14,32,14,65,56,
  115,32,15,65,0,74,34,19,27,106,65,2,116,34,20,65,204,152,128,128,0,106,40,2,0,32,17,65,2,116,65,176,138,128,128,0,106,40,2,0,34,21,106,65,1,65,127,32,19,27,34,19,108,32,6,106,33,6,32,20,65,204,138,128,
  128,0,106,40,2,0,32,21,106,32,19,108,32,5,106,33,5,2,64,2,64,32,18,65,254,1,113,65,2,70,13,0,2,64,32,17,65,4,71,13,0,32,7,65,2,106,33,7,12,2,11,32,17,65,5,70,65,2,116,33,16,11,32,16,
  32,7,106,33,7,2,64,2,64,32,17,65,127,106,14,4,0,3,1,2,3,11,32,14,65,7,113,33,17,2,64,32,15,65,1,72,13,0,32,3,65,224,1,106,32,10,65,2,116,106,32,14,54,2,0,32,3,65,192,2,106,32,17,65,
  2,116,34,15,106,34,17,32,17,40,2,0,65,1,106,54,2,0,32,3,65,32,106,32,15,106,34,15,32,14,32,15,40,2,0,34,15,32,14,32,15,72,27,54,2,0,32,10,65,1,106,33,10,12,3,11,32,3,65,160,1,106,32,11,
  65,2,116,106,32,14,54,2,0,32,3,65,160,2,106,32,17,65,2,116,34,15,106,34,17,32,17,40,2,0,65,1,106,54,2,0,32,3,32,15,106,34,15,32,14,32,15,40,2,0,34,15,32,14,32,15,74,27,54,2,0,32,11,65,
  1,106,33,11,12,2,11,2,64,32,15,65,1,72,13,0,32,8,65,1,106,33,8,12,2,11,32,9,65,1,106,33,9,12,1,11,2,64,32,15,65,1,72,13,0,32,3,65,240,0,106,32,12,65,2,116,106,32,14,54,2,0,32,12,
  65,1,106,33,12,12,1,11,32,3,65,192,0,106,32,13,65,2,116,106,32,14,54,2,0,32,13,65,1,106,33,13,11,32,14,65,1,106,34,14,65,192,0,71,13,0,11,2,64,32,10,65,1,72,13,0,32,2,253,17,32,1,253,28,
  1,34,4,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,33,22,32,4,65,3,253,172,1,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,33,23,65,0,33,19,3,64,
  32,5,65,116,106,32,5,32,3,65,192,2,106,32,3,65,224,1,106,32,19,65,2,116,106,40,2,0,34,17,65,7,113,34,18,65,2,116,34,14,106,40,2,0,65,1,74,34,15,27,33,5,32,6,65,112,106,32,6,32,15,27,33,6,
  2,64,2,64,2,64,32,18,69,13,0,32,14,32,3,65,192,2,106,106,65,124,106,40,2,0,13,2,32,18,65,7,70,13,1,11,32,14,32,3,65,192,2,106,106,65,4,106,40,2,0,13,1,11,32,6,65,113,106,33,6,32,5,65,
  117,106,33,5,11,2,64,2,64,65,0,32,18,65,127,106,34,15,32,15,32,18,75,27,65,7,32,18,65,1,106,32,18,65,7,70,27,34,16,75,13,0,32,3,32,14,65,1,32,18,32,18,27,34,15,65,2,116,107,106,33,14,32,15,
  65,127,115,32,18,106,33,15,3,64,32,14,40,2,0,32,17,74,13,2,32,14,65,4,106,33,14,32,15,65,1,106,34,15,32,16,73,13,0,11,11,32,17,65,3,117,34,14,65,2,116,34,15,65,128,137,128,128,0,106,40,2,0,32,
  6,106,33,6,32,15,65,224,136,128,128,0,106,40,2,0,32,5,106,33,5,32,14,65,4,72,13,0,32,6,32,14,32,22,32,18,253,17,253,177,1,253,160,1,32,23,253,184,1,34,4,253,27,0,32,4,253,27,1,107,108,65,3,108,
  106,33,6,11,32,19,65,1,106,34,19,32,10,71,13,0,11,11,2,64,32,11,65,1,72,13,0,32,1,253,17,32,2,253,28,1,34,4,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,33,22,32,4,65,3,
  253,172,1,253,160,1,33,23,65,0,33,19,3,64,32,5,65,12,106,32,5,32,3,65,160,2,106,32,3,65,160,1,106,32,19,65,2,116,106,40,2,0,34,17,65,7,113,34,18,65,2,116,34,14,106,40,2,0,65,1,74,34,15,27,
  33,5,32,6,65,16,106,32,6,32,15,27,33,6,2,64,2,64,2,64,32,18,69,13,0,32,14,32,3,65,160,2,106,106,65,124,106,40,2,0,13,2,32,18,65,7,70,13,1,11,32,14,32,3,65,160,2,106,106,65,4,106,40,2,
  0,13,1,11,32,6,65,15,106,33,6,32,5,65,11,106,33,5,11,2,64,2,64,65,0,32,18,65,127,106,34,15,32,15,32,18,75,27,65,7,32,18,65,1,106,32,18,65,7,70,27,34,16,75,13,0,32,3,65,32,106,32,14,65,
  1,32,18,32,18,27,34,15,65,2,116,107,106,33,14,32,15,65,127,115,32,18,106,33,15,3,64,32,14,40,2,0,32,17,72,13,2,32,14,65,4,106,33,14,32,15,65,1,106,34,15,32,16,73,13,0,11,11,32,6,65,7,32,17,
  65,3,117,34,14,107,34,17,65,2,116,34,15,65,128,137,128,128,0,106,40,2,0,107,33,6,32,5,32,15,65,224,136,128,128,0,106,40,2,0,107,33,5,32,14,65,3,74,13,0,32,6,32,17,32,22,32,18,253,17,253,177,1,253,
  160,1,32,23,253,184,1,34,4,253,27,0,32,4,253,27,1,107,108,65,125,108,106,33,6,11,32,19,65,1,106,34,19,32,11,71,13,0,11,11,32,5,65,30,106,32,5,32,8,65,1,74,34,14,27,34,15,65,98,106,32,15,32,9,
  65,1,74,34,17,27,33,5,32,6,65,45,106,32,6,32,14,27,34,14,65,83,106,32,14,32,17,27,33,15,2,64,32,12,65,1,72,13,0,32,3,65,240,0,106,33,14,3,64,2,64,32,3,65,192,2,106,32,14,40,2,0,65,7,
  113,65,2,116,34,6,106,40,2,0,13,0,32,15,65,15,106,33,15,65,15,65,30,32,3,65,160,2,106,32,6,106,40,2,0,27,32,5,106,33,5,11,32,14,65,4,106,33,14,32,12,65,127,106,34,12,13,0,11,11,2,64,32,13,
  65,1,72,13,0,32,3,65,192,0,106,33,14,3,64,2,64,32,3,65,160,2,106,32,14,40,2,0,65,7,113,65,2,116,34,6,106,40,2,0,13,0,32,15,65,113,106,33,15,65,113,65,98,32,3,65,192,2,106,32,6,106,40,2,
  0,27,32,5,106,33,5,11,32,14,65,4,106,33,14,32,13,65,127,106,34,13,13,0,11,11,32,1,65,8,106,33,6,65,0,33,14,2,64,32,1,65,7,113,34,17,69,13,0,32,1,65,7,106,34,16,65,63,75,13,0,32,16,65,
  240,137,128,128,0,106,45,0,0,65,1,70,33,14,11,2,64,32,6,65,63,75,13,0,32,14,32,6,65,240,137,128,128,0,106,45,0,0,65,1,70,106,33,14,11,2,64,32,17,65,7,70,13,0,32,1,65,9,106,34,6,65,63,75,
  13,0,32,14,32,6,65,240,137,128,128,0,106,45,0,0,65,1,70,106,33,14,11,32,2,65,120,106,33,17,65,0,33,6,2,64,32,2,65,7,113,34,16,69,13,0,32,2,65,119,106,34,18,65,63,75,13,0,32,18,65,240,137,128,
  128,0,106,45,0,0,65,255,1,70,33,6,11,2,64,32,17,65,63,75,13,0,32,6,32,17,65,240,137,128,128,0,106,45,0,0,65,255,1,70,106,33,6,11,2,64,32,16,65,7,70,13,0,32,2,65,121,106,34,17,65,63,75,13,
  0,32,6,32,17,65,240,137,128,128,0,106,45,0,0,65,255,1,70,106,33,6,11,32,14,32,6,107,65,12,108,32,5,106,32,7,65,24,32,7,65,24,72,27,34,14,108,32,15,65,24,32,14,107,108,106,183,68,0,0,0,0,0,0,
  56,64,163,33,24,2,64,32,7,65,4,74,13,0,32,15,32,15,65,31,117,34,14,115,32,14,107,65,145,3,73,13,0,32,24,32,2,32,1,32,15,65,0,74,34,14,27,34,15,65,7,113,34,6,65,1,116,65,121,106,34,5,32,5,
  65,31,117,34,5,115,32,5,107,34,5,32,15,65,3,117,34,15,65,1,116,65,121,106,34,17,32,17,65,31,117,34,17,115,32,17,107,34,17,32,5,32,17,74,27,65,10,108,65,14,32,1,32,2,32,14,27,34,5,65,3,117,32,15,
  107,34,15,32,15,65,31,117,34,15,115,32,15,107,32,5,65,7,113,32,6,107,34,15,32,15,65,31,117,34,15,115,32,15,107,106,107,65,6,108,106,34,15,65,0,32,15,107,32,14,27,183,160,33,24,11,2,64,2,64,32,24,32,0,
  183,162,68,0,0,0,0,0,0,224,63,160,156,34,24,153,68,0,0,0,0,0,0,224,65,99,69,13,0,32,24,170,33,14,12,1,11,65,128,128,128,128,120,33,14,11,32,3,65,224,2,106,36,128,128,128,128,0,32,14,65,8,106,11,
  153,60,10,1,127,1,126,1,123,5,127,5,126,1,127,1,126,9,127,4,126,10,127,35,128,128,128,128,0,65,128,225,0,107,34,11,36,128,128,128,128,0,66,0,33,12,65,0,66,0,55,3,168,153,130,128,0,65,0,66,0,55,3,176,
  153,130,128,0,65,0,66,0,55,3,184,153,130,128,0,65,0,66,0,55,3,192,153,130,128,0,65,0,66,0,55,3,200,153,130,128,0,65,0,66,0,55,3,208,153,130,128,0,32,11,65,244,224,0,106,66,0,55,2,0,32,11,65,204,
  224,0,106,65,48,106,65,0,54,2,0,32,11,32,5,54,2,224,96,32,11,32,4,54,2,220,96,32,11,32,3,54,2,216,96,32,11,32,0,54,2,204,96,32,11,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,34,
  13,253,11,2,228,96,65,0,65,0,54,2,160,153,130,128,0,65,0,65,0,54,2,164,153,130,128,0,32,11,32,2,54,2,212,96,32,11,32,1,54,2,208,96,65,0,32,13,253,11,4,240,153,130,128,0,65,0,32,13,253,11,4,224,
  153,130,128,0,32,1,65,177,207,217,178,1,108,65,177,207,217,178,1,106,32,0,65,173,214,211,190,2,108,65,218,172,167,253,4,106,115,32,2,65,236,200,137,157,125,108,65,216,145,147,186,122,106,115,34,2,65,16,118,32,2,115,65,173,
  234,172,255,7,108,34,2,65,15,118,32,2,115,65,139,205,178,163,120,108,34,2,65,16,118,32,2,115,33,14,65,185,243,221,241,121,33,3,65,0,33,2,65,0,33,5,65,0,33,15,65,0,33,16,65,0,33,17,65,0,33,18,66,0,
  33,19,66,0,33,20,66,0,33,21,66,0,33,22,66,0,33,23,65,0,33,24,66,0,33,25,65,0,33,26,3,64,32,2,65,1,118,65,248,255,255,255,7,113,65,224,153,130,128,0,106,34,4,32,2,65,240,137,128,128,0,106,44,0,
  0,34,1,65,6,106,172,32,5,65,60,113,173,134,32,4,41,3,0,132,55,3,0,2,64,32,1,69,13,0,32,1,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,3,115,34,4,65,16,118,32,4,115,65,173,234,172,255,7,108,
  34,4,65,15,118,32,4,115,65,139,205,178,163,120,108,34,27,65,16,118,33,28,32,1,32,1,65,31,117,34,4,115,32,4,107,34,4,65,6,116,32,2,32,2,65,56,115,32,1,65,0,74,34,29,27,106,65,2,116,34,30,65,204,152,
  128,128,0,106,40,2,0,32,4,65,2,116,65,176,138,128,128,0,106,40,2,0,34,31,106,33,32,65,1,33,33,65,1,65,127,32,29,27,33,34,32,30,65,204,138,128,128,0,106,40,2,0,32,31,106,33,30,2,64,32,4,65,254,255,
  255,255,7,113,65,2,70,13,0,65,2,33,33,32,4,65,4,70,13,0,32,4,65,5,70,65,2,116,33,33,11,32,14,32,28,115,33,14,32,32,32,34,108,33,28,32,30,32,34,108,33,34,66,1,32,12,134,33,35,2,64,2,64,32,
  1,65,1,72,34,1,13,0,65,0,32,20,32,35,132,34,20,55,3,208,153,130,128,0,12,1,11,65,0,32,19,32,35,132,34,19,55,3,200,153,130,128,0,11,32,14,32,27,115,33,14,32,28,32,16,106,33,16,32,34,32,17,106,33,
  17,32,33,32,15,106,33,15,2,64,2,64,2,64,2,64,2,64,32,4,65,127,106,14,5,0,5,2,1,4,5,11,65,1,32,5,65,28,113,116,33,4,32,1,13,2,65,0,32,26,32,4,106,34,26,54,2,164,153,130,128,0,65,0,
  32,25,32,35,132,34,25,55,3,192,153,130,128,0,12,3,11,2,64,32,1,13,0,65,0,32,22,32,35,132,34,22,55,3,176,153,130,128,0,12,3,11,65,0,32,21,32,35,132,34,21,55,3,168,153,130,128,0,12,2,11,32,11,65,
  204,224,0,106,65,44,65,48,32,29,27,106,34,1,32,1,40,2,0,65,1,106,54,2,0,12,2,11,65,0,32,24,32,4,106,34,24,54,2,160,153,130,128,0,65,0,32,23,32,35,132,34,23,55,3,184,153,130,128,0,11,32,18,65,
  1,106,33,18,11,32,3,65,185,243,221,241,121,106,33,3,32,2,65,1,106,33,2,32,5,65,4,106,33,5,32,12,66,1,124,34,12,66,192,0,82,13,0,11,32,11,32,15,54,2,244,96,32,11,32,16,54,2,240,96,32,11,32,17,
  54,2,236,96,32,11,32,14,54,2,232,96,32,11,32,18,54,2,228,96,65,0,33,5,2,64,65,0,45,0,128,154,130,128,0,13,0,65,0,33,2,66,0,33,12,3,64,66,129,130,132,136,144,160,192,128,1,32,5,65,7,113,34,1,
  65,127,106,34,4,173,134,66,129,130,132,136,144,160,192,128,1,32,12,66,7,131,134,132,34,35,32,35,66,129,130,132,136,144,160,192,128,1,32,1,27,66,129,130,132,136,144,160,192,128,1,32,1,65,1,106,34,34,173,134,132,32,1,65,
  7,70,34,33,27,34,35,66,127,32,12,134,66,127,133,131,33,19,32,35,66,0,66,126,32,12,134,32,12,66,63,81,27,131,33,22,32,5,65,56,113,34,29,65,120,106,33,3,2,64,2,64,32,12,66,56,84,13,0,66,0,33,35,66,
  0,66,1,32,4,32,3,106,173,134,32,4,65,7,75,27,66,1,32,3,32,1,114,173,134,132,66,0,66,1,32,34,32,3,106,173,134,32,33,27,132,33,20,12,1,11,32,29,65,8,106,33,29,2,64,32,12,66,8,84,13,0,66,0,
  33,35,66,0,33,20,2,64,32,4,65,7,75,13,0,66,1,32,4,32,3,114,173,134,33,20,66,1,32,4,32,29,114,173,134,33,35,11,32,20,66,1,32,3,32,1,114,173,134,132,33,20,32,35,66,1,32,29,32,1,114,173,134,132,
  33,35,32,33,13,1,32,20,66,1,32,34,32,3,114,173,134,132,33,20,32,35,66,1,32,34,32,29,114,173,134,132,33,35,12,1,11,66,0,33,20,66,0,66,1,32,4,32,29,106,173,134,32,4,65,7,75,27,66,1,32,12,66,8,
  124,134,132,66,0,66,1,32,34,32,29,106,173,134,32,33,27,132,33,35,11,32,2,65,144,158,130,128,0,106,32,19,55,3,0,32,2,65,144,154,130,128,0,106,32,22,55,3,0,32,2,65,144,162,130,128,0,106,32,35,55,3,0,32,
  2,65,144,166,130,128,0,106,32,20,55,3,0,32,5,65,1,106,33,5,32,2,65,8,106,33,2,32,12,66,1,124,34,12,66,192,0,82,13,0,11,65,0,65,1,58,0,128,154,130,128,0,11,2,64,65,0,45,0,144,170,130,128,0,
  13,0,65,0,33,27,66,0,33,21,65,0,33,34,3,64,66,1,32,34,65,248,255,255,255,7,113,34,31,65,16,106,34,3,32,34,65,7,113,34,29,65,1,106,34,28,106,173,134,66,0,32,29,65,7,71,34,30,27,66,0,32,34,65,
  48,73,34,14,27,33,12,32,34,65,3,118,34,2,65,1,106,33,33,32,29,65,2,106,33,1,2,64,32,34,65,55,75,34,15,13,0,32,29,65,5,75,13,0,66,1,32,33,65,3,116,32,1,106,173,134,32,12,132,33,12,11,32,2,
  65,127,106,33,16,32,34,65,120,106,33,5,2,64,32,29,65,5,75,13,0,32,5,65,63,75,13,0,32,12,66,1,32,16,65,3,116,32,1,106,173,134,132,33,12,11,32,34,65,112,106,33,1,32,2,65,126,106,33,17,2,64,32,29,
  65,7,70,34,4,13,0,32,1,65,63,75,13,0,32,12,66,1,32,17,65,3,116,32,28,106,173,134,132,33,12,11,32,29,65,127,106,33,2,2,64,32,1,65,63,75,13,0,32,2,65,7,75,13,0,32,12,66,1,32,17,65,3,116,
  32,2,106,173,134,132,33,12,11,32,29,65,126,106,33,1,2,64,32,5,65,63,75,34,28,13,0,32,1,65,7,75,13,0,32,12,66,1,32,16,65,3,116,32,1,106,173,134,132,33,12,11,32,27,173,66,7,131,33,23,2,64,32,15,
  13,0,32,1,65,7,75,13,0,32,12,66,1,32,33,65,3,116,32,1,106,173,134,132,33,12,11,32,27,65,7,113,33,17,32,21,66,3,136,34,19,66,1,124,33,36,32,23,66,1,124,33,22,66,0,33,35,32,34,65,3,116,34,33,
  65,160,241,129,128,0,106,32,12,66,1,32,3,32,2,106,173,134,66,0,32,2,65,8,73,27,66,0,32,14,27,132,55,3,0,65,255,1,33,5,65,255,1,33,1,66,0,33,12,2,64,32,15,13,0,65,255,1,33,1,66,0,33,12,
  32,4,13,0,66,1,32,36,66,3,134,32,22,124,34,20,134,33,12,32,20,167,33,1,32,17,65,5,75,13,0,32,21,66,47,86,13,0,32,21,66,248,255,255,255,255,255,255,255,255,0,131,32,23,132,34,20,167,34,3,65,18,106,32,
  1,32,1,65,255,1,70,27,33,1,66,128,128,16,32,20,134,32,12,132,33,12,32,17,65,4,75,13,0,32,21,66,39,86,13,0,32,3,65,27,106,32,1,32,1,65,255,1,70,27,33,1,66,128,128,128,192,0,32,20,134,32,12,132,
  33,12,32,27,65,29,116,65,29,117,65,0,72,13,0,32,21,66,31,86,13,0,32,3,65,36,106,32,1,32,1,65,255,1,70,27,33,1,66,128,128,128,128,128,2,32,20,134,32,12,132,33,12,32,17,65,2,75,13,0,32,21,66,23,
  86,13,0,32,3,65,45,106,32,1,32,1,65,255,1,70,27,33,1,66,128,128,128,128,128,128,8,32,20,134,32,12,132,33,12,32,17,65,1,75,13,0,32,21,66,15,86,13,0,32,3,65,54,106,32,1,32,1,65,255,1,70,27,33,
  1,66,128,128,128,128,128,128,128,32,32,20,134,32,12,132,33,12,32,17,13,0,32,21,66,7,86,13,0,32,3,65,63,106,32,1,32,1,65,255,1,70,27,33,1,66,128,128,128,128,128,128,128,128,128,127,32,20,134,32,12,132,33,12,
  11,32,33,65,160,149,130,128,0,106,32,1,58,0,0,32,34,65,6,116,34,14,65,160,245,129,128,0,106,32,12,55,3,0,2,64,32,4,13,0,32,28,13,0,66,1,32,16,65,3,116,32,22,167,106,34,5,173,134,33,35,32,17,65,
  5,75,13,0,32,16,69,13,0,32,31,32,17,114,34,4,65,114,106,34,1,32,5,32,5,65,255,1,70,27,33,5,66,1,32,1,173,134,32,35,132,33,35,32,17,65,4,75,13,0,32,16,65,2,73,13,0,32,4,65,107,106,34,1,
  32,5,32,5,65,255,1,70,27,33,5,66,1,32,1,173,134,32,35,132,33,35,32,27,65,29,116,65,29,117,65,0,72,13,0,32,16,65,3,73,13,0,32,4,65,100,106,34,1,32,5,32,5,65,255,1,70,27,33,5,66,1,32,1,
  173,134,32,35,132,33,35,32,17,65,2,75,13,0,32,16,65,4,73,13,0,32,4,65,93,106,34,1,32,5,32,5,65,255,1,70,27,33,5,66,1,32,1,173,134,32,35,132,33,35,32,17,65,1,75,13,0,32,16,65,5,73,13,0,
  32,4,65,86,106,34,1,32,5,32,5,65,255,1,70,27,33,5,66,1,32,1,173,134,32,35,132,33,35,32,17,13,0,32,16,65,6,73,13,0,32,4,65,79,106,34,1,32,5,32,5,65,255,1,70,27,33,5,66,1,32,1,173,134,
  32,35,132,33,35,11,32,33,65,161,149,130,128,0,106,32,5,58,0,0,32,14,65,168,245,129,128,0,106,32,35,55,3,0,66,0,33,20,65,255,1,33,5,65,255,1,33,1,66,0,33,12,2,64,32,15,13,0,65,255,1,33,1,66,
  0,33,12,32,2,65,7,75,13,0,66,1,32,36,66,3,134,32,23,66,127,124,66,255,255,255,255,15,131,34,35,124,34,25,134,33,12,32,25,167,33,1,32,35,66,127,124,34,25,66,248,255,255,255,15,131,66,0,82,13,0,32,21,66,
  47,86,13,0,32,21,66,248,255,255,255,255,255,255,255,255,0,131,34,37,32,25,124,66,16,124,34,25,167,32,1,32,1,65,255,1,70,27,33,1,66,1,32,25,134,32,12,132,33,12,32,35,66,126,124,34,25,66,248,255,255,255,15,131,
  66,0,82,13,0,32,21,66,39,86,13,0,32,37,32,25,124,66,24,124,34,25,167,32,1,32,1,65,255,1,70,27,33,1,66,1,32,25,134,32,12,132,33,12,32,35,66,125,124,34,25,66,248,255,255,255,15,131,66,0,82,13,0,32,
  21,66,31,86,13,0,32,37,32,25,124,66,32,124,34,25,167,32,1,32,1,65,255,1,70,27,33,1,66,1,32,25,134,32,12,132,33,12,32,35,66,124,124,34,25,66,248,255,255,255,15,131,66,0,82,13,0,32,21,66,23,86,13,0,
  32,37,32,25,124,66,40,124,34,25,167,32,1,32,1,65,255,1,70,27,33,1,66,1,32,25,134,32,12,132,33,12,32,35,66,123,124,34,25,66,248,255,255,255,15,131,66,0,82,13,0,32,21,66,15,86,13,0,32,37,32,25,124,66,
  48,124,34,25,167,32,1,32,1,65,255,1,70,27,33,1,66,1,32,25,134,32,12,132,33,12,32,35,66,122,124,34,35,66,248,255,255,255,15,131,66,0,82,13,0,32,21,66,7,86,13,0,32,37,32,35,124,66,56,124,34,35,167,32,
  1,32,1,65,255,1,70,27,33,1,66,1,32,35,134,32,12,132,33,12,11,32,16,173,33,37,32,34,65,120,113,34,3,32,17,114,33,31,32,33,65,162,149,130,128,0,106,32,1,58,0,0,32,14,65,176,245,129,128,0,106,32,12,55,
  3,0,2,64,32,28,13,0,32,2,65,7,75,13,0,32,31,65,119,106,33,1,32,17,65,127,106,173,66,127,124,33,12,65,255,1,33,5,66,0,33,20,32,37,33,35,3,64,32,1,32,5,32,5,65,255,1,70,27,33,5,66,1,32,
  1,173,134,32,20,132,33,20,32,12,66,248,255,255,255,15,131,66,0,82,13,1,32,12,66,127,124,33,12,32,1,65,119,106,33,1,32,35,66,0,85,33,4,32,35,66,127,124,33,35,32,4,13,0,11,11,32,33,65,163,149,130,128,0,
  106,32,5,58,0,0,32,14,65,184,245,129,128,0,106,32,20,55,3,0,2,64,2,64,2,64,32,30,13,0,32,33,65,164,149,130,128,0,106,65,255,1,58,0,0,32,14,65,192,245,129,128,0,106,66,0,55,3,0,12,1,11,32,19,
  167,65,3,116,33,4,32,21,66,120,131,33,38,32,23,66,7,133,34,12,66,3,131,33,19,2,64,2,64,32,23,66,124,124,66,3,90,13,0,65,255,1,33,1,66,0,33,12,12,1,11,32,38,32,23,132,33,22,32,4,32,17,114,65,
  4,106,33,5,32,12,66,4,131,33,25,65,255,1,33,1,66,0,33,12,66,0,33,20,3,64,32,5,32,5,65,127,106,32,5,65,126,106,32,5,65,125,106,32,1,32,1,65,255,1,70,27,34,1,32,1,65,255,1,70,27,34,1,32,
  1,65,255,1,70,27,34,1,32,1,65,255,1,70,27,33,1,66,1,32,22,32,20,124,34,35,66,4,124,134,66,1,32,35,66,3,124,134,66,1,32,35,66,2,124,134,66,1,32,35,66,1,124,134,32,12,132,132,132,132,33,12,32,5,
  65,4,106,33,5,32,25,32,20,66,4,124,34,20,82,13,0,11,32,23,32,20,124,66,1,124,33,22,11,2,64,32,19,80,13,0,32,22,32,38,124,33,35,32,4,32,22,167,106,33,5,3,64,32,5,32,1,32,1,65,255,1,70,27,
  33,1,32,5,65,1,106,33,5,66,1,32,35,134,32,12,132,33,12,32,35,66,1,124,33,35,32,19,66,127,124,34,19,66,0,82,13,0,11,11,32,33,65,164,149,130,128,0,106,32,1,58,0,0,32,14,65,192,245,129,128,0,106,32,
  12,55,3,0,32,2,65,7,77,13,0,66,0,33,12,65,255,1,33,1,12,1,11,65,255,1,33,1,66,0,33,12,3,64,32,3,32,2,106,34,5,32,1,32,1,65,255,1,70,27,33,1,66,1,32,5,173,134,32,12,132,33,12,32,
  2,65,127,106,34,2,65,8,73,13,0,11,11,32,33,65,165,149,130,128,0,106,32,1,58,0,0,32,14,65,200,245,129,128,0,106,32,12,55,3,0,66,0,33,12,65,255,1,33,1,65,255,1,33,2,66,0,33,35,2,64,32,15,13,
  0,66,1,32,36,66,3,134,32,29,173,34,19,132,34,20,134,33,35,32,20,167,33,2,32,21,66,47,86,13,0,32,21,66,56,131,32,19,132,34,22,66,16,124,34,20,167,32,2,32,2,65,255,1,70,27,33,2,66,1,32,20,134,32,
  35,132,33,35,32,21,66,39,86,13,0,66,1,32,22,66,24,124,134,32,35,132,33,35,32,21,66,31,86,13,0,66,1,32,21,66,24,131,32,19,132,34,20,66,32,132,134,32,35,132,33,35,32,21,66,23,86,13,0,66,1,32,20,66,
  40,124,134,32,35,132,33,35,32,21,66,15,86,13,0,66,1,32,21,66,8,131,32,19,132,66,48,132,134,32,35,132,33,35,32,21,66,7,86,13,0,66,1,32,19,66,56,132,134,32,35,132,33,35,11,32,33,65,166,149,130,128,0,106,
  32,2,58,0,0,32,14,65,208,245,129,128,0,106,32,35,55,3,0,2,64,32,28,13,0,2,64,2,64,32,16,13,0,65,255,1,33,1,66,0,33,12,32,37,33,35,12,1,11,32,31,65,112,106,33,2,32,37,66,1,124,66,254,255,
  255,255,31,131,33,20,65,255,1,33,1,66,0,33,12,32,37,33,35,3,64,32,2,32,2,65,8,106,34,5,32,1,32,1,65,255,1,70,27,34,1,32,1,65,255,1,70,27,33,1,66,1,32,2,173,134,66,1,32,5,173,134,32,12,
  132,132,33,12,32,2,65,112,106,33,2,32,35,66,126,124,33,35,32,20,66,126,124,34,20,66,0,82,13,0,11,11,32,37,167,65,1,113,13,0,32,35,167,65,3,116,32,29,114,34,2,32,1,32,1,65,255,1,70,27,33,1,66,1,
  32,2,173,134,32,12,132,33,12,11,32,33,65,167,149,130,128,0,106,32,1,58,0,0,32,14,65,216,245,129,128,0,106,32,12,55,3,0,32,27,65,1,106,33,27,32,34,65,1,106,33,34,32,21,66,1,124,34,21,66,192,0,82,13,
  0,11,65,0,65,1,58,0,144,170,130,128,0,11,65,0,33,29,65,0,32,7,54,2,232,239,129,128,0,65,0,32,8,54,2,236,239,129,128,0,65,0,32,9,54,2,244,239,129,128,0,65,0,65,0,32,0,107,54,2,248,239,129,128,
  0,65,0,65,0,40,2,252,239,129,128,0,65,1,106,34,2,65,1,32,2,65,1,75,27,34,3,54,2,252,239,129,128,0,65,0,65,0,54,2,224,239,129,128,0,65,0,65,0,58,0,240,239,129,128,0,65,0,65,0,54,2,228,239,
  129,128,0,2,64,32,10,65,1,72,13,0,32,10,65,0,32,10,65,0,74,27,34,2,65,128,4,32,2,65,128,4,73,27,33,0,3,64,32,29,65,34,108,34,2,65,250,215,128,128,0,106,47,1,0,34,5,173,66,16,134,32,2,65,
  248,215,128,128,0,106,47,1,0,34,4,173,132,32,2,65,252,215,128,128,0,106,47,1,0,34,34,173,66,32,134,132,32,2,65,254,215,128,128,0,106,47,1,0,34,33,173,66,48,134,132,33,19,32,2,65,242,215,128,128,0,106,47,1,
  0,34,14,173,66,16,134,32,2,65,240,215,128,128,0,106,47,1,0,34,15,173,132,32,2,65,244,215,128,128,0,106,47,1,0,34,16,173,66,32,134,132,32,2,65,246,215,128,128,0,106,47,1,0,34,17,173,66,48,134,132,33,20,32,
  2,65,234,215,128,128,0,106,47,1,0,34,27,173,66,16,134,32,2,65,232,215,128,128,0,106,47,1,0,34,28,173,132,32,2,65,236,215,128,128,0,106,47,1,0,34,30,173,66,32,134,132,32,2,65,238,215,128,128,0,106,47,1,0,
  34,31,173,66,48,134,132,33,35,32,2,65,226,215,128,128,0,106,47,1,0,34,32,173,66,16,134,32,2,65,224,215,128,128,0,106,47,1,0,34,18,173,132,32,2,65,228,215,128,128,0,106,47,1,0,34,26,173,66,32,134,132,32,2,
  65,230,215,128,128,0,106,47,1,0,34,24,173,66,48,134,132,33,12,65,128,8,33,1,32,18,65,197,187,242,136,120,115,65,147,131,128,8,108,32,32,115,65,147,131,128,8,108,32,26,115,65,147,131,128,8,108,32,24,115,65,147,131,128,
  8,108,32,28,115,65,147,131,128,8,108,32,27,115,65,147,131,128,8,108,32,30,115,65,147,131,128,8,108,32,31,115,65,147,131,128,8,108,32,15,115,65,147,131,128,8,108,32,14,115,65,147,131,128,8,108,32,16,115,65,147,131,128,8,
  108,32,17,115,65,147,131,128,8,108,32,4,115,65,147,131,128,8,108,32,5,115,65,147,131,128,8,108,32,34,115,65,147,131,128,8,108,32,33,115,65,147,131,128,8,108,32,2,65,128,216,128,128,0,106,47,1,0,34,33,115,65,147,131,
  128,8,108,34,4,33,2,2,64,3,64,2,64,32,2,65,255,7,113,34,5,65,48,108,34,2,65,160,170,130,128,0,106,34,34,40,2,0,32,3,70,13,0,32,34,32,3,54,2,0,32,2,65,164,170,130,128,0,106,32,4,54,2,0,
  32,2,65,200,170,130,128,0,106,32,19,55,3,0,32,2,65,192,170,130,128,0,106,32,20,55,3,0,32,2,65,184,170,130,128,0,106,32,35,55,3,0,32,2,65,176,170,130,128,0,106,32,12,55,3,0,32,2,65,172,170,130,128,0,
  106,32,33,59,1,0,32,2,65,168,170,130,128,0,106,32,29,65,2,116,65,224,223,129,128,0,106,40,2,0,54,2,0,12,2,11,2,64,32,2,65,164,170,130,128,0,106,40,2,0,32,4,71,13,0,32,2,65,172,170,130,128,0,106,
  47,1,0,32,33,71,13,0,32,2,65,176,170,130,128,0,106,41,3,0,32,12,82,13,0,32,2,65,184,170,130,128,0,106,41,3,0,32,35,82,13,0,32,2,65,192,170,130,128,0,106,41,3,0,32,20,82,13,0,32,2,65,200,170,
  130,128,0,106,41,3,0,32,19,82,13,0,32,2,65,168,170,130,128,0,106,32,29,65,2,116,65,224,223,129,128,0,106,40,2,0,54,2,0,12,2,11,32,5,65,1,106,33,2,32,1,65,127,106,34,1,13,0,11,11,32,29,65,1,
  106,34,29,32,0,71,13,0,11,11,65,0,33,7,65,0,65,0,54,2,132,240,129,128,0,65,0,65,0,54,2,128,240,129,128,0,65,0,65,0,54,2,136,240,129,128,0,65,0,65,0,54,2,140,240,129,128,0,65,144,240,129,128,0,
  65,0,65,128,1,252,11,0,2,64,32,11,65,204,224,0,106,65,0,16,148,128,128,128,0,34,0,69,13,0,2,64,32,0,65,1,72,13,0,32,11,40,2,204,96,33,4,65,0,33,2,32,0,33,5,3,64,32,11,65,192,16,106,32,
  2,106,65,0,54,2,0,32,11,65,192,208,0,106,32,2,106,32,2,65,208,166,128,128,0,106,40,2,0,34,1,54,2,0,32,11,65,204,224,0,106,32,11,65,192,192,0,106,32,1,32,11,65,192,32,106,16,149,128,128,128,0,32,11,
  65,192,48,106,32,2,106,65,0,32,11,65,192,192,0,106,16,150,128,128,128,0,107,54,2,0,32,4,32,1,32,11,65,192,32,106,16,151,128,128,128,0,32,2,65,4,106,33,2,32,5,65,127,106,34,5,13,0,11,32,0,65,1,70,
  13,0,65,0,33,18,65,2,33,26,65,1,33,31,3,64,32,11,65,192,208,0,106,32,31,65,2,116,34,2,106,40,2,0,34,28,65,7,113,33,14,32,28,65,9,118,65,7,113,33,24,32,28,65,6,118,65,7,113,33,32,32,28,65,
  3,118,65,7,113,33,27,32,28,65,18,118,65,7,113,65,126,106,34,17,65,2,116,65,224,137,128,128,0,106,33,30,32,11,65,192,48,106,32,2,106,40,2,0,33,33,32,18,33,2,32,26,33,3,32,31,33,4,2,64,2,64,3,64,
  2,64,2,64,32,11,65,192,48,106,32,2,106,34,34,40,2,0,34,5,32,33,78,13,0,32,11,65,192,208,0,106,32,2,106,40,2,0,33,1,12,1,11,32,5,32,33,71,13,3,65,0,33,15,65,0,33,16,2,64,32,11,65,192,
  208,0,106,32,2,106,40,2,0,34,1,65,18,118,65,7,113,65,126,106,34,29,65,3,75,13,0,32,29,65,2,116,65,224,137,128,128,0,106,40,2,0,33,16,11,32,1,65,7,113,33,29,2,64,32,17,65,3,75,13,0,32,30,40,
  2,0,33,15,11,32,29,32,14,73,13,3,32,29,32,14,75,13,0,32,1,65,3,118,65,7,113,34,29,32,27,73,13,3,32,29,32,27,75,13,0,32,1,65,6,118,65,7,113,34,29,32,32,73,13,3,32,29,32,32,75,13,0,32,
  1,65,9,118,65,7,113,34,29,32,24,73,13,2,32,29,32,24,75,13,0,32,16,32,15,77,13,3,11,32,34,65,4,106,32,5,54,2,0,32,11,65,192,208,0,106,32,2,106,65,4,106,32,1,54,2,0,32,11,65,192,16,106,32,
  2,106,34,1,65,4,106,32,1,40,2,0,54,2,0,32,4,65,127,106,33,4,32,2,65,124,106,33,2,32,3,65,127,106,34,3,65,1,74,13,0,11,65,0,33,4,12,1,11,32,3,65,127,106,33,4,11,32,11,65,192,48,106,32,
  4,65,2,116,34,2,106,32,33,54,2,0,32,11,65,192,208,0,106,32,2,106,32,28,54,2,0,32,11,65,192,16,106,32,2,106,65,0,54,2,0,32,18,65,4,106,33,18,32,26,65,1,106,33,26,32,31,65,1,106,34,31,32,0,
  71,13,0,11,11,2,64,2,64,32,6,65,1,78,13,0,32,0,33,7,12,1,11,65,3,65,59,32,11,40,2,204,96,34,1,65,0,74,34,2,27,33,39,65,0,65,56,32,2,27,33,40,65,5,65,61,32,2,27,33,41,65,7,65,
  63,32,2,27,33,42,32,1,65,3,116,33,43,32,11,65,192,192,0,106,65,124,106,33,44,32,11,65,192,0,106,65,124,106,33,45,32,11,65,192,32,106,65,124,106,33,46,65,1,33,47,32,0,33,7,3,64,65,0,32,47,54,2,144,
  241,129,128,0,65,0,65,0,58,0,240,239,129,128,0,2,64,2,64,32,7,65,1,72,13,0,32,47,65,127,106,33,48,65,128,166,187,118,33,28,65,0,33,27,32,44,33,32,32,45,33,18,32,46,33,26,3,64,32,11,65,204,224,0,
  106,32,11,65,12,106,32,11,65,192,208,0,106,32,27,65,2,116,106,40,2,0,34,14,32,11,65,10,106,16,149,128,128,128,0,32,14,65,63,113,33,3,32,14,65,6,118,33,1,32,11,65,12,106,32,48,65,128,166,187,118,65,0,32,
  28,107,65,1,32,14,16,152,128,128,128,0,33,34,32,41,33,2,32,42,33,5,2,64,2,64,32,14,65,128,128,128,4,113,13,0,32,39,33,2,32,40,33,5,32,14,65,128,128,128,8,113,69,13,1,11,32,5,32,2,65,240,137,128,
  128,0,106,34,4,44,0,0,16,153,128,128,128,0,2,64,32,4,44,0,0,34,5,69,13,0,65,208,153,130,128,0,65,200,153,130,128,0,32,5,65,0,74,27,34,33,32,33,41,3,0,66,126,32,2,173,137,34,12,131,55,3,0,2,
  64,2,64,32,5,65,31,117,34,33,65,127,115,32,5,32,33,115,106,14,4,0,2,2,1,2,11,65,127,32,2,65,2,116,116,33,33,2,64,32,5,65,1,72,13,0,65,0,65,0,41,3,192,153,130,128,0,32,12,131,55,3,192,153,
  130,128,0,65,0,65,0,40,2,164,153,130,128,0,32,33,106,54,2,164,153,130,128,0,12,2,11,65,0,65,0,41,3,184,153,130,128,0,32,12,131,55,3,184,153,130,128,0,65,0,65,0,40,2,160,153,130,128,0,32,33,106,54,2,
  160,153,130,128,0,12,1,11,2,64,32,5,65,1,72,13,0,65,0,65,0,41,3,176,153,130,128,0,32,12,131,55,3,176,153,130,128,0,12,1,11,65,0,65,0,41,3,168,153,130,128,0,32,12,131,55,3,168,153,130,128,0,11,32,
  4,65,0,58,0,0,32,2,65,1,118,65,24,113,65,224,153,130,128,0,106,34,5,32,5,41,3,0,66,15,32,2,65,2,116,65,60,113,173,34,12,134,66,127,133,131,66,6,32,12,134,132,55,3,0,11,32,1,65,63,113,33,2,32,
  3,32,11,44,0,10,16,153,128,128,128,0,2,64,32,14,65,128,128,128,2,113,69,13,0,2,64,32,2,65,240,137,128,128,0,106,34,4,44,0,0,34,5,69,13,0,65,208,153,130,128,0,65,200,153,130,128,0,32,5,65,0,74,27,
  34,3,32,3,41,3,0,66,126,32,2,173,137,34,12,131,55,3,0,2,64,2,64,32,5,65,31,117,34,3,65,127,115,32,5,32,3,115,106,14,4,0,2,2,1,2,11,65,127,32,1,65,2,116,116,33,3,2,64,32,5,65,1,72,
  13,0,65,0,65,0,41,3,192,153,130,128,0,32,12,131,55,3,192,153,130,128,0,65,0,65,0,40,2,164,153,130,128,0,32,3,106,54,2,164,153,130,128,0,12,2,11,65,0,65,0,41,3,184,153,130,128,0,32,12,131,55,3,184,
  153,130,128,0,65,0,65,0,40,2,160,153,130,128,0,32,3,106,54,2,160,153,130,128,0,12,1,11,2,64,32,5,65,1,72,13,0,65,0,65,0,41,3,176,153,130,128,0,32,12,131,55,3,176,153,130,128,0,12,1,11,65,0,65,
  0,41,3,168,153,130,128,0,32,12,131,55,3,168,153,130,128,0,11,32,4,65,0,58,0,0,32,2,65,1,118,65,24,113,65,224,153,130,128,0,106,34,5,32,5,41,3,0,66,15,32,1,65,2,116,65,60,113,173,34,12,134,66,127,
  133,131,66,6,32,12,134,132,55,3,0,32,2,32,43,107,33,2,11,32,2,32,11,44,0,11,16,153,128,128,128,0,65,0,45,0,240,239,129,128,0,13,4,65,0,33,10,32,28,65,128,166,187,118,70,32,28,65,0,32,34,107,34,33,
  72,114,33,9,2,64,32,27,69,13,0,32,1,65,7,113,33,0,32,14,65,7,113,33,15,32,14,65,9,118,65,7,113,33,8,32,14,65,3,118,65,7,113,33,31,32,14,65,18,118,65,7,113,65,126,106,34,30,65,2,116,65,224,137,
  128,128,0,106,33,24,32,32,33,1,32,18,33,5,32,26,33,2,32,27,33,34,3,64,2,64,2,64,32,2,40,2,0,34,3,32,33,78,13,0,32,1,40,2,0,33,4,12,1,11,2,64,32,3,32,33,70,13,0,32,34,33,10,12,
  3,11,65,0,33,16,65,0,33,17,2,64,32,1,40,2,0,34,4,65,18,118,65,7,113,65,126,106,34,29,65,3,75,13,0,32,29,65,2,116,65,224,137,128,128,0,106,40,2,0,33,17,11,32,4,65,7,113,33,29,2,64,32,30,
  65,3,75,13,0,32,24,40,2,0,33,16,11,2,64,32,29,32,15,79,13,0,32,34,33,10,12,3,11,32,29,32,15,75,13,0,2,64,32,4,65,3,118,65,7,113,34,29,32,31,79,13,0,32,34,33,10,12,3,11,32,29,32,31,
  75,13,0,2,64,32,4,65,6,118,65,7,113,34,29,32,0,79,13,0,32,34,33,10,12,3,11,32,29,32,0,75,13,0,2,64,32,4,65,9,118,65,7,113,34,29,32,8,79,13,0,32,34,33,10,12,3,11,32,29,32,8,75,13,
  0,32,17,32,16,75,13,0,32,34,33,10,12,2,11,32,2,65,4,106,32,3,54,2,0,32,1,65,4,106,32,4,54,2,0,32,5,65,4,106,32,5,40,2,0,54,2,0,32,1,65,124,106,33,1,32,5,65,124,106,33,5,32,2,
  65,124,106,33,2,32,34,65,127,106,34,34,65,1,106,65,1,75,13,0,11,11,32,11,65,192,32,106,32,10,65,2,116,34,2,106,32,33,54,2,0,32,11,65,192,192,0,106,32,2,106,32,14,54,2,0,32,11,65,192,0,106,32,2,
  106,32,9,54,2,0,32,11,40,2,200,32,32,28,32,27,65,1,75,27,33,28,32,32,65,4,106,33,32,32,18,65,4,106,33,18,32,26,65,4,106,33,26,32,27,65,1,106,34,27,32,7,71,13,0,11,32,11,65,192,208,0,106,32,
  11,65,192,192,0,106,32,7,65,2,116,34,2,252,10,0,0,32,11,65,192,48,106,32,11,65,192,32,106,32,2,252,10,0,0,32,11,65,192,16,106,32,11,65,192,0,106,32,2,252,10,0,0,65,0,32,47,54,2,228,239,129,128,0,
  32,11,40,2,192,48,34,2,32,2,65,31,117,34,2,115,32,2,107,65,156,217,196,9,75,13,3,32,47,32,6,72,13,1,12,3,11,65,0,33,7,65,0,32,47,54,2,228,239,129,128,0,32,47,32,6,78,13,3,11,32,47,65,1,
  106,33,47,12,0,11,11,32,7,65,1,72,13,0,65,208,166,128,128,0,32,11,65,192,208,0,106,32,7,65,2,116,34,2,252,10,0,0,65,240,182,128,128,0,32,11,65,192,48,106,32,2,252,10,0,0,65,240,198,128,128,0,32,11,
  65,192,16,106,32,2,252,10,0,0,11,32,11,65,128,225,0,106,36,128,128,128,128,0,32,7,11,204,25,2,2,126,35,127,65,0,65,0,41,3,200,153,130,128,0,34,2,65,0,41,3,208,153,130,128,0,34,3,132,55,3,232,182,128,
  128,0,32,0,65,12,65,16,32,0,40,2,0,34,4,65,0,74,34,5,27,106,40,2,0,33,6,65,0,65,1,58,0,208,182,128,128,0,65,0,32,4,54,2,212,182,128,128,0,65,0,32,6,54,2,216,182,128,128,0,65,0,32,1,
  54,2,220,182,128,128,0,65,0,65,0,54,2,224,182,128,128,0,65,0,33,6,2,64,2,64,32,3,32,2,32,5,27,34,2,80,13,0,32,0,40,2,8,33,7,65,7,65,0,32,4,65,1,70,34,5,27,33,8,65,1,65,6,32,
  5,27,33,9,32,0,40,2,4,34,0,65,2,113,33,10,32,0,65,1,113,33,11,32,0,65,8,113,33,12,32,0,65,4,113,33,13,32,4,65,4,116,33,14,32,4,65,3,116,33,15,65,0,32,4,107,33,16,3,64,32,2,122,34,
  3,167,34,17,65,3,118,33,18,32,17,65,7,113,33,19,2,64,2,64,2,64,2,64,2,64,32,17,65,240,137,128,128,0,106,34,20,45,0,0,34,0,32,0,192,65,7,117,34,0,115,32,0,107,65,255,1,113,34,21,65,127,106,14,
  2,1,0,3,11,32,18,65,2,106,33,22,32,19,65,1,106,33,0,32,19,65,7,70,34,6,13,1,32,17,65,47,75,13,1,2,64,32,22,65,3,116,32,0,106,34,5,65,240,137,128,128,0,106,44,0,0,34,20,69,13,0,65,1,
  65,127,32,20,65,0,74,27,32,16,71,13,2,11,32,17,32,5,65,0,65,0,16,136,128,128,128,0,69,13,1,65,1,15,11,2,64,32,15,32,17,106,34,0,65,63,75,13,0,32,0,65,240,137,128,128,0,106,45,0,0,13,0,65,
  0,33,5,2,64,32,0,65,3,118,34,20,32,8,71,13,0,65,1,33,6,32,17,32,0,65,5,65,0,16,136,128,128,128,0,13,7,32,17,32,0,65,4,65,0,16,136,128,128,128,0,13,7,65,2,33,5,32,17,32,0,65,3,65,
  0,16,136,128,128,128,0,13,7,11,2,64,32,17,32,0,32,5,65,0,16,136,128,128,128,0,69,13,0,65,1,15,11,32,18,32,9,71,13,0,32,20,32,8,70,13,0,32,14,32,17,106,34,5,65,240,137,128,128,0,106,45,0,0,
  13,0,65,1,33,6,32,17,32,5,65,0,65,1,16,136,128,128,128,0,13,6,11,2,64,32,19,69,13,0,32,0,65,191,127,106,65,64,73,13,0,2,64,32,0,65,127,106,34,5,65,240,137,128,128,0,106,44,0,0,34,6,69,13,
  0,65,1,65,127,32,6,65,0,74,27,32,16,71,13,0,65,0,33,20,2,64,32,5,65,3,118,32,8,71,13,0,65,1,33,6,32,17,32,5,65,5,65,0,16,136,128,128,128,0,13,8,32,17,32,5,65,4,65,0,16,136,128,128,
  128,0,13,8,65,2,33,20,32,17,32,5,65,3,65,0,16,136,128,128,128,0,13,8,11,32,17,32,5,32,20,65,0,16,136,128,128,128,0,69,13,1,65,1,15,11,32,5,32,7,71,13,0,32,17,32,7,65,0,65,2,16,136,128,
  128,128,0,69,13,0,65,1,15,11,32,19,65,7,70,13,2,32,0,65,65,106,65,64,73,13,2,2,64,32,0,65,1,106,34,0,65,240,137,128,128,0,106,44,0,0,34,5,69,13,0,65,1,65,127,32,5,65,0,74,27,32,16,71,
  13,0,65,0,33,5,2,64,32,0,65,3,118,32,8,71,13,0,65,1,33,6,32,17,32,0,65,5,65,0,16,136,128,128,128,0,13,7,32,17,32,0,65,4,65,0,16,136,128,128,128,0,13,7,65,2,33,5,32,17,32,0,65,3,
  65,0,16,136,128,128,128,0,13,7,11,32,17,32,0,32,5,65,0,16,136,128,128,128,0,69,13,3,65,1,15,11,32,0,32,7,71,13,2,32,17,32,7,65,0,65,2,16,136,128,128,128,0,69,13,2,65,1,15,11,32,18,65,1,
  106,33,23,32,19,65,2,106,33,5,2,64,32,19,65,5,75,34,20,13,0,32,18,65,7,70,13,0,2,64,32,23,65,3,116,32,5,106,34,24,65,240,137,128,128,0,106,44,0,0,34,25,69,13,0,65,1,65,127,32,25,65,0,74,
  27,32,16,71,13,1,11,32,17,32,24,65,0,65,0,16,136,128,128,128,0,69,13,0,65,1,15,11,32,18,65,127,106,33,24,2,64,32,20,13,0,32,17,65,8,73,13,0,2,64,32,24,65,3,116,32,5,106,34,5,65,240,137,128,
  128,0,106,44,0,0,34,20,69,13,0,65,1,65,127,32,20,65,0,74,27,32,16,71,13,1,11,32,17,32,5,65,0,65,0,16,136,128,128,128,0,69,13,0,65,1,15,11,32,18,65,126,106,33,5,2,64,32,6,13,0,32,17,65,
  16,73,13,0,2,64,32,5,65,3,116,32,0,106,34,0,65,240,137,128,128,0,106,44,0,0,34,6,69,13,0,65,1,65,127,32,6,65,0,74,27,32,16,71,13,1,11,32,17,32,0,65,0,65,0,16,136,128,128,128,0,69,13,0,
  65,1,15,11,2,64,32,19,65,127,106,34,0,65,7,75,34,6,13,0,32,17,65,16,73,13,0,2,64,32,5,65,3,116,32,0,106,34,5,65,240,137,128,128,0,106,44,0,0,34,20,69,13,0,65,1,65,127,32,20,65,0,74,27,
  32,16,71,13,1,11,32,17,32,5,65,0,65,0,16,136,128,128,128,0,69,13,0,65,1,15,11,2,64,32,19,65,126,106,34,5,65,7,75,34,20,13,0,32,17,65,8,73,13,0,2,64,32,24,65,3,116,32,5,106,34,24,65,240,
  137,128,128,0,106,44,0,0,34,25,69,13,0,65,1,65,127,32,25,65,0,74,27,32,16,71,13,1,11,32,17,32,24,65,0,65,0,16,136,128,128,128,0,69,13,0,65,1,15,11,2,64,32,20,13,0,32,18,65,7,70,13,0,2,
  64,32,23,65,3,116,32,5,106,34,5,65,240,137,128,128,0,106,44,0,0,34,20,69,13,0,65,1,65,127,32,20,65,0,74,27,32,16,71,13,1,11,32,17,32,5,65,0,65,0,16,136,128,128,128,0,69,13,0,65,1,15,11,32,
  6,13,1,32,17,65,47,75,13,1,2,64,32,22,65,3,116,32,0,106,34,0,65,240,137,128,128,0,106,44,0,0,34,5,69,13,0,65,1,65,127,32,5,65,0,74,27,32,16,71,13,2,11,32,17,32,0,65,0,65,0,16,136,128,
  128,128,0,69,13,1,65,1,15,11,2,64,32,21,65,4,70,65,3,116,34,26,65,8,65,16,32,21,65,3,70,27,34,27,79,13,0,65,0,65,0,40,2,212,182,128,128,0,107,33,28,65,0,41,3,232,182,128,128,0,66,126,32,3,
  137,131,33,3,65,0,40,2,216,182,128,128,0,33,29,65,0,45,0,208,182,128,128,0,33,30,65,0,40,2,224,182,128,128,0,33,31,65,0,40,2,220,182,128,128,0,33,32,3,64,32,26,65,2,116,34,0,65,132,136,128,128,0,106,
  40,2,0,33,24,32,0,65,128,136,128,128,0,106,40,2,0,33,25,2,64,2,64,2,64,32,32,65,1,70,13,0,32,24,65,9,116,32,25,65,6,116,106,33,33,32,19,32,25,106,34,22,32,18,32,24,106,34,6,65,3,116,106,34,
  0,65,6,116,33,23,32,25,32,24,65,3,116,106,33,34,32,31,33,35,3,64,32,22,65,7,75,13,3,32,6,65,0,72,13,3,32,6,65,7,74,13,3,32,0,65,240,137,128,128,0,106,34,36,45,0,0,34,37,13,2,32,20,45,
  0,0,33,5,32,20,65,0,58,0,0,32,0,65,240,137,128,128,0,106,34,37,32,5,58,0,0,32,0,32,29,32,5,32,5,192,65,7,117,34,36,115,32,36,107,65,255,1,113,34,38,65,6,70,27,33,36,2,64,2,64,32,30,65,
  1,113,69,13,0,32,36,32,28,32,3,66,1,32,0,173,134,132,16,137,128,128,128,0,33,36,12,1,11,32,36,32,28,16,134,128,128,128,0,33,36,11,32,20,32,5,58,0,0,32,37,65,0,58,0,0,2,64,32,36,13,0,2,64,
  32,32,65,2,71,13,0,65,1,15,11,65,0,32,35,65,1,106,34,31,54,2,224,182,128,128,0,32,35,65,2,116,65,208,166,128,128,0,106,32,23,32,38,65,12,116,114,32,17,114,54,2,0,32,31,33,35,11,32,6,32,24,106,33,
  6,32,22,32,25,106,33,22,32,23,32,33,106,33,23,32,0,32,34,106,33,0,32,21,65,6,71,13,0,12,3,11,11,32,19,32,25,106,34,6,65,8,73,32,18,32,24,106,34,0,65,127,74,113,32,0,65,8,72,113,33,5,2,64,
  32,21,65,6,71,13,0,32,5,69,13,2,32,0,65,3,116,32,6,106,34,0,65,240,137,128,128,0,106,34,36,45,0,0,34,37,69,13,2,12,1,11,32,5,69,13,1,32,6,32,0,65,3,116,106,33,0,32,18,32,24,65,1,116,
  106,33,5,32,25,32,24,65,3,116,106,33,23,32,19,32,25,65,1,116,106,33,6,3,64,32,0,65,240,137,128,128,0,106,34,36,45,0,0,34,37,13,1,32,6,65,7,75,13,2,32,5,65,0,72,13,2,32,0,32,23,106,33,0,
  32,6,32,25,106,33,6,32,5,65,7,74,33,22,32,5,32,24,106,33,5,32,22,13,2,12,0,11,11,65,1,65,127,32,37,192,34,6,65,0,74,27,32,16,71,13,0,32,20,45,0,0,33,5,32,20,65,0,58,0,0,32,36,32,
  5,58,0,0,32,0,32,29,32,5,32,5,192,65,7,117,34,22,115,32,22,107,65,255,1,113,34,23,65,6,70,27,33,22,2,64,2,64,32,30,65,1,113,69,13,0,32,22,32,28,32,3,66,1,32,0,173,134,132,16,137,128,128,128,
  0,33,22,12,1,11,32,22,32,28,16,134,128,128,128,0,33,22,11,32,20,32,5,58,0,0,32,36,32,37,58,0,0,32,22,13,0,2,64,32,32,65,2,71,13,0,65,1,15,11,65,0,32,31,65,1,106,34,5,54,2,224,182,128,
  128,0,32,31,65,2,116,65,208,166,128,128,0,106,32,0,65,6,116,32,6,32,6,65,31,117,34,0,115,32,0,107,65,15,116,114,32,23,65,12,116,114,32,17,114,54,2,0,32,5,33,31,11,32,26,65,2,106,34,26,32,27,73,13,
  0,11,11,2,64,2,64,2,64,2,64,32,4,65,1,71,13,0,32,17,65,4,71,13,0,32,21,65,6,71,13,0,32,11,69,13,3,65,0,45,0,247,137,128,128,0,65,255,1,113,65,4,71,13,3,65,0,45,0,245,137,128,128,0,
  65,255,1,113,13,3,65,0,45,0,246,137,128,128,0,65,255,1,113,13,3,2,64,65,0,45,0,208,182,128,128,0,69,13,0,65,4,65,127,65,0,41,3,232,182,128,128,0,34,3,16,137,128,128,128,0,13,4,65,5,65,127,32,3,
  16,137,128,128,128,0,13,4,65,6,65,127,32,3,16,137,128,128,128,0,33,0,12,3,11,65,4,65,127,16,134,128,128,128,0,69,13,1,12,3,11,32,4,65,127,71,13,3,32,17,65,60,71,13,3,32,21,65,6,71,13,3,2,64,
  32,13,69,13,0,65,0,45,0,175,138,128,128,0,65,255,1,113,65,252,1,71,13,0,65,0,45,0,173,138,128,128,0,65,255,1,113,13,0,65,0,45,0,174,138,128,128,0,65,255,1,113,13,0,2,64,2,64,65,0,45,0,208,182,
  128,128,0,69,13,0,65,60,65,1,65,0,41,3,232,182,128,128,0,34,3,16,137,128,128,128,0,13,2,65,61,65,1,32,3,16,137,128,128,128,0,13,2,65,62,65,1,32,3,16,137,128,128,128,0,33,0,12,1,11,65,60,65,1,
  16,134,128,128,128,0,13,1,65,61,65,1,16,134,128,128,128,0,13,1,65,62,65,1,16,134,128,128,128,0,33,0,11,32,0,13,0,65,60,65,62,65,0,65,4,16,136,128,128,128,0,69,13,0,65,1,15,11,32,12,69,13,3,65,
  0,45,0,168,138,128,128,0,65,255,1,113,65,252,1,71,13,3,65,0,45,0,169,138,128,128,0,65,255,1,113,13,3,65,0,45,0,170,138,128,128,0,65,255,1,113,13,3,65,0,45,0,171,138,128,128,0,65,255,1,113,13,3,2,
  64,2,64,65,0,45,0,208,182,128,128,0,69,13,0,65,60,65,1,65,0,41,3,232,182,128,128,0,34,3,16,137,128,128,128,0,13,5,65,59,65,1,32,3,16,137,128,128,128,0,13,5,65,58,65,1,32,3,16,137,128,128,128,0,
  33,0,12,1,11,65,60,65,1,16,134,128,128,128,0,13,4,65,59,65,1,16,134,128,128,128,0,13,4,65,58,65,1,16,134,128,128,128,0,33,0,11,32,0,13,3,65,60,65,58,65,0,65,8,16,136,128,128,128,0,69,13,3,65,
  1,15,11,65,5,65,127,16,134,128,128,128,0,13,1,65,6,65,127,16,134,128,128,128,0,33,0,11,32,0,13,0,65,4,65,6,65,0,65,4,16,136,128,128,128,0,69,13,0,65,1,15,11,32,10,69,13,0,65,0,45,0,240,137,
  128,128,0,65,255,1,113,65,4,71,13,0,65,0,45,0,241,137,128,128,0,65,255,1,113,13,0,65,0,45,0,242,137,128,128,0,65,255,1,113,13,0,65,0,45,0,243,137,128,128,0,65,255,1,113,13,0,2,64,2,64,65,0,45,
  0,208,182,128,128,0,69,13,0,65,4,65,127,65,0,41,3,232,182,128,128,0,34,3,16,137,128,128,128,0,13,2,65,3,65,127,32,3,16,137,128,128,128,0,13,2,65,2,65,127,32,3,16,137,128,128,128,0,33,0,12,1,11,65,
  4,65,127,16,134,128,128,128,0,13,1,65,3,65,127,16,134,128,128,128,0,13,1,65,2,65,127,16,134,128,128,128,0,33,0,11,32,0,13,0,65,4,65,2,65,0,65,8,16,136,128,128,128,0,69,13,0,65,1,15,11,32,2,66,
  127,124,32,2,131,34,2,66,0,82,13,0,11,65,0,40,2,224,182,128,128,0,33,6,11,65,0,32,6,32,1,65,2,70,27,33,6,11,32,6,11,186,7,2,2,126,6,127,32,1,32,0,41,2,0,34,4,55,2,0,32,1,65,48,
  106,32,0,65,48,106,40,2,0,54,2,0,32,1,65,32,106,32,0,65,32,106,253,0,2,0,253,11,2,0,32,1,65,16,106,32,0,65,16,106,253,0,2,0,253,11,2,0,32,1,65,8,106,32,0,65,8,106,41,2,0,34,5,55,
  2,0,32,3,32,2,65,63,113,34,0,65,240,137,128,128,0,106,44,0,0,34,6,58,0,0,32,3,32,2,65,6,118,65,63,113,34,7,32,2,65,9,116,65,31,117,32,4,167,34,8,65,3,116,113,107,34,9,65,240,137,128,128,0,
  106,45,0,0,58,0,1,32,1,32,1,40,2,28,32,1,40,2,4,65,177,207,217,178,1,108,65,177,207,217,178,1,106,32,8,65,173,214,211,190,2,108,65,218,172,167,253,4,106,115,32,5,167,65,236,200,137,157,125,108,65,216,145,147,
  186,122,106,115,34,8,65,16,118,32,8,115,65,173,234,172,255,7,108,34,8,65,15,118,32,8,115,65,139,205,178,163,120,108,34,8,65,16,118,115,32,8,115,54,2,28,32,1,32,0,65,0,16,154,128,128,128,0,2,64,32,2,65,128,
  128,128,2,113,69,13,0,32,1,32,9,65,0,16,154,128,128,128,0,11,32,6,33,8,2,64,32,2,65,18,118,65,7,113,34,9,69,13,0,32,1,40,2,0,32,9,108,33,8,11,32,1,32,7,32,8,16,154,128,128,128,0,2,64,
  32,6,32,6,65,31,117,34,8,115,32,8,107,34,6,65,6,71,13,0,32,1,65,12,65,16,32,1,40,2,0,34,10,65,0,74,34,8,27,106,32,7,54,2,0,32,1,32,1,40,2,4,65,124,65,115,32,8,27,113,54,2,4,2,
  64,2,64,32,2,65,128,128,128,4,113,69,13,0,65,5,65,61,32,8,27,33,10,65,7,65,63,32,8,27,33,8,12,1,11,32,2,65,128,128,128,8,113,69,13,1,65,3,65,59,32,10,65,0,74,34,8,27,33,10,65,0,65,56,
  32,8,27,33,8,11,32,8,65,240,137,128,128,0,106,44,0,0,33,11,32,1,32,8,65,0,16,154,128,128,128,0,32,1,32,10,32,11,16,154,128,128,128,0,11,2,64,2,64,32,0,69,13,0,32,7,13,1,11,32,1,32,1,40,
  2,4,65,125,113,54,2,4,11,2,64,2,64,32,0,65,7,70,13,0,32,7,65,7,71,13,1,11,32,1,32,1,40,2,4,65,126,113,54,2,4,11,2,64,2,64,32,0,65,56,70,13,0,32,7,65,56,71,13,1,11,32,1,32,
  1,40,2,4,65,119,113,54,2,4,11,2,64,2,64,32,0,65,63,70,13,0,32,7,65,63,71,13,1,11,32,1,32,1,40,2,4,65,123,113,54,2,4,11,32,1,65,127,54,2,8,2,64,2,64,32,6,65,1,71,13,0,65,0,
  33,8,65,236,200,137,157,125,33,6,32,7,32,0,107,34,3,32,3,65,31,117,34,3,115,32,3,107,65,16,71,13,1,32,1,32,7,32,0,106,65,1,118,34,0,54,2,8,32,0,65,236,200,137,157,125,108,65,216,145,147,186,122,106,
  33,6,12,1,11,65,0,33,8,65,236,200,137,157,125,33,6,32,3,45,0,1,13,0,32,1,40,2,20,65,1,106,33,8,11,32,1,32,8,54,2,20,2,64,2,64,32,2,65,128,128,6,113,65,128,128,2,70,13,0,32,2,65,128,
  128,14,113,65,128,128,8,71,13,1,11,32,1,32,1,40,2,24,65,127,106,54,2,24,11,2,64,32,2,65,128,224,225,0,113,65,128,160,32,71,13,0,32,9,69,13,0,32,1,32,1,40,2,24,65,127,106,54,2,24,11,32,1,65,
  0,32,1,40,2,0,34,2,107,54,2,0,32,1,32,1,40,2,28,32,1,40,2,4,65,177,207,217,178,1,108,65,177,207,217,178,1,106,32,2,65,211,169,172,193,125,108,65,218,172,167,253,4,106,115,32,6,115,34,2,65,16,118,32,
  2,115,65,173,234,172,255,7,108,34,2,65,15,118,32,2,115,65,139,205,178,163,120,108,34,2,65,16,118,115,32,2,115,54,2,28,11,232,9,9,1,126,2,127,1,126,1,127,1,126,4,127,1,123,1,126,1,124,65,0,41,3,184,153,
  130,128,0,33,1,32,0,40,2,36,33,2,32,0,40,2,32,33,3,2,64,65,0,41,3,192,153,130,128,0,34,4,80,13,0,65,0,40,2,164,153,130,128,0,33,5,32,4,33,6,3,64,32,3,65,116,106,32,3,32,5,32,6,122,
  167,34,7,65,7,113,34,8,65,2,116,34,9,118,65,14,113,34,10,27,34,3,32,3,65,117,106,32,9,65,160,137,128,128,0,106,40,2,0,32,5,113,34,9,27,33,3,32,2,65,112,106,32,2,32,10,27,34,2,32,2,65,113,106,
  32,9,27,33,2,32,6,66,127,124,32,6,131,33,6,2,64,32,7,65,3,116,65,144,154,130,128,0,106,41,3,0,32,1,131,66,0,82,13,0,32,7,65,3,118,34,10,65,2,116,34,9,65,128,137,128,128,0,106,40,2,0,32,2,
  106,33,2,32,9,65,224,136,128,128,0,106,40,2,0,32,3,106,33,3,32,7,65,32,73,13,0,32,10,32,0,253,93,2,12,34,11,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,32,8,253,17,253,177,1,
  253,160,1,32,11,65,3,253,172,1,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,253,184,1,34,11,253,27,1,32,11,253,27,0,107,108,65,3,108,32,2,106,33,2,11,32,6,66,0,82,13,
  0,11,11,2,64,32,1,80,13,0,65,0,40,2,160,153,130,128,0,33,5,32,1,33,6,3,64,32,3,65,12,106,32,3,32,5,32,6,122,167,34,7,65,7,113,34,8,65,2,116,34,9,118,65,14,113,34,10,27,34,3,32,3,65,
  11,106,32,9,65,160,137,128,128,0,106,40,2,0,32,5,113,34,9,27,33,3,32,2,65,16,106,32,2,32,10,27,34,2,32,2,65,15,106,32,9,27,33,2,32,6,66,127,124,32,6,131,33,6,2,64,32,7,65,3,116,65,144,158,
  130,128,0,106,41,3,0,32,4,131,66,0,82,13,0,32,2,32,7,65,3,118,65,7,115,34,7,65,2,116,34,9,65,128,137,128,128,0,106,40,2,0,107,33,2,32,3,32,9,65,224,136,128,128,0,106,40,2,0,107,33,3,32,7,
  65,4,73,13,0,32,7,32,0,253,93,2,12,34,11,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,32,8,253,17,253,177,1,253,160,1,32,11,65,3,253,172,1,253,160,1,253,184,1,34,11,253,27,0,32,
  11,253,27,1,107,108,65,125,108,32,2,106,33,2,11,32,6,66,0,82,13,0,11,11,32,3,65,30,106,32,3,32,0,40,2,44,65,1,74,34,7,27,34,3,65,98,106,32,3,32,0,40,2,48,65,1,74,34,5,27,33,3,32,2,
  65,45,106,32,2,32,7,27,34,2,65,83,106,32,2,32,5,27,33,2,2,64,65,0,41,3,176,153,130,128,0,34,6,80,13,0,65,0,40,2,160,153,130,128,0,33,9,65,0,40,2,164,153,130,128,0,33,5,3,64,32,6,66,127,
  124,32,6,131,33,12,2,64,32,6,122,167,65,7,113,65,2,116,65,192,137,128,128,0,106,40,2,0,34,7,32,5,113,13,0,32,2,65,15,106,33,2,65,15,65,30,32,9,32,7,113,27,32,3,106,33,3,11,32,12,33,6,32,12,
  66,0,82,13,0,11,11,32,0,40,2,40,33,10,2,64,65,0,41,3,168,153,130,128,0,34,6,80,13,0,65,0,40,2,164,153,130,128,0,33,9,65,0,40,2,160,153,130,128,0,33,5,3,64,32,6,66,127,124,32,6,131,33,12,
  2,64,32,6,122,167,65,7,113,65,2,116,65,192,137,128,128,0,106,40,2,0,34,7,32,5,113,13,0,32,2,65,113,106,33,2,65,113,65,98,32,9,32,7,113,27,32,3,106,33,3,11,32,12,33,6,32,12,66,0,82,13,0,11,
  11,32,0,40,2,12,34,7,65,3,116,65,144,162,130,128,0,106,41,3,0,32,4,131,123,167,32,0,40,2,16,34,5,65,3,116,65,144,166,130,128,0,106,41,3,0,32,1,131,123,167,107,65,12,108,32,3,106,32,10,65,24,32,10,
  65,24,72,27,34,3,108,32,2,65,24,32,3,107,108,106,183,68,0,0,0,0,0,0,56,64,163,33,13,2,64,32,10,65,4,74,13,0,32,2,32,2,65,31,117,34,3,115,32,3,107,65,145,3,73,13,0,32,13,65,14,32,7,32,
  5,32,2,65,0,74,34,2,27,34,3,65,3,117,32,5,32,7,32,2,27,34,7,65,3,117,34,5,107,34,9,32,9,65,31,117,34,9,115,32,9,107,32,3,65,7,113,32,7,65,7,113,34,3,107,34,7,32,7,65,31,117,34,7,
  115,32,7,107,106,107,65,6,108,32,3,65,1,116,65,121,106,34,3,32,3,65,31,117,34,3,115,32,3,107,34,3,32,5,65,1,116,65,121,106,34,7,32,7,65,31,117,34,7,115,32,7,107,34,7,32,3,32,7,74,27,65,10,108,
  106,34,3,65,0,32,3,107,32,2,27,183,160,33,13,11,2,64,2,64,32,13,32,0,40,2,0,183,162,68,0,0,0,0,0,0,224,63,160,156,34,13,153,68,0,0,0,0,0,0,224,65,99,69,13,0,32,13,170,33,2,12,1,11,
  65,128,128,128,128,120,33,2,11,32,2,65,8,106,11,194,1,1,4,127,32,1,65,63,113,33,3,32,1,65,6,118,33,4,2,64,2,64,2,64,32,1,65,128,128,128,4,113,69,13,0,65,5,65,61,32,0,65,0,74,34,5,27,33,
  6,65,7,65,63,32,5,27,33,5,12,1,11,32,1,65,128,128,128,8,113,69,13,1,65,3,65,59,32,0,65,0,74,34,5,27,33,6,65,0,65,56,32,5,27,33,5,11,32,5,32,6,65,240,137,128,128,0,106,44,0,0,16,153,
  128,128,128,0,32,6,65,0,16,153,128,128,128,0,11,32,4,65,63,113,33,6,32,3,32,2,44,0,0,16,153,128,128,128,0,2,64,32,1,65,128,128,128,2,113,69,13,0,32,6,65,0,16,153,128,128,128,0,32,6,32,0,65,3,
  116,107,33,6,11,32,6,32,2,44,0,1,16,153,128,128,128,0,11,147,22,1,26,127,35,128,128,128,128,0,65,192,16,107,34,6,36,128,128,128,128,0,2,64,2,64,32,1,65,0,74,13,0,32,0,32,2,32,3,32,4,65,0,40,
  2,236,239,129,128,0,16,155,128,128,128,0,33,7,12,1,11,2,64,32,4,65,1,113,13,0,32,4,65,2,72,13,0,32,1,65,1,71,13,0,65,0,40,2,244,239,129,128,0,69,13,0,32,5,65,128,224,1,113,65,128,192,1,70,
  13,0,32,3,32,2,107,65,1,74,13,0,32,5,69,13,0,32,5,65,128,128,254,0,113,13,0,32,0,65,12,65,16,32,0,40,2,0,34,8,65,0,74,27,106,40,2,0,65,0,32,8,107,65,0,41,3,200,153,130,128,0,65,0,
  41,3,208,153,130,128,0,132,16,137,128,128,128,0,13,0,32,5,16,156,128,128,128,0,45,0,6,69,13,0,32,0,32,2,32,3,32,4,65,0,40,2,236,239,129,128,0,16,155,128,128,128,0,33,7,65,0,45,0,240,239,129,128,0,
  13,1,32,7,32,3,78,13,1,11,65,0,65,0,40,2,224,239,129,128,0,34,9,65,1,106,54,2,224,239,129,128,0,32,0,16,157,128,128,128,0,33,10,32,0,40,2,20,34,11,65,247,148,1,108,65,0,40,2,136,240,129,128,0,
  34,12,65,175,214,1,108,115,32,4,65,189,220,0,108,34,13,115,32,10,65,177,243,1,108,34,14,115,33,5,65,0,40,2,252,239,129,128,0,33,15,65,128,128,2,33,8,2,64,2,64,3,64,32,5,65,255,255,1,113,34,16,65,24,
  108,34,5,65,192,170,237,128,0,106,34,17,40,2,0,32,15,71,13,1,2,64,32,10,32,5,65,204,170,237,128,0,106,47,1,0,71,13,0,32,5,65,200,170,237,128,0,106,40,2,0,32,11,71,13,0,32,5,65,210,170,237,128,0,
  106,47,1,0,32,4,71,13,0,32,12,32,5,65,206,170,237,128,0,106,47,1,0,70,13,3,11,32,16,65,1,106,33,5,32,8,65,127,106,34,8,13,0,11,11,65,0,33,17,11,32,9,65,0,40,2,232,239,129,128,0,72,65,0,
  40,2,144,241,129,128,0,65,3,72,114,33,15,2,64,32,17,69,13,0,32,15,69,13,0,32,17,47,1,20,32,1,72,13,0,2,64,2,64,2,64,32,17,45,0,22,34,5,14,2,0,1,2,11,32,17,40,2,4,33,7,12,3,11,
  32,17,40,2,4,34,7,32,3,72,13,1,12,2,11,32,5,65,255,1,71,13,0,32,17,40,2,4,34,7,32,2,76,13,1,11,32,0,65,12,65,16,32,0,40,2,0,34,5,65,0,74,27,106,40,2,0,65,0,32,5,107,65,0,
  41,3,200,153,130,128,0,65,0,41,3,208,153,130,128,0,132,16,137,128,128,128,0,33,18,2,64,32,0,65,0,16,148,128,128,128,0,34,11,13,0,32,4,65,128,166,187,118,106,65,0,32,18,27,33,7,12,1,11,65,0,33,7,32,
  0,40,2,20,34,5,65,227,0,74,13,0,2,64,32,10,69,13,0,32,5,65,8,72,13,0,32,10,65,2,116,34,5,65,160,170,229,128,0,106,40,2,0,32,5,65,176,170,233,128,0,106,40,2,0,106,65,1,74,13,1,11,2,64,
  32,0,40,2,24,13,0,65,0,33,12,65,0,33,5,65,0,33,9,65,127,33,7,65,0,33,19,3,64,2,64,2,64,2,64,32,5,65,240,137,128,128,0,106,44,0,0,34,8,65,31,117,34,16,65,127,115,32,8,32,16,115,106,14,
  5,4,0,1,4,4,2,11,32,19,65,1,106,33,19,32,12,65,1,106,33,12,12,1,11,32,9,32,9,65,1,32,7,32,5,32,5,65,3,118,106,65,1,113,34,8,70,27,32,7,65,127,70,27,33,9,32,12,65,1,106,33,12,32,
  8,33,7,11,32,5,65,1,106,34,5,65,192,0,71,13,0,11,65,0,33,7,32,12,65,2,72,13,1,32,19,32,9,114,69,13,1,11,2,64,32,15,13,0,65,0,65,1,58,0,240,239,129,128,0,32,0,16,150,128,128,128,0,33,
  7,12,1,11,2,64,32,11,65,1,72,13,0,32,6,65,192,0,106,65,208,166,128,128,0,32,11,65,2,116,252,10,0,0,11,2,64,2,64,32,17,13,0,65,0,33,5,12,1,11,32,17,47,1,16,33,5,11,32,6,65,192,0,106,
  32,11,32,4,32,5,16,158,128,128,128,0,33,17,2,64,32,10,69,13,0,65,0,65,0,40,2,140,240,129,128,0,34,5,65,1,106,54,2,140,240,129,128,0,32,5,65,2,116,65,192,170,161,129,0,106,65,0,40,2,136,240,129,128,
  0,34,15,54,2,0,32,10,65,2,116,65,160,170,229,128,0,106,34,5,32,5,40,2,0,65,1,106,54,2,0,32,15,65,177,243,1,108,32,10,65,247,148,1,108,115,33,5,65,0,40,2,252,239,129,128,0,33,12,65,128,128,2,33,
  16,2,64,3,64,2,64,32,5,65,255,255,1,113,34,8,65,12,108,34,5,65,192,172,161,129,0,106,34,9,40,2,0,32,12,70,13,0,32,9,32,12,54,2,0,32,8,65,12,108,34,5,65,198,172,161,129,0,106,32,10,59,1,0,
  32,5,65,196,172,161,129,0,106,32,15,59,1,0,65,0,65,0,40,2,132,240,129,128,0,65,1,106,34,8,54,2,132,240,129,128,0,32,5,65,200,172,161,129,0,106,32,8,59,1,0,32,8,65,255,255,3,113,33,15,12,2,11,2,
  64,32,15,32,5,65,196,172,161,129,0,106,47,1,0,71,13,0,32,10,32,5,65,198,172,161,129,0,106,47,1,0,71,13,0,32,8,65,12,108,65,200,172,161,129,0,106,47,1,0,33,15,12,2,11,32,8,65,1,106,33,5,32,16,
  65,127,106,34,16,13,0,11,11,65,0,32,15,54,2,136,240,129,128,0,11,2,64,2,64,32,11,65,1,78,13,0,65,128,166,187,118,33,7,65,0,33,20,12,1,11,32,17,65,120,106,33,21,32,11,65,3,106,33,22,32,17,65,4,
  106,33,23,32,11,65,126,106,33,24,65,0,32,3,107,33,25,32,4,65,1,106,33,26,32,1,65,127,106,33,27,32,6,65,192,0,106,65,120,106,33,28,65,128,166,187,118,33,7,32,2,33,19,65,0,33,20,65,0,33,15,3,64,2,
  64,32,15,65,1,106,34,29,32,11,78,13,0,32,29,33,8,32,15,33,5,2,64,32,11,32,15,65,127,115,106,65,3,113,69,13,0,32,22,65,3,113,33,12,65,0,33,8,32,23,33,16,32,15,33,5,3,64,32,8,65,1,106,34,
  8,32,15,106,34,9,32,5,32,16,40,2,0,32,17,32,5,65,2,116,106,40,2,0,74,27,33,5,32,16,65,4,106,33,16,32,12,32,8,71,13,0,11,32,9,65,1,106,33,8,11,2,64,32,24,32,15,107,65,3,73,13,0,32,
  17,32,8,65,2,116,106,33,16,3,64,32,8,65,3,106,32,8,65,2,106,32,8,65,1,106,32,8,32,5,32,16,40,2,0,32,17,32,5,65,2,116,106,40,2,0,74,27,34,5,32,16,65,4,106,40,2,0,32,17,32,5,65,2,
  116,106,40,2,0,74,27,34,5,32,16,65,8,106,40,2,0,32,17,32,5,65,2,116,106,40,2,0,74,27,34,5,32,16,65,12,106,40,2,0,32,17,32,5,65,2,116,106,40,2,0,74,27,33,5,32,16,65,16,106,33,16,32,8,
  65,4,106,34,8,32,11,71,13,0,11,11,32,5,32,15,70,13,0,32,17,32,5,65,2,116,34,8,106,34,30,40,2,0,33,12,32,6,65,192,0,106,32,8,106,34,8,40,2,0,33,9,2,64,32,5,32,15,76,13,0,32,5,33,
  16,2,64,32,5,32,15,107,65,1,113,69,13,0,32,8,32,6,65,192,0,106,32,5,65,127,106,34,16,65,2,116,34,31,106,40,2,0,54,2,0,32,30,32,17,32,31,106,40,2,0,54,2,0,11,32,5,32,29,70,13,0,32,28,
  32,16,65,2,116,34,8,106,33,5,32,21,32,8,106,33,8,3,64,32,5,65,4,106,32,5,41,2,0,55,2,0,32,8,65,4,106,32,8,41,2,0,55,2,0,32,5,65,120,106,33,5,32,8,65,120,106,33,8,32,16,65,126,106,
  34,16,32,15,74,13,0,11,11,32,17,32,15,65,2,116,34,5,106,32,12,54,2,0,32,6,65,192,0,106,32,5,106,32,9,54,2,0,11,32,0,32,6,65,12,106,32,6,65,192,0,106,32,15,65,2,116,106,40,2,0,34,5,32,
  6,65,10,106,16,149,128,128,128,0,32,5,65,128,128,254,0,113,33,12,2,64,2,64,2,64,32,15,13,0,65,0,32,19,107,33,16,12,1,11,65,0,32,6,65,12,106,32,27,32,1,65,2,74,32,15,65,3,75,113,32,18,32,6,
  65,12,106,65,12,65,16,32,6,40,2,12,34,8,65,0,74,27,106,40,2,0,65,0,32,8,107,65,0,41,3,200,153,130,128,0,65,0,41,3,208,153,130,128,0,132,16,137,128,128,128,0,114,32,12,114,69,113,34,15,107,32,19,65,
  127,115,65,0,32,19,107,34,16,32,26,32,5,16,152,128,128,128,0,107,33,8,65,0,45,0,240,239,129,128,0,13,1,32,19,32,8,78,13,1,32,15,32,8,32,3,72,114,69,13,1,11,65,0,32,6,65,12,106,32,27,32,25,32,
  16,32,26,32,5,16,152,128,128,128,0,107,33,8,11,32,0,40,2,0,32,5,32,6,65,10,106,16,151,128,128,128,0,65,0,45,0,240,239,129,128,0,13,1,32,5,65,6,118,65,128,224,1,113,32,5,65,255,31,113,114,32,20,32,
  8,32,7,74,34,5,27,33,20,32,8,32,7,32,5,27,33,7,2,64,32,8,32,19,32,8,32,19,74,27,34,19,32,3,72,13,0,32,4,65,31,74,13,2,32,12,13,2,32,4,65,2,116,65,144,240,129,128,0,106,32,20,54,2,
  0,65,0,33,5,2,64,2,64,32,20,65,2,116,34,8,65,160,170,133,128,0,106,34,16,40,2,0,65,0,40,2,252,239,129,128,0,34,17,71,13,0,32,8,65,160,170,141,128,0,106,40,2,0,33,5,12,1,11,32,16,32,17,54,
  2,0,11,32,20,65,2,116,65,160,170,141,128,0,106,32,5,32,1,32,1,108,106,54,2,0,12,2,11,32,22,65,3,106,33,22,32,23,65,4,106,33,23,32,29,33,15,32,29,32,11,71,13,0,11,11,2,64,32,10,69,13,0,65,
  0,65,0,40,2,140,240,129,128,0,65,127,106,34,5,54,2,140,240,129,128,0,32,10,65,2,116,65,160,170,229,128,0,106,34,8,32,8,40,2,0,65,127,106,54,2,0,65,0,32,5,65,2,116,65,192,170,161,129,0,106,40,2,0,
  54,2,136,240,129,128,0,11,65,0,45,0,240,239,129,128,0,13,0,32,0,40,2,20,34,0,65,247,148,1,108,65,0,40,2,136,240,129,128,0,34,11,65,175,214,1,108,115,32,13,115,32,14,115,33,5,65,0,40,2,252,239,129,128,
  0,33,17,65,128,128,2,33,16,2,64,3,64,2,64,32,5,65,255,255,1,113,34,8,65,24,108,34,5,65,192,170,237,128,0,106,34,15,40,2,0,32,17,70,13,0,32,15,32,17,54,2,0,32,8,65,24,108,34,5,65,204,170,237,
  128,0,106,32,10,59,1,0,32,5,65,210,170,237,128,0,106,32,4,59,1,0,32,5,65,200,170,237,128,0,106,32,0,54,2,0,32,5,65,206,170,237,128,0,106,32,11,59,1,0,12,2,11,2,64,32,10,32,5,65,204,170,237,128,
  0,106,47,1,0,71,13,0,32,5,65,200,170,237,128,0,106,40,2,0,32,0,71,13,0,32,5,65,210,170,237,128,0,106,47,1,0,32,4,71,13,0,32,11,32,5,65,206,170,237,128,0,106,47,1,0,70,13,2,11,32,8,65,1,
  106,33,5,32,16,65,127,106,34,16,13,0,12,2,11,11,32,8,65,24,108,34,5,65,214,170,237,128,0,106,32,7,32,3,78,65,127,32,7,32,2,74,27,58,0,0,32,5,65,208,170,237,128,0,106,32,20,59,1,0,32,5,65,196,
  170,237,128,0,106,32,7,54,2,0,32,5,65,212,170,237,128,0,106,32,1,59,1,0,11,32,6,65,192,16,106,36,128,128,128,128,0,32,7,11,250,4,2,2,127,1,126,2,64,32,0,65,240,137,128,128,0,106,44,0,0,34,2,69,
  13,0,65,208,153,130,128,0,65,200,153,130,128,0,32,2,65,0,74,27,34,3,32,3,41,3,0,66,126,32,0,173,34,4,137,131,55,3,0,66,1,32,4,134,33,4,2,64,2,64,32,2,65,31,117,34,3,65,127,115,32,2,32,3,
  115,106,14,4,0,2,2,1,2,11,32,4,66,127,133,33,4,65,127,32,0,65,2,116,116,33,3,2,64,32,2,65,1,72,13,0,65,0,65,0,41,3,192,153,130,128,0,32,4,131,55,3,192,153,130,128,0,65,0,65,0,40,2,164,
  153,130,128,0,32,3,106,54,2,164,153,130,128,0,12,2,11,65,0,65,0,41,3,184,153,130,128,0,32,4,131,55,3,184,153,130,128,0,65,0,65,0,40,2,160,153,130,128,0,32,3,106,54,2,160,153,130,128,0,12,1,11,32,4,
  66,127,133,33,4,2,64,32,2,65,1,72,13,0,65,0,65,0,41,3,176,153,130,128,0,32,4,131,55,3,176,153,130,128,0,12,1,11,65,0,65,0,41,3,168,153,130,128,0,32,4,131,55,3,168,153,130,128,0,11,2,64,2,64,
  32,1,13,0,32,0,65,4,117,65,3,116,65,224,153,130,128,0,106,34,2,32,2,41,3,0,66,15,32,0,65,2,116,65,60,113,173,34,4,134,66,127,133,131,66,6,32,4,134,132,55,3,0,12,1,11,65,208,153,130,128,0,65,200,
  153,130,128,0,32,1,65,0,74,27,34,2,32,2,41,3,0,66,1,32,0,173,134,34,4,132,55,3,0,2,64,2,64,2,64,32,1,65,31,117,34,2,65,127,115,32,1,32,2,115,106,14,4,0,2,2,1,2,11,65,1,32,0,65,
  2,116,116,33,2,2,64,32,1,65,1,72,13,0,65,0,65,0,41,3,192,153,130,128,0,32,4,132,55,3,192,153,130,128,0,65,0,65,0,40,2,164,153,130,128,0,32,2,106,54,2,164,153,130,128,0,12,2,11,65,0,65,0,41,
  3,184,153,130,128,0,32,4,132,55,3,184,153,130,128,0,65,0,65,0,40,2,160,153,130,128,0,32,2,106,54,2,160,153,130,128,0,12,1,11,2,64,32,1,65,1,72,13,0,65,0,65,0,41,3,176,153,130,128,0,32,4,132,55,
  3,176,153,130,128,0,12,1,11,65,0,65,0,41,3,168,153,130,128,0,32,4,132,55,3,168,153,130,128,0,11,32,0,65,4,117,65,3,116,65,224,153,130,128,0,106,34,2,32,2,41,3,0,66,15,32,0,65,2,116,65,60,113,173,
  34,4,134,66,127,133,131,32,1,65,6,106,172,32,4,134,132,55,3,0,11,32,0,65,240,137,128,128,0,106,32,1,58,0,0,11,160,9,2,6,127,1,126,2,64,32,1,65,240,137,128,128,0,106,44,0,0,34,3,69,13,0,32,0,
  32,3,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,1,65,185,243,221,241,121,108,65,185,243,221,241,121,106,115,34,4,65,16,118,32,4,115,65,173,234,172,255,7,108,34,4,65,15,118,32,4,115,65,139,205,178,163,120,108,34,
  4,65,16,118,32,0,40,2,28,115,32,4,115,54,2,28,32,0,32,3,32,3,65,31,117,34,4,115,32,4,107,34,4,65,6,116,32,1,32,1,65,56,115,32,3,65,0,74,34,5,27,106,65,2,116,34,6,65,204,138,128,128,0,106,
  40,2,0,32,4,65,2,116,65,176,138,128,128,0,106,34,7,40,2,0,106,65,127,65,1,32,5,27,34,8,108,32,0,40,2,32,106,54,2,32,32,0,32,6,65,204,152,128,128,0,106,40,2,0,32,7,40,2,0,106,32,8,108,32,
  0,40,2,36,106,54,2,36,65,127,33,6,2,64,32,4,65,254,255,255,255,7,113,65,2,70,13,0,65,126,33,6,32,4,65,4,70,13,0,65,124,65,0,32,4,65,5,70,27,33,6,11,32,0,32,0,40,2,40,32,6,106,54,2,
  40,65,208,153,130,128,0,65,200,153,130,128,0,32,5,27,34,5,32,5,41,3,0,66,126,32,1,173,34,9,137,131,55,3,0,66,1,32,9,134,33,9,2,64,2,64,2,64,32,4,65,127,106,14,4,0,3,2,1,3,11,32,9,66,
  127,133,33,9,65,127,32,1,65,2,116,116,33,4,2,64,32,3,65,1,72,13,0,65,0,65,0,41,3,192,153,130,128,0,32,9,131,55,3,192,153,130,128,0,65,0,65,0,40,2,164,153,130,128,0,32,4,106,54,2,164,153,130,128,
  0,12,3,11,65,0,65,0,41,3,184,153,130,128,0,32,9,131,55,3,184,153,130,128,0,65,0,65,0,40,2,160,153,130,128,0,32,4,106,54,2,160,153,130,128,0,12,2,11,32,9,66,127,133,33,9,2,64,32,3,65,1,72,13,
  0,65,0,65,0,41,3,176,153,130,128,0,32,9,131,55,3,176,153,130,128,0,12,2,11,65,0,65,0,41,3,168,153,130,128,0,32,9,131,55,3,168,153,130,128,0,12,1,11,32,0,65,44,65,48,32,3,65,0,74,27,106,34,3,
  32,3,40,2,0,65,127,106,54,2,0,11,2,64,2,64,32,2,13,0,32,1,65,4,117,65,3,116,65,224,153,130,128,0,106,34,0,32,0,41,3,0,66,15,32,1,65,2,116,65,60,113,173,34,9,134,66,127,133,131,66,6,32,9,
  134,132,55,3,0,12,1,11,32,0,32,2,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,1,65,185,243,221,241,121,108,65,185,243,221,241,121,106,115,34,3,65,16,118,32,3,115,65,173,234,172,255,7,108,34,3,65,15,118,32,
  3,115,65,139,205,178,163,120,108,34,3,65,16,118,32,0,40,2,28,115,32,3,115,54,2,28,65,1,33,5,32,0,32,2,32,2,65,31,117,34,3,115,32,3,107,34,3,65,6,116,32,1,32,1,65,56,115,32,2,65,0,74,34,4,
  27,106,65,2,116,34,6,65,204,138,128,128,0,106,40,2,0,32,3,65,2,116,65,176,138,128,128,0,106,34,7,40,2,0,106,65,1,65,127,32,4,27,34,8,108,32,0,40,2,32,106,54,2,32,32,0,32,6,65,204,152,128,128,0,
  106,40,2,0,32,7,40,2,0,106,32,8,108,32,0,40,2,36,106,54,2,36,2,64,32,3,65,254,255,255,255,7,113,65,2,70,13,0,65,2,33,5,32,3,65,4,70,13,0,32,3,65,5,70,65,2,116,33,5,11,32,0,32,0,
  40,2,40,32,5,106,54,2,40,65,208,153,130,128,0,65,200,153,130,128,0,32,4,27,34,4,32,4,41,3,0,66,1,32,1,173,134,34,9,132,55,3,0,2,64,2,64,2,64,2,64,32,3,65,127,106,14,4,0,3,2,1,3,11,
  65,1,32,1,65,2,116,116,33,0,2,64,32,2,65,1,72,13,0,65,0,65,0,41,3,192,153,130,128,0,32,9,132,55,3,192,153,130,128,0,65,0,65,0,40,2,164,153,130,128,0,32,0,106,54,2,164,153,130,128,0,12,3,11,
  65,0,65,0,41,3,184,153,130,128,0,32,9,132,55,3,184,153,130,128,0,65,0,65,0,40,2,160,153,130,128,0,32,0,106,54,2,160,153,130,128,0,12,2,11,2,64,32,2,65,1,72,13,0,65,0,65,0,41,3,176,153,130,128,
  0,32,9,132,55,3,176,153,130,128,0,12,2,11,65,0,65,0,41,3,168,153,130,128,0,32,9,132,55,3,168,153,130,128,0,12,1,11,32,0,65,44,65,48,32,2,65,0,74,27,106,34,0,32,0,40,2,0,65,1,106,54,2,0,
  11,32,1,65,4,117,65,3,116,65,224,153,130,128,0,106,34,0,32,0,41,3,0,66,15,32,1,65,2,116,65,60,113,173,34,9,134,66,127,133,131,32,2,65,6,106,172,32,9,134,132,55,3,0,11,32,1,65,240,137,128,128,0,106,
  32,2,58,0,0,11,245,14,1,21,127,35,128,128,128,128,0,65,192,16,107,34,5,36,128,128,128,128,0,65,0,33,6,65,0,65,0,40,2,224,239,129,128,0,65,1,106,54,2,224,239,129,128,0,32,0,65,12,65,16,32,0,40,2,
  0,34,7,65,0,74,27,106,40,2,0,65,0,32,7,107,65,0,41,3,200,153,130,128,0,65,0,41,3,208,153,130,128,0,132,16,137,128,128,128,0,33,8,65,0,33,9,2,64,32,0,40,2,20,69,13,0,32,0,16,157,128,128,128,
  0,33,9,11,2,64,2,64,2,64,2,64,32,8,69,13,0,32,0,65,0,16,148,128,128,128,0,34,6,69,13,1,32,6,65,1,72,13,0,32,5,65,192,0,106,65,208,166,128,128,0,32,6,65,2,116,252,10,0,0,11,65,0,33,
  10,32,0,40,2,20,34,7,65,227,0,74,13,2,2,64,32,9,69,13,0,32,7,65,8,72,13,0,32,9,65,2,116,34,7,65,160,170,229,128,0,106,40,2,0,32,7,65,176,170,233,128,0,106,40,2,0,106,65,1,74,13,3,11,
  2,64,32,0,40,2,24,13,0,65,0,33,11,65,0,33,7,65,0,33,12,65,127,33,13,65,0,33,14,3,64,2,64,2,64,2,64,32,7,65,240,137,128,128,0,106,44,0,0,34,15,65,31,117,34,16,65,127,115,32,15,32,16,115,
  106,14,5,4,0,1,4,4,2,11,32,14,65,1,106,33,14,32,11,65,1,106,33,11,12,1,11,32,12,32,12,65,1,32,13,32,7,32,7,65,3,118,106,65,1,113,34,15,70,27,32,13,65,127,70,27,33,12,32,11,65,1,106,33,
  11,32,15,33,13,11,32,7,65,1,106,34,7,65,192,0,71,13,0,11,65,0,33,10,32,11,65,2,72,13,3,32,14,32,12,114,69,13,3,11,2,64,65,0,40,2,224,239,129,128,0,65,0,40,2,232,239,129,128,0,76,13,0,65,
  0,40,2,144,241,129,128,0,65,3,72,13,0,2,64,32,8,13,0,32,0,65,2,16,148,128,128,128,0,13,0,65,0,33,10,12,4,11,65,0,65,1,58,0,240,239,129,128,0,32,0,16,150,128,128,128,0,33,10,12,3,11,2,64,
  2,64,32,8,13,0,32,0,16,150,128,128,128,0,33,10,2,64,32,3,65,20,76,13,0,32,0,65,2,16,148,128,128,128,0,13,4,65,0,33,10,12,5,11,2,64,2,64,32,4,65,1,72,13,0,32,10,32,2,72,13,1,11,32,
  10,65,0,32,0,65,2,16,148,128,128,128,0,27,33,10,12,5,11,2,64,32,0,65,1,16,148,128,128,128,0,34,6,69,13,0,32,10,32,1,32,10,32,1,74,27,33,1,32,6,65,1,72,13,2,32,5,65,192,0,106,65,208,166,
  128,128,0,32,6,65,2,116,252,10,0,0,12,2,11,32,10,65,0,32,0,65,2,16,148,128,128,128,0,27,33,10,12,4,11,65,128,166,187,118,33,10,32,3,65,20,74,13,2,11,32,5,65,192,0,106,32,6,32,3,65,0,16,158,
  128,128,128,0,33,11,2,64,32,9,69,13,0,65,0,65,0,40,2,140,240,129,128,0,34,7,65,1,106,54,2,140,240,129,128,0,32,7,65,2,116,65,192,170,161,129,0,106,65,0,40,2,136,240,129,128,0,34,12,54,2,0,32,9,
  65,2,116,65,160,170,229,128,0,106,34,7,32,7,40,2,0,65,1,106,54,2,0,32,12,65,177,243,1,108,32,9,65,247,148,1,108,115,33,7,65,0,40,2,252,239,129,128,0,33,13,65,128,128,2,33,16,2,64,3,64,2,64,32,
  7,65,255,255,1,113,34,15,65,12,108,34,7,65,192,172,161,129,0,106,34,14,40,2,0,32,13,70,13,0,32,14,32,13,54,2,0,32,15,65,12,108,34,7,65,198,172,161,129,0,106,32,9,59,1,0,32,7,65,196,172,161,129,0,
  106,32,12,59,1,0,65,0,65,0,40,2,132,240,129,128,0,65,1,106,34,15,54,2,132,240,129,128,0,32,7,65,200,172,161,129,0,106,32,15,59,1,0,32,15,65,255,255,3,113,33,12,12,2,11,2,64,32,12,32,7,65,196,172,
  161,129,0,106,47,1,0,71,13,0,32,9,32,7,65,198,172,161,129,0,106,47,1,0,71,13,0,32,15,65,12,108,65,200,172,161,129,0,106,47,1,0,33,12,12,2,11,32,15,65,1,106,33,7,32,16,65,127,106,34,16,13,0,11,
  11,65,0,32,12,54,2,136,240,129,128,0,11,2,64,32,6,65,1,72,13,0,32,11,65,120,106,33,17,32,6,65,3,106,33,18,32,11,65,4,106,33,19,32,6,65,126,106,33,20,32,4,65,127,106,33,4,32,3,65,1,106,33,21,
  65,0,32,2,107,33,22,32,5,65,192,0,106,65,120,106,33,23,65,0,33,12,3,64,2,64,32,12,65,1,106,34,14,32,6,78,13,0,32,14,33,15,32,12,33,7,2,64,32,6,32,12,65,127,115,106,65,3,113,69,13,0,32,18,
  65,3,113,33,13,65,0,33,15,32,19,33,16,32,12,33,7,3,64,32,15,65,1,106,34,15,32,12,106,34,3,32,7,32,16,40,2,0,32,11,32,7,65,2,116,106,40,2,0,74,27,33,7,32,16,65,4,106,33,16,32,13,32,15,
  71,13,0,11,32,3,65,1,106,33,15,11,2,64,32,20,32,12,107,65,3,73,13,0,32,11,32,15,65,2,116,106,33,16,3,64,32,15,65,3,106,32,15,65,2,106,32,15,65,1,106,32,15,32,7,32,16,40,2,0,32,11,32,7,
  65,2,116,106,40,2,0,74,27,34,7,32,16,65,4,106,40,2,0,32,11,32,7,65,2,116,106,40,2,0,74,27,34,7,32,16,65,8,106,40,2,0,32,11,32,7,65,2,116,106,40,2,0,74,27,34,7,32,16,65,12,106,40,2,
  0,32,11,32,7,65,2,116,106,40,2,0,74,27,33,7,32,16,65,16,106,33,16,32,15,65,4,106,34,15,32,6,71,13,0,11,11,32,7,32,12,70,13,0,32,11,32,7,65,2,116,34,15,106,34,24,40,2,0,33,13,32,5,65,
  192,0,106,32,15,106,34,15,40,2,0,33,3,2,64,32,7,32,12,76,13,0,32,7,33,16,2,64,32,7,32,12,107,65,1,113,69,13,0,32,15,32,5,65,192,0,106,32,7,65,127,106,34,16,65,2,116,34,25,106,40,2,0,54,
  2,0,32,24,32,11,32,25,106,40,2,0,54,2,0,11,32,7,32,14,70,13,0,32,23,32,16,65,2,116,34,15,106,33,7,32,17,32,15,106,33,15,3,64,32,7,65,4,106,32,7,41,2,0,55,2,0,32,15,65,4,106,32,15,
  41,2,0,55,2,0,32,7,65,120,106,33,7,32,15,65,120,106,33,15,32,16,65,126,106,34,16,32,12,74,13,0,11,11,32,11,32,12,65,2,116,34,7,106,32,13,54,2,0,32,5,65,192,0,106,32,7,106,32,3,54,2,0,11,
  2,64,2,64,32,8,32,5,65,192,0,106,32,12,65,2,116,106,40,2,0,34,7,65,128,128,240,0,113,114,13,0,32,10,32,7,65,13,118,65,28,113,65,176,138,128,128,0,106,40,2,0,106,65,160,1,106,32,1,72,13,1,11,32,
  0,32,5,65,12,106,32,7,32,5,65,10,106,16,149,128,128,128,0,32,5,65,12,106,32,22,65,0,32,1,107,32,21,32,4,16,155,128,128,128,0,33,15,32,0,40,2,0,32,7,32,5,65,10,106,16,151,128,128,128,0,65,0,45,
  0,240,239,129,128,0,13,2,32,10,65,0,32,15,107,34,7,32,10,32,7,74,27,33,10,32,1,32,7,32,1,32,7,74,27,34,1,32,2,78,13,2,11,32,18,65,3,106,33,18,32,19,65,4,106,33,19,32,14,33,12,32,14,32,
  6,71,13,0,11,11,32,9,69,13,2,65,0,65,0,40,2,140,240,129,128,0,65,127,106,34,7,54,2,140,240,129,128,0,32,9,65,2,116,65,160,170,229,128,0,106,34,15,32,15,40,2,0,65,127,106,54,2,0,65,0,32,7,65,
  2,116,65,192,170,161,129,0,106,40,2,0,54,2,136,240,129,128,0,12,2,11,32,3,65,128,166,187,118,106,33,10,12,1,11,32,0,16,150,128,128,128,0,33,10,11,32,5,65,192,16,106,36,128,128,128,128,0,32,10,11,128,13,5,
  2,127,1,123,12,127,1,124,2,123,2,64,32,0,65,128,128,128,12,113,34,1,65,0,71,65,15,116,32,0,65,12,118,65,7,113,34,2,65,12,116,32,0,65,6,118,253,17,32,0,253,28,1,253,12,63,0,0,0,63,0,0,0,63,
  0,0,0,63,0,0,0,253,78,34,3,253,27,0,65,6,116,114,65,128,96,106,114,32,3,253,27,1,114,34,4,65,3,116,65,160,170,149,128,0,106,34,5,40,2,0,65,0,40,2,252,239,129,128,0,34,6,70,13,0,65,7,32,3,
  253,12,56,0,0,0,56,0,0,0,56,0,0,0,56,0,0,0,253,81,32,3,65,0,40,2,248,239,129,128,0,65,0,72,253,17,65,31,253,171,1,65,31,253,172,1,253,82,34,3,253,27,0,34,7,65,7,113,34,8,65,1,116,65,
  121,106,34,9,32,9,65,31,117,34,9,115,32,9,107,34,10,32,7,65,3,118,34,9,65,1,116,34,11,65,121,106,34,12,32,12,65,31,117,34,12,115,32,12,107,34,13,106,34,14,107,33,15,32,2,65,127,106,34,12,65,3,116,65,
  240,214,128,128,0,106,43,3,0,33,16,2,64,2,64,2,64,2,64,2,64,2,64,2,64,32,12,14,5,0,1,2,3,4,5,11,32,3,253,27,1,34,12,65,7,113,34,15,65,1,116,65,121,106,34,13,65,31,117,34,11,32,13,32,
  11,115,107,65,3,108,65,14,65,0,32,15,65,126,106,65,4,73,27,65,0,32,12,65,23,75,27,32,12,65,3,118,34,12,65,7,108,106,106,65,21,106,33,15,65,14,65,0,32,8,65,126,106,65,4,73,27,65,0,32,7,65,23,75,
  27,32,9,65,7,108,106,65,7,32,10,107,65,3,108,106,33,8,32,12,32,12,108,65,123,108,32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,
  255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,106,65,121,106,33,10,32,9,32,9,108,65,5,108,32,17,253,27,0,107,65,7,106,33,13,12,5,11,32,15,65,7,108,65,113,65,0,32,7,65,8,73,27,106,33,8,
  65,7,32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,32,3,253,27,1,34,
  15,65,3,118,34,12,65,1,116,65,121,106,34,10,32,10,65,31,117,34,10,115,32,10,107,106,107,34,11,65,123,108,33,10,32,11,65,7,108,65,113,65,0,32,15,65,8,73,27,106,33,15,65,7,32,13,32,17,253,27,0,106,107,65,
  5,108,33,13,12,4,11,32,15,65,2,116,32,9,65,3,108,106,33,8,65,7,32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,
  255,255,255,253,174,1,253,160,1,34,17,253,27,1,32,3,253,27,1,65,3,118,34,12,65,1,116,65,121,106,34,15,32,15,65,31,117,34,15,115,32,15,107,106,34,15,107,65,125,108,33,10,32,12,65,3,108,32,15,65,2,116,107,65,
  28,106,33,15,65,7,32,13,32,17,253,27,0,106,107,65,3,108,33,13,12,3,11,65,30,32,3,253,27,1,65,3,118,34,12,65,1,116,34,8,32,12,65,6,70,27,33,15,32,8,65,121,106,34,8,32,8,65,31,117,34,8,115,32,
  8,107,32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,106,65,1,116,65,114,
  106,33,10,65,30,32,11,32,9,65,6,70,27,33,8,65,14,32,17,253,27,0,32,13,106,65,1,116,107,33,13,12,2,11,32,15,65,1,116,65,120,65,0,32,7,65,23,75,27,106,33,8,65,7,32,3,65,1,253,171,1,253,12,14,
  0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,32,3,253,27,1,34,15,65,3,118,34,12,65,1,116,65,121,106,
  34,10,32,10,65,31,117,34,10,115,32,10,107,106,34,11,107,65,125,108,33,10,65,6,65,14,32,15,65,23,75,27,32,11,65,1,116,107,33,15,65,7,32,13,32,17,253,27,0,106,107,65,3,108,33,13,12,1,11,32,3,253,27,1,
  65,3,118,34,12,65,116,108,65,45,65,0,32,3,253,12,59,0,0,0,59,0,0,0,59,0,0,0,59,0,0,0,253,78,253,12,2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,253,55,34,18,253,199,1,253,27,2,65,1,
  113,27,106,32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,32,12,65,1,116,
  65,121,106,34,15,32,15,65,31,117,34,15,115,32,15,107,106,34,10,65,5,108,106,65,93,106,33,15,32,9,65,116,108,65,45,65,0,32,18,253,27,0,65,1,113,27,106,32,14,65,5,108,106,65,93,106,33,8,32,10,65,3,116,65,
  72,106,33,10,65,56,32,17,253,27,0,32,13,106,65,3,116,107,33,13,11,32,5,32,6,54,2,0,32,4,65,3,116,34,4,65,166,170,149,128,0,106,65,0,43,3,208,215,128,128,0,68,0,0,0,0,0,0,0,128,32,7,65,31,
  75,27,68,0,0,0,0,0,0,0,128,32,2,65,1,70,27,32,17,253,27,1,32,17,253,27,0,107,183,68,0,0,0,0,0,0,192,63,162,65,0,43,3,200,215,128,128,0,162,65,0,43,3,192,215,128,128,0,68,0,0,0,0,0,
  0,0,128,32,3,253,27,1,65,8,73,27,68,0,0,0,0,0,0,0,128,32,0,65,128,192,1,113,65,128,192,0,70,27,65,0,43,3,184,215,128,128,0,68,0,0,0,0,0,0,0,128,32,1,27,32,9,32,12,107,34,0,65,3,
  32,0,65,3,72,27,34,0,65,125,32,0,65,125,74,27,183,68,0,0,0,0,0,0,8,64,163,65,0,43,3,176,215,128,128,0,162,32,10,32,13,106,183,68,0,0,0,0,0,0,89,64,163,65,0,43,3,168,215,128,128,0,162,32,
  8,32,15,107,183,68,0,0,0,0,0,0,89,64,163,65,0,43,3,160,215,128,128,0,162,32,16,160,160,160,160,160,160,160,34,16,68,0,0,0,0,0,0,0,0,99,58,0,0,2,64,2,64,32,16,68,0,0,0,0,0,192,114,64,
  162,68,0,0,0,0,0,0,224,63,160,156,34,16,153,68,0,0,0,0,0,0,224,65,99,69,13,0,32,16,170,33,0,12,1,11,65,128,128,128,128,120,33,0,11,32,4,65,164,170,149,128,0,106,32,0,59,1,0,11,32,5,11,132,
  8,2,4,126,9,127,65,0,41,3,248,153,130,128,0,33,1,65,0,41,3,240,153,130,128,0,33,2,65,0,41,3,232,153,130,128,0,33,3,65,0,41,3,224,153,130,128,0,33,4,65,0,40,2,252,239,129,128,0,33,5,65,128,128,
  1,33,6,32,0,65,28,106,40,2,0,34,7,33,8,3,64,2,64,32,8,65,255,255,0,113,34,9,65,48,108,34,8,65,160,170,181,128,0,106,34,10,40,2,0,32,5,70,13,0,32,10,32,5,54,2,0,32,9,65,48,108,34,8,
  65,164,170,181,128,0,106,32,7,54,2,0,65,0,33,11,32,0,40,2,0,33,6,65,0,65,0,40,2,128,240,129,128,0,65,1,106,34,9,54,2,128,240,129,128,0,32,8,65,170,170,181,128,0,106,32,6,58,0,0,32,0,40,2,
  8,33,7,32,0,40,2,4,33,10,32,8,65,200,170,181,128,0,106,65,0,41,3,248,153,130,128,0,55,3,0,32,8,65,192,170,181,128,0,106,65,0,41,3,240,153,130,128,0,55,3,0,32,8,65,184,170,181,128,0,106,65,0,41,
  3,232,153,130,128,0,55,3,0,32,8,65,176,170,181,128,0,106,65,0,41,3,224,153,130,128,0,55,3,0,32,8,65,172,170,181,128,0,106,32,10,58,0,0,32,8,65,171,170,181,128,0,106,32,7,58,0,0,32,9,65,255,255,3,
  113,34,12,65,2,116,34,13,65,160,170,229,128,0,106,65,0,54,2,0,32,8,65,168,170,181,128,0,106,32,9,59,1,0,2,64,32,0,40,2,20,65,8,72,13,0,65,128,8,33,9,32,4,167,34,8,65,255,255,3,113,65,197,187,
  242,136,120,115,65,147,131,128,8,108,32,8,65,16,118,115,65,147,131,128,8,108,32,4,66,32,136,167,65,255,255,3,113,115,65,147,131,128,8,108,32,4,66,48,136,167,115,65,147,131,128,8,108,32,3,167,34,8,65,255,255,3,113,115,
  65,147,131,128,8,108,32,8,65,16,118,115,65,147,131,128,8,108,32,3,66,32,136,167,65,255,255,3,113,115,65,147,131,128,8,108,32,3,66,48,136,167,115,65,147,131,128,8,108,32,2,167,34,8,65,255,255,3,113,115,65,147,131,128,
  8,108,32,8,65,16,118,115,65,147,131,128,8,108,32,2,66,32,136,167,65,255,255,3,113,115,65,147,131,128,8,108,32,2,66,48,136,167,115,65,147,131,128,8,108,32,1,167,34,8,65,255,255,3,113,115,65,147,131,128,8,108,32,8,
  65,16,118,115,65,147,131,128,8,108,32,1,66,32,136,167,65,255,255,3,113,115,65,147,131,128,8,108,32,1,66,48,136,167,115,65,147,131,128,8,108,32,7,65,5,116,65,32,106,32,10,65,1,116,32,6,65,1,70,114,114,65,255,255,
  3,113,34,7,115,65,147,131,128,8,108,34,0,33,8,3,64,32,8,65,255,7,113,34,6,65,48,108,34,8,65,160,170,130,128,0,106,40,2,0,32,5,71,13,1,2,64,32,8,65,164,170,130,128,0,106,40,2,0,32,0,71,13,0,
  32,8,65,172,170,130,128,0,106,47,1,0,32,7,71,13,0,32,8,65,176,170,130,128,0,106,41,3,0,32,4,82,13,0,32,8,65,184,170,130,128,0,106,41,3,0,32,3,82,13,0,32,8,65,192,170,130,128,0,106,41,3,0,32,
  2,82,13,0,32,8,65,200,170,130,128,0,106,41,3,0,32,1,82,13,0,32,6,65,48,108,65,168,170,130,128,0,106,40,2,0,33,11,12,2,11,32,6,65,1,106,33,8,32,9,65,127,106,34,9,13,0,11,11,32,13,65,176,170,
  233,128,0,106,32,11,54,2,0,32,12,15,11,2,64,32,8,65,164,170,181,128,0,106,40,2,0,32,7,71,13,0,32,0,40,2,0,32,8,65,170,170,181,128,0,106,44,0,0,71,13,0,32,0,40,2,4,32,8,65,172,170,181,128,
  0,106,45,0,0,71,13,0,32,0,40,2,8,32,8,65,171,170,181,128,0,106,44,0,0,71,13,0,32,8,65,176,170,181,128,0,106,41,3,0,32,4,82,13,0,32,8,65,184,170,181,128,0,106,41,3,0,32,3,82,13,0,32,8,
  65,192,170,181,128,0,106,41,3,0,32,2,82,13,0,32,8,65,200,170,181,128,0,106,41,3,0,32,1,82,13,0,32,9,65,48,108,65,168,170,181,128,0,106,47,1,0,15,11,32,9,65,1,106,33,8,32,6,65,127,106,34,6,13,
  0,11,65,0,11,172,8,1,6,127,32,2,65,31,32,2,65,31,72,27,65,11,116,65,192,170,157,129,0,106,33,4,2,64,32,1,65,1,72,13,0,32,2,65,2,116,65,144,240,129,128,0,106,33,5,65,0,40,2,252,239,129,128,0,
  33,6,2,64,2,64,2,64,32,2,65,1,113,69,13,0,65,0,40,2,244,239,129,128,0,13,1,11,32,2,65,32,72,13,1,32,4,33,2,3,64,65,128,173,226,4,33,7,2,64,32,0,40,2,0,34,8,65,6,118,65,128,224,1,
  113,32,8,65,255,31,113,114,34,9,32,3,70,13,0,2,64,32,8,65,18,118,65,7,113,34,7,69,13,0,32,7,65,2,116,65,176,138,128,128,0,106,40,2,0,65,192,154,12,106,33,7,12,1,11,2,64,32,8,65,15,118,65,7,
  113,34,7,69,13,0,32,7,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,116,32,8,65,12,118,65,7,113,65,2,116,65,176,138,128,128,0,106,40,2,0,107,65,160,141,6,106,33,7,12,1,11,65,0,33,7,32,9,65,2,
  116,34,8,65,160,170,133,128,0,106,40,2,0,32,6,71,13,0,32,8,65,160,170,141,128,0,106,40,2,0,33,7,11,32,2,32,7,54,2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,12,
  3,11,11,2,64,32,2,65,32,72,13,0,32,4,33,2,3,64,65,128,173,226,4,33,7,2,64,32,0,40,2,0,34,8,65,6,118,65,128,224,1,113,32,8,65,255,31,113,114,34,9,32,3,70,13,0,2,64,32,8,65,18,118,65,
  7,113,34,7,69,13,0,32,7,65,2,116,65,176,138,128,128,0,106,40,2,0,65,192,154,12,106,33,7,12,1,11,2,64,32,8,65,15,118,65,7,113,34,7,69,13,0,32,7,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,
  116,32,8,65,12,118,65,7,113,65,2,116,65,176,138,128,128,0,106,40,2,0,107,65,160,141,6,106,33,7,12,1,11,65,0,33,7,2,64,32,9,65,2,116,34,9,65,160,170,133,128,0,106,40,2,0,32,6,71,13,0,32,9,65,
  160,170,141,128,0,106,40,2,0,33,7,11,32,7,32,8,16,156,128,128,128,0,46,1,4,106,33,7,11,32,2,32,7,54,2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,12,3,11,11,32,
  4,33,2,3,64,65,128,173,226,4,33,7,2,64,32,0,40,2,0,34,8,65,6,118,65,128,224,1,113,32,8,65,255,31,113,114,34,9,32,3,70,13,0,2,64,32,8,65,18,118,65,7,113,34,7,69,13,0,32,7,65,2,116,65,
  176,138,128,128,0,106,40,2,0,65,192,154,12,106,33,7,12,1,11,2,64,32,8,65,15,118,65,7,113,34,7,69,13,0,32,7,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,116,32,8,65,12,118,65,7,113,65,2,116,65,
  176,138,128,128,0,106,40,2,0,107,65,160,141,6,106,33,7,12,1,11,65,144,191,5,33,7,32,5,40,2,0,32,9,70,13,0,65,0,33,7,2,64,32,9,65,2,116,34,9,65,160,170,133,128,0,106,40,2,0,32,6,71,13,0,
  32,9,65,160,170,141,128,0,106,40,2,0,33,7,11,32,7,32,8,16,156,128,128,128,0,46,1,4,106,33,7,11,32,2,32,7,54,2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,12,2,
  11,11,32,4,33,2,3,64,65,128,173,226,4,33,7,2,64,32,0,40,2,0,34,8,65,6,118,65,128,224,1,113,32,8,65,255,31,113,114,34,9,32,3,70,13,0,2,64,32,8,65,18,118,65,7,113,34,7,69,13,0,32,7,65,
  2,116,65,176,138,128,128,0,106,40,2,0,65,192,154,12,106,33,7,12,1,11,2,64,32,8,65,15,118,65,7,113,34,7,69,13,0,32,7,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,116,32,8,65,12,118,65,7,113,65,
  2,116,65,176,138,128,128,0,106,40,2,0,107,65,160,141,6,106,33,7,12,1,11,65,144,191,5,33,7,32,5,40,2,0,32,9,70,13,0,65,0,33,7,32,9,65,2,116,34,8,65,160,170,133,128,0,106,40,2,0,32,6,71,13,
  0,32,8,65,160,170,141,128,0,106,40,2,0,33,7,11,32,2,32,7,54,2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,11,11,32,4,11,11,248,1,1,0,65,128,8,11,240,1,1,0,
  0,0,1,0,0,0,1,0,0,0,255,255,255,255,255,255,255,255,1,0,0,0,255,255,255,255,255,255,255,255,1,0,0,0,0,0,0,0,255,255,255,255,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,255,255,255,255,99,0,
  0,0,99,0,0,0,99,0,0,0,99,0,0,0,99,0,0,0,99,0,0,0,99,0,0,0,99,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,17,0,0,0,35,0,0,0,65,0,0,0,110,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,15,0,0,0,32,0,0,0,65,0,0,0,120,0,0,0,210,0,0,0,0,0,0,0,240,0,0,0,15,15,0,0,240,240,0,0,0,15,15,0,0,240,240,0,0,0,15,15,0,0,240,240,0,0,0,15,15,0,
  0,0,240,0,0,0,0,15,0,0,0,240,0,0,0,0,15,0,0,0,240,0,0,0,0,15,0,0,0,240,110,0,0,0,98,0,0,0,114,0,0,0,113,0,0,0,0,142,4,4,110,97,109,101,0,13,12,104,101,108,112,101,114,115,
  46,119,97,115,109,1,215,3,31,0,9,98,111,97,114,100,95,112,116,114,1,10,99,111,110,102,105,103,95,112,116,114,2,9,109,111,118,101,115,95,112,116,114,3,8,101,118,97,108,117,97,116,101,4,10,112,97,119,110,95,115,99,111,114,
  101,5,8,105,110,95,99,104,101,99,107,6,8,97,116,116,97,99,107,101,100,7,8,103,101,110,101,114,97,116,101,8,4,101,109,105,116,9,19,115,101,97,114,99,104,95,97,116,116,97,99,107,101,100,95,111,99,99,10,12,103,101,110,95,
  97,116,116,97,99,107,101,100,11,10,115,99,111,114,101,115,95,112,116,114,12,9,101,120,97,99,116,95,112,116,114,13,10,112,111,108,105,99,121,95,112,116,114,14,15,112,117,98,108,105,99,95,107,101,121,115,95,112,116,114,15,17,112,117,
  98,108,105,99,95,99,111,117,110,116,115,95,112,116,114,16,12,115,101,97,114,99,104,95,110,111,100,101,115,17,12,115,101,97,114,99,104,95,100,101,112,116,104,18,20,115,101,97,114,99,104,95,101,118,97,108,117,97,116,101,95,102,97,115,
  116,19,10,115,101,97,114,99,104,95,97,108,108,20,15,115,101,97,114,99,104,95,103,101,110,101,114,97,116,101,21,18,115,101,97,114,99,104,95,97,112,112,108,121,95,99,104,105,108,100,22,21,115,101,97,114,99,104,95,101,118,97,108,117,
  97,116,101,95,115,116,97,116,101,23,17,115,101,97,114,99,104,95,117,110,100,111,95,98,111,97,114,100,24,9,115,101,97,114,99,104,95,97,98,25,21,115,101,97,114,99,104,95,114,101,115,116,111,114,101,95,115,113,117,97,114,101,26,22,
  115,101,97,114,99,104,95,104,97,115,104,95,115,101,116,95,115,113,117,97,114,101,27,8,115,101,97,114,99,104,95,113,28,19,112,111,108,105,99,121,95,100,105,114,101,99,116,95,101,110,116,114,121,29,18,115,101,97,114,99,104,95,112,111,
  115,105,116,105,111,110,95,105,100,30,20,115,101,97,114,99,104,95,112,114,101,112,97,114,101,95,111,114,100,101,114,7,18,1,0,15,95,95,115,116,97,99,107,95,112,111,105,110,116,101,114,9,10,1,0,7,46,114,111,100,97,116,97,0,
  56,9,112,114,111,100,117,99,101,114,115,1,12,112,114,111,99,101,115,115,101,100,45,98,121,1,12,85,98,117,110,116,117,32,99,108,97,110,103,17,49,56,46,49,46,51,32,40,49,117,98,117,110,116,117,49,41,0,66,15,116,97,114,103,
  101,116,95,102,101,97,116,117,114,101,115,4,43,11,98,117,108,107,45,109,101,109,111,114,121,43,15,109,117,116,97,98,108,101,45,103,108,111,98,97,108,115,43,8,115,105,103,110,45,101,120,116,43,7,115,105,109,100,49,50,56
]);
// END GENERATED V55 WASM

// The compiled kernel has no imports or opponent state. Every call copies only
// the current board; both variants use exactly the same helpers. JavaScript
// remains a behaviorally identical fallback when WebAssembly is unavailable.
let SF55C_KERNEL=null;
try {
 if(typeof WebAssembly!=='undefined'){
  const api=new WebAssembly.Instance(new WebAssembly.Module(SF55C_WASM_BYTES),{}).exports;
  SF55C_KERNEL={api,board:new Int8Array(api.memory.buffer,api.board_ptr(),64),
   config:new Int32Array(api.memory.buffer,api.config_ptr(),903),
   moves:new Uint32Array(api.memory.buffer,api.moves_ptr(),512),
   scores:api.scores_ptr?new Int32Array(api.memory.buffer,api.scores_ptr(),512):null,
   exact:api.exact_ptr?new Int32Array(api.memory.buffer,api.exact_ptr(),512):null,
   policyWeights:api.policy_ptr?new Float64Array(api.memory.buffer,api.policy_ptr(),13):null,
   publicKeys:api.public_keys_ptr?new Uint16Array(api.memory.buffer,api.public_keys_ptr(),512*17):null,
   publicCounts:api.public_counts_ptr?new Int32Array(api.memory.buffer,api.public_counts_ptr(),512):null};
 }
} catch (_) { /* Use the identical JS implementation if compilation is blocked. */ }
function sf55cSyncKernelConfig(){
 const kernel=SF55C_KERNEL;if(!kernel)return;
 kernel.config.set(SF55C.piece);
 for(let t=0;t<7;t++){kernel.config.set(SF55C_PST[t],7+t*64);kernel.config.set(SF55C_EG[t],455+t*64);}
}
sf55cSyncKernelConfig();
function sf55cSyncKernelBoard(g){
 const k=SF55C_KERNEL;if(!k)return null;
 if(!g._sf55cKernelSearchActive||g._sf55cKernelDirty){
  k.board.set(g.boardState);
  if(g._sf55cKernelSearchActive)g._sf55cKernelDirty=false;
 }
 return k;
}
function sf55cEvaluate(g){
 const k=sf55cSyncKernelBoard(g);if(!k)return sf55cEvaluateJS(g);
 return k.api.evaluate(g.side,g.kingSq[1],g.kingSq[-1]);
}
function sf55cInCheck(g){
 const k=sf55cSyncKernelBoard(g);if(!k)return g.in_check();
 return !!k.api.in_check(g.side,g.kingSq[g.side]);
}
function sf55cKernelMoves(g,mode,ctx=null,ply=0){
 const k=sf55cSyncKernelBoard(g);
 const count=k.api.generate(g.side,g.castling,g.ep,g.kingSq[g.side],mode);
 if(mode===2)return !!count;
 let moves;
 if(ctx){
  const buffers=ctx.moveBuffers||(ctx.moveBuffers=[]);
  moves=buffers[ply];
  if(!moves)moves=buffers[ply]=[];
  while(moves.length<count)moves.push({from:0,to:0,piece:0,captured:0,promotion:0,flags:0});
  moves.length=count;
 }else moves=new Array(count);
 for(let i=0;i<count;i++){
  const packed=k.moves[i];
  let move=moves[i];
  if(!move)move=moves[i]={from:0,to:0,piece:0,captured:0,promotion:0,flags:0};
  move.from=packed&63;move.to=(packed>>>6)&63;move.piece=(packed>>>12)&7;
  move.captured=(packed>>>15)&7;move.promotion=(packed>>>18)&7;move.flags=packed>>>21;
 }
 return moves;
}
function sf55cLegalMoves(g,ctx=null,ply=0){return SF55C_KERNEL?sf55cKernelMoves(g,0,ctx,ply):g.fastMoves();}
function sf55cTacticalMoves(g,ctx=null,ply=0){return SF55C_KERNEL?sf55cKernelMoves(g,1,ctx,ply):sf55cTacticalMovesJS(g);}
function sf55cHasLegalMove(g){return SF55C_KERNEL?sf55cKernelMoves(g,2):g.fastHasLegalMove();}

// Stonefish_v5_5.js
// Stonefish v5.5 — native PVS + separate ARMX-preview.
//
// Native v5.5 owns the chess search and considers every legal root move.
// Capture quiescence resolves exchanges before evaluation. ARMX is separate: it
// learns this opponent's behavior from the current game, supplies reply priorities,
// and applies bounded multipliers to searched candidates. The No-ARMX control uses
// the exact same v5.5 host, but never consults ARMX.

const STONEFISH_V5_5 = Object.freeze({
  name: 'Stonefish v5.5',
  base: 'Stonefish v5 Pro',
  knowledgeBase: 'Native tapered positional evaluation',
  search: 'Native PVS',
  nativeFeature: 'All legal root moves + capture quiescence + exact finalist scores',
  refutationGuard: 'Full legal reply search',
  armx: 'ARMX opponent adaptation model',
});

const STONEFISH_V5_5_ARMX_MIN_POSITIVE_SIGNAL = 0.10;
const STONEFISH_V5_5_ARMX_STRONG_AVOID_SIGNAL = -0.45;
const STONEFISH_V5_5_ARMX_DECISION_GAIN = 1.25;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_GAIN = 1.60;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_SIGNAL_EDGE = 0.30;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_CONFIDENCE = 0.90;
const STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_EVIDENCE = 5.5;
let STONEFISH_V5_5_LAST_ARMX = null;

function stonefishV55HostSearch(game, replyPolicy = null) {
  return sf55cHost(game, replyPolicy);
}

function stonefishV55FindEntry(finished, raw) {
  return finished.find(entry => entry && raw && stonefishV5SameMove(entry.raw, raw)) || null;
}

function stonefishV55FindARMXReport(reports, raw) {
  return reports.find(report => report && raw && stonefishV5SameMove(report.raw, raw)) || null;
}

function stonefishV55ARMXPairDecisionGain(provisionalReport, challengerReport) {
  if (!provisionalReport || !challengerReport) return STONEFISH_V5_5_ARMX_DECISION_GAIN;
  const provisionalConfidence = Number(provisionalReport.confidence) || 0;
  const challengerConfidence = Number(challengerReport.confidence) || 0;
  const provisionalEvidence = Number(provisionalReport.evidence) || 0;
  const challengerEvidence = Number(challengerReport.evidence) || 0;
  const signalEdge = (Number(challengerReport.signal) || 0) - (Number(provisionalReport.signal) || 0);
  const mature = provisionalConfidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_CONFIDENCE
    && challengerConfidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_CONFIDENCE
    && provisionalEvidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_EVIDENCE
    && challengerEvidence >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_EVIDENCE;
  return mature && signalEdge >= STONEFISH_V5_5_ARMX_CONTRASTIVE_MIN_SIGNAL_EDGE
    ? STONEFISH_V5_5_ARMX_CONTRASTIVE_GAIN
    : STONEFISH_V5_5_ARMX_DECISION_GAIN;
}

function stonefishV55ARMXDecisionScore(report, gain = STONEFISH_V5_5_ARMX_DECISION_GAIN) {
  if (!report) return -Infinity;
  const hostScore = Number(report.hostScore);
  const adjustment = Number(report.adjustment) || 0;
  return Number.isFinite(hostScore)
    ? hostScore + adjustment * gain
    : -Infinity;
}

function stonefishV55BestARMXReport(reports, provisionalReport = null) {
  let best = provisionalReport || null;
  let bestLead = provisionalReport ? 0 : -Infinity;
  for (const report of reports || []) {
    if (!report || report === provisionalReport) continue;
    const gain = provisionalReport
      ? stonefishV55ARMXPairDecisionGain(provisionalReport, report)
      : STONEFISH_V5_5_ARMX_DECISION_GAIN;
    const score = stonefishV55ARMXDecisionScore(report, gain);
    const provisionalScore = provisionalReport
      ? stonefishV55ARMXDecisionScore(provisionalReport, gain)
      : -Infinity;
    const lead = provisionalReport ? score - provisionalScore : score;
    if (provisionalReport && lead <= 0) continue;
    if (!best || lead > bestLead) {
      best = report;
      bestLead = lead;
    }
  }
  return best;
}

function stonefishV55ARMXMateScale(entry) {
  if (!entry) return false;
  const mate = typeof STONEFISH_V5_PRO_MATE === 'number' ? STONEFISH_V5_PRO_MATE : STONEFISH_V5_MATE;
  return (Number.isFinite(entry.deep) && Math.abs(entry.deep) >= mate * 0.9)
    || (Number.isFinite(entry.score) && Math.abs(entry.score) >= mate * 0.9);
}

function stonefishV55ARMXChangeDecision(
  provisional,
  challenger,
  provisionalReport,
  challengerReport,
  observedPlies = 0
) {
  if (!provisional || !challenger || !provisionalReport || !challengerReport) {
    return { allowed: false, reason: 'missing-candidate-report' };
  }

  // Native search owns forced tactical truth. ARMX must never re-rank a mate-scale
  // decision just because its behavioral multipliers prefer another mating line.
  if (stonefishV55ARMXMateScale(provisional) || stonefishV55ARMXMateScale(challenger)) {
    return { allowed: false, reason: 'mate-scale' };
  }

  const hostGap = provisional.armxOriginalScore - challenger.armxOriginalScore;
  if (hostGap > ARMX_PREVIEW.maxHostGap) {
    return { allowed: false, reason: 'host-gap', hostGap };
  }
  const deepSacrifice = Number.isFinite(provisional.deep) && Number.isFinite(challenger.deep)
    ? provisional.deep - challenger.deep
    : 0;
  if (deepSacrifice > ARMX_PREVIEW.maxDeepSacrifice) {
    return { allowed: false, reason: 'deep-sacrifice', hostGap, deepSacrifice };
  }

  const challengerConfidence = Number(challengerReport.confidence) || 0;
  const challengerEvidence = Number(challengerReport.evidence) || 0;
  if (challengerEvidence < ARMX_PREVIEW.minOverrideEvidence) {
    return { allowed: false, reason: 'evidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }
  if (challengerConfidence < ARMX_PREVIEW.minOverrideConfidence) {
    return { allowed: false, reason: 'confidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }

  // Early observations are especially noisy: the bad adapt2 trace flipped a move
  // after only a few observed choices with sub-0.4 challenger confidence. ARMX may
  // still learn immediately, but it only gets voting power this early when the
  // evidence is already overwhelming.
  if (observedPlies < ARMX_PREVIEW.earlyOverridePlies
    && challengerEvidence < ARMX_PREVIEW.earlyOverrideEvidence) {
    return { allowed: false, reason: 'early-evidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }
  if (observedPlies < ARMX_PREVIEW.earlyOverridePlies
    && challengerConfidence < ARMX_PREVIEW.earlyOverrideConfidence) {
    return { allowed: false, reason: 'early-confidence', hostGap, deepSacrifice, challengerEvidence, challengerConfidence };
  }

  const decisionGain = stonefishV55ARMXPairDecisionGain(provisionalReport, challengerReport);
  const provisionalDecisionScore = stonefishV55ARMXDecisionScore(provisionalReport, decisionGain);
  const challengerDecisionScore = stonefishV55ARMXDecisionScore(challengerReport, decisionGain);
  const adaptedLead = challengerDecisionScore - provisionalDecisionScore;
  if (adaptedLead < ARMX_PREVIEW.minAdaptedLead) {
    return {
      allowed: false,
      reason: 'adapted-lead',
      hostGap,
      deepSacrifice,
      challengerEvidence,
      challengerConfidence,
      adaptedLead,
      decisionGain,
    };
  }

  // Do not change a sound native choice merely because two negative ARMX signals
  // differ by a few points. A flip needs either a positively learned challenger
  // or a genuinely strong learned reason to avoid the provisional move.
  const challengerSignal = Number(challengerReport.signal) || 0;
  const provisionalSignal = Number(provisionalReport.signal) || 0;
  if (challengerSignal < STONEFISH_V5_5_ARMX_MIN_POSITIVE_SIGNAL
    && provisionalSignal > STONEFISH_V5_5_ARMX_STRONG_AVOID_SIGNAL) {
    return {
      allowed: false,
      reason: 'signal-quality',
      hostGap,
      deepSacrifice,
      challengerEvidence,
      challengerConfidence,
      adaptedLead,
      challengerSignal,
      provisionalSignal,
      decisionGain,
    };
  }

  const allowed = challengerDecisionScore > provisionalDecisionScore;
  return {
    allowed,
    reason: allowed ? 'allowed' : 'adapted-order',
    hostGap,
    deepSacrifice,
    challengerEvidence,
    challengerConfidence,
    adaptedLead,
    challengerSignal,
    provisionalSignal,
    decisionGain,
  };
}

function stonefishV55ARMXChangeAllowed(
  provisional,
  challenger,
  provisionalReport,
  challengerReport,
  observedPlies = 0
) {
  return stonefishV55ARMXChangeDecision(
    provisional,
    challenger,
    provisionalReport,
    challengerReport,
    observedPlies
  ).allowed;
}

function stonefishV55ARMXPromoteReviewedCandidate(finished, candidate) {
  if (!candidate || !finished || !finished.length) return false;
  const index = finished.indexOf(candidate);
  if (index <= 0) return false;
  finished.splice(index, 1);
  finished.unshift(candidate);
  return true;
}

function stonefishV55ScoreAllMoves(game) {
  const perspective = game.side;
  const replyPolicy = typeof armxPreviewOpponentPolicy === 'function'
    ? armxPreviewOpponentPolicy(game, perspective) : null;
  const host = stonefishV55HostSearch(game, replyPolicy);
  const finished = host.finished;
  if (!finished.length) {
    STONEFISH_V5_5_LAST_ARMX = null;
    return [];
  }

  const provisional = finished[0] || null;
  const provisionalRaw = provisional ? provisional.raw : null;
  const runnerUp = finished[1] || null;
  const hostScoreGap = provisional && runnerUp && Number.isFinite(runnerUp.score)
    ? provisional.score - runnerUp.score
    : Infinity;
  let review = null;
  let adaptationApplied = false;
  let adaptationRejected = false;
  let totalAdjustment = 0;
  let gateDecision = null;
  let proposedRaw = null;

  // ARMX is deliberately cheap enough to observe every v5.5 turn. If the game
  // has not produced enough evidence yet, its multipliers stay at/near 1.0.
  if (provisional && typeof armxPreviewReview === 'function') {
    const comparisonSet = finished.slice(0, Math.max(1, ARMX_PREVIEW.candidateLimit));
    review = armxPreviewReview(game, comparisonSet, perspective);
    const reports = review && Array.isArray(review.reports) ? review.reports : [];
    const touched = [];

    for (const report of reports) {
      const target = stonefishV55FindEntry(finished, report.raw);
      if (!target) continue;
      target.armxOriginalScore = target.score;
      target.armxMultiplier = report.multiplier;
      target.armxAdjustment = report.adjustment;
      target.armxAdaptedScore = report.adaptedScore;
      target.armxDecisionScore = stonefishV55ARMXDecisionScore(report);
      touched.push(target);
    }

    // Ordinary comparisons retain the conservative 1.25x voting weight. If both
    // reports have mature evidence and a large contrastive learned signal, that
    // pair alone may use 1.60x. Deep-score, mate, host-gap and evidence gates still
    // decide whether the proposed change is actually permitted.
    const provisionalReport = stonefishV55FindARMXReport(reports, provisionalRaw);
    const proposedReport = stonefishV55BestARMXReport(reports, provisionalReport);
    const proposed = proposedReport ? stonefishV55FindEntry(finished, proposedReport.raw) : null;
    proposedRaw = proposed ? proposed.raw : null;
    const wantsChange = Boolean(proposed && provisionalRaw && !stonefishV5SameMove(proposed.raw, provisionalRaw));

    let allowChange = !wantsChange;
    if (wantsChange) {
      gateDecision = stonefishV55ARMXChangeDecision(
        provisional,
        proposed,
        provisionalReport,
        proposedReport,
        review && Number(review.observedPlies) || 0
      );
      allowChange = gateDecision.allowed;
      adaptationRejected = !allowChange;
    }

    if (allowChange) {
      for (const target of touched) totalAdjustment += target.armxAdjustment || 0;
      adaptationApplied = touched.some(target => Math.abs(target.armxAdjustment || 0) > 1e-9);
      if (wantsChange) stonefishV55ARMXPromoteReviewedCandidate(finished, proposed);
    }
  }

  const winner = finished[0] || null;
  const reports = review && Array.isArray(review.reports) ? review.reports : [];
  const changedByARMX = Boolean(
    winner && provisionalRaw && !stonefishV5SameMove(winner.raw, provisionalRaw)
  );
  const changedFromFastLeader = Boolean(
    winner && host.fastLeader && !stonefishV5SameMove(winner.raw, host.fastLeader)
  );

  STONEFISH_V5_5_LAST_ARMX = Object.assign({}, review || {}, {
    searchGuidanceActive: Boolean(replyPolicy),
    replyPolicyObservations: replyPolicy ? replyPolicy.observations : 0,
    connected: Boolean(review),
    eligible: Boolean(review),
    adaptationApplied,
    adaptationRejected,
    rejectionReason: adaptationRejected && gateDecision ? gateDecision.reason : null,
    gateDecision,
    proposedRaw,
    decisionGain: gateDecision && Number.isFinite(gateDecision.decisionGain)
      ? gateDecision.decisionGain
      : STONEFISH_V5_5_ARMX_DECISION_GAIN,
    totalAdjustment,
    override: changedByARMX,
    changedMove: changedByARMX,
    recommendedRaw: winner ? winner.raw : null,
    provisionalRaw,
    runnerUpRaw: runnerUp ? runnerUp.raw : null,
    fastLeaderRaw: host.fastLeader,
    hostSearchChangedMove: changedFromFastLeader,
    hostScoreGap,
    refutationGuard: host.refutationGuard,
    search: STONEFISH_V5_5.search,
    // Compatibility fields for older diagnostics while the preview evolves.
    criticApplied: adaptationApplied,
    criticAdjustment: totalAdjustment,
    criticRisk: 0,
    candidatesPenalized: reports.filter(report => report && report.adjustment < 0).length,
    hostCandidatesReviewed: reports.length,
    injectedReplies: 0,
    audited: Boolean(host.refutationGuard && host.refutationGuard.verified),
    challengerSearched: false,
  });

  return finished;
}

// Developer-only No-ARMX control. This is the exact same native v5.5,
// including Refutation Guard. Only the separate ARMX opponent model is bypassed.
function stonefishV55NoARMXScoreAllMoves(game) {
  return stonefishV55HostSearch(game).finished;
}

function getStonefishV55Move(game) {
  const scored = stonefishV55ScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function getStonefishV55NoARMXMove(game) {
  const scored = stonefishV55NoARMXScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function stonefishV55LastARMX() {
  return STONEFISH_V5_5_LAST_ARMX;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5 = STONEFISH_V5_5;
  globalThis.getStonefishV55Move = getStonefishV55Move;
  globalThis.getStonefishV55NoARMXMove = getStonefishV55NoARMXMove;
  globalThis.stonefishV55ScoreAllMoves = stonefishV55ScoreAllMoves;
  globalThis.stonefishV55NoARMXScoreAllMoves = stonefishV55NoARMXScoreAllMoves;
  globalThis.stonefishV55LastARMX = stonefishV55LastARMX;
}

// Stonefish_v5_5_range.js
// Stonefish v5.5 range — Athena, Ares and Artemis.
//
// All three models use the exact same native v5.5 chess engine and Full ARMX.
// Artemis adds no playstyle preference. Athena and Ares add bounded finalist
// style priors only after native search; mate-scale truth and large native score
// gaps remain protected.

const STONEFISH_V5_5_RANGE = Object.freeze({
  technology: 'Full ARMX',
  base: 'Stonefish v5.5 native PVS',
  models: Object.freeze({
    athena: Object.freeze({
      name: 'Stonefish_v5.5 Athena',
      style: 'athena',
      identity: 'extreme-defense',
    }),
    ares: Object.freeze({
      name: 'Stonefish_v5.5 Ares',
      style: 'ares',
      identity: 'extreme-aggression',
    }),
    artemis: Object.freeze({
      name: 'Stonefish_v5.5 Artemis',
      style: 'artemis',
      identity: 'balanced',
    }),
  }),
});

function stonefishV55RangeScoreAllMoves(game, style = 'artemis') {
  const perspective = game.side;
  const policy = armxFullOpponentPolicy(game, perspective, style);
  const host = stonefishV55HostSearch(game, policy);
  return armxFullRankHost(game, host, style);
}

function getStonefishV55AthenaMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'athena');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function getStonefishV55AresMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'ares');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

// Neutral technology runner: same frozen v5.5 host, Full ARMX, no God-style prior.
function stonefishV55FullARMXScoreAllMoves(game) {
  const perspective = game.side;
  const policy = armxFullOpponentPolicy(game, perspective, 'artemis');
  const host = stonefishV55HostSearch(game, policy);
  return armxFullRankHost(game, host, 'artemis');
}
function getStonefishV55FullARMXMove(game) {
  const scored = stonefishV55FullARMXScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}
function getStonefishV55ArtemisMove(game) {
  return getStonefishV55FullARMXMove(game);
}

function stonefishV55PreviewRankHost(game, host) {
  const finished=host&&Array.isArray(host.finished)?host.finished:[];
  if(!finished.length)return finished;
  const perspective=game.side;
  const provisional=finished[0];
  const provisionalRaw=provisional.raw;
  const profile=armxPreviewSyncProfile(game,perspective);
  const review=armxPreviewReview(
    game,finished.slice(0,Math.max(1,ARMX_PREVIEW.candidateLimit)),perspective
  );
  const reports=review&&Array.isArray(review.reports)?review.reports:[];
  const provisionalReport=stonefishV55FindARMXReport(reports,provisionalRaw);
  const proposedReport=stonefishV55BestARMXReport(reports,provisionalReport);
  const proposed=proposedReport?stonefishV55FindEntry(finished,proposedReport.raw):null;
  if(proposed&&provisionalReport&&!stonefishV5SameMove(proposed.raw,provisionalRaw)){
    provisional.armxOriginalScore=provisional.score;
    proposed.armxOriginalScore=proposed.score;
    const gate=stonefishV55ARMXChangeDecision(
      provisional,proposed,provisionalReport,proposedReport,
      review&&Number(review.observedPlies)||0
    );
    if(gate.allowed)stonefishV55ARMXPromoteReviewedCandidate(finished,proposed);
  }
  return finished;
}

// Developer-only decomposition controls. Neither is a release model.
// A: Full opponent-policy/search effort + frozen Preview finalist voting.
// B: Frozen Preview opponent-policy/search effort + Full-ARMX finalist voting.
function getStonefishV55DiagFullPolicyPreviewReviewMove(game){
  const perspective=game.side;
  const policy=armxFullOpponentPolicy(game,perspective,'artemis');
  const host=stonefishV55HostSearch(game,policy);
  const scored=stonefishV55PreviewRankHost(game,host);
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}
function getStonefishV55DiagPreviewPolicyFullReviewMove(game){
  const perspective=game.side;
  const policy=armxPreviewOpponentPolicy(game,perspective);
  const host=stonefishV55HostSearch(game,policy);
  const scored=armxFullRankHost(game,host,'artemis');
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}

function stonefishV55DiagSplitPolicies(game,perspective){
  const full=armxFullOpponentPolicy(game,perspective,'artemis');
  const preview=armxPreviewOpponentPolicy(game,perspective);
  const previewOrNeutral=preview||{
    observations:0,
    searchBudget:SF55C.nodes,
    maxDepth:SF55C.maxDepth,
    weights:new Float64Array(13),
    priority:()=>0,
    isLowPriority:()=>false,
  };
  return {
    fullBudgetPreviewOrdering:{
      ...full,
      weights:previewOrNeutral.weights,
      priority:previewOrNeutral.priority,
      isLowPriority:previewOrNeutral.isLowPriority,
    },
    previewBudgetFullOrdering:{
      ...previewOrNeutral,
      weights:full.weights,
      priority:full.priority,
      isLowPriority:full.isLowPriority,
    },
  };
}
function getStonefishV55DiagFullBudgetPreviewOrderingMove(game){
  const perspective=game.side;
  const policy=stonefishV55DiagSplitPolicies(game,perspective).fullBudgetPreviewOrdering;
  const host=stonefishV55HostSearch(game,policy);
  const scored=stonefishV55PreviewRankHost(game,host);
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}
function getStonefishV55DiagPreviewBudgetFullOrderingMove(game){
  const perspective=game.side;
  const policy=stonefishV55DiagSplitPolicies(game,perspective).previewBudgetFullOrdering;
  const host=stonefishV55HostSearch(game,policy);
  const scored=stonefishV55PreviewRankHost(game,host);
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_RANGE = STONEFISH_V5_5_RANGE;
  globalThis.stonefishV55RangeScoreAllMoves = stonefishV55RangeScoreAllMoves;
  globalThis.getStonefishV55AthenaMove = getStonefishV55AthenaMove;
  globalThis.getStonefishV55AresMove = getStonefishV55AresMove;
  globalThis.getStonefishV55ArtemisMove = getStonefishV55ArtemisMove;
  globalThis.stonefishV55FullARMXScoreAllMoves = stonefishV55FullARMXScoreAllMoves;
  globalThis.getStonefishV55FullARMXMove = getStonefishV55FullARMXMove;
  globalThis.getStonefishV55DiagFullPolicyPreviewReviewMove = getStonefishV55DiagFullPolicyPreviewReviewMove;
  globalThis.getStonefishV55DiagPreviewPolicyFullReviewMove = getStonefishV55DiagPreviewPolicyFullReviewMove;
  globalThis.getStonefishV55DiagFullBudgetPreviewOrderingMove = getStonefishV55DiagFullBudgetPreviewOrderingMove;
  globalThis.getStonefishV55DiagPreviewBudgetFullOrderingMove = getStonefishV55DiagPreviewBudgetFullOrderingMove;
}
