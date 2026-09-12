// StoneFish exact speed core.
//
// This layer only removes repeated work. It does not change search depth,
// candidate limits, evaluation weights, move ordering, or tie-breaking rules.
// The intent is exact move/score parity with less allocation and fewer repeated
// legality / attack calculations.

(function stonefishInstallExactSpeedCore() {
  const SF_SPEED_LEGAL_CACHE_LIMIT = 50000;
  const SF_SPEED_QUERY_CACHE_LIMIT = 100000;
  const SF_SPEED_ATTACK_CACHE_LIMIT = 30000;

  function sfSpeedCacheSet(map, key, value, limit) {
    if (map.size >= limit && !map.has(key)) map.delete(map.keys().next().value);
    map.set(key, value);
    return value;
  }

  function sfSpeedPackMove(move) {
    const raw = move && move._raw ? move._raw : move;
    return (
      (raw.from & 63) |
      ((raw.to & 63) << 6) |
      (((raw.promotion || 0) & 7) << 12) |
      (((raw.flags || 0) & 15) << 15) |
      (((raw.piece || 0) & 7) << 19) |
      (((raw.captured || 0) & 7) << 22)
    ) >>> 0;
  }

  function sfSpeedUnpackMove(packed) {
    return {
      from: packed & 63,
      to: (packed >>> 6) & 63,
      promotion: (packed >>> 12) & 7,
      flags: (packed >>> 15) & 15,
      piece: (packed >>> 19) & 7,
      captured: (packed >>> 22) & 7
    };
  }

  function sfSpeedPackMoves(moves) {
    const packed = new Uint32Array(moves.length);
    for (let i = 0; i < moves.length; i += 1) packed[i] = sfSpeedPackMove(moves[i]);
    return packed;
  }

  function sfSpeedUnpackMoves(packed) {
    const moves = new Array(packed.length);
    for (let i = 0; i < packed.length; i += 1) moves[i] = sfSpeedUnpackMove(packed[i]);
    return moves;
  }

  const sfBaseReset = Chess.prototype.reset;
  const sfBasePositionKey = Chess.prototype.fastPositionKey;
  const sfBaseApplyRaw = Chess.prototype._applyRaw;
  const sfBaseUndoRaw = Chess.prototype._undoRaw;
  const sfBaseFastMoves = Chess.prototype.fastMoves;
  const sfBaseFastGivesCheck = Chess.prototype.fastGivesCheck;

  Chess.prototype.reset = function() {
    this._sfSpeedKey = null;
    this._sfSpeedKeyStack = [];
    this._sfSpeedLegalCache = new Map();
    this._sfSpeedCheckCache = new Map();
    this._sfSpeedMateCache = new Map();
    this._sfSpeedAttackCache = new Map();
    const result = sfBaseReset.call(this);
    this._sfSpeedKeyStack.length = 0;
    return result;
  };

  Chess.prototype.fastPositionKey = function() {
    if (typeof this._sfSpeedKey === 'string') return this._sfSpeedKey;
    this._sfSpeedKey = sfBasePositionKey.call(this);
    return this._sfSpeedKey;
  };

  Chess.prototype._applyRaw = function(move, trackRepetition) {
    if (!this._sfSpeedKeyStack) this._sfSpeedKeyStack = [];
    this._sfSpeedKeyStack.push(this._sfSpeedKey);
    this._sfSpeedKey = null;
    try {
      return sfBaseApplyRaw.call(this, move, trackRepetition);
    } catch (error) {
      this._sfSpeedKey = this._sfSpeedKeyStack.pop() || null;
      throw error;
    }
  };

  Chess.prototype._undoRaw = function() {
    const result = sfBaseUndoRaw.call(this);
    if (result && this._sfSpeedKeyStack && this._sfSpeedKeyStack.length) {
      const restored = this._sfSpeedKeyStack.pop();
      this._sfSpeedKey = typeof restored === 'string' ? restored : null;
    } else if (result) {
      this._sfSpeedKey = null;
    }
    return result;
  };

  Chess.prototype.fastMoves = function() {
    if (!this._sfSpeedLegalCache) this._sfSpeedLegalCache = new Map();
    const key = this.fastPositionKey();
    const cached = this._sfSpeedLegalCache.get(key);
    if (cached !== undefined) return sfSpeedUnpackMoves(cached);

    const moves = sfBaseFastMoves.call(this);
    sfSpeedCacheSet(
      this._sfSpeedLegalCache,
      key,
      sfSpeedPackMoves(moves),
      SF_SPEED_LEGAL_CACHE_LIMIT
    );
    return moves;
  };

  Chess.prototype.fastHasLegalMove = function() {
    if (!this._sfSpeedLegalCache) this._sfSpeedLegalCache = new Map();
    const key = this.fastPositionKey();
    const cached = this._sfSpeedLegalCache.get(key);
    if (cached !== undefined) return cached.length > 0;

    const pseudo = this._pseudoMoves();
    for (let i = 0; i < pseudo.length; i += 1) {
      if (this._testLegalRaw(pseudo[i])) return true;
    }

    sfSpeedCacheSet(
      this._sfSpeedLegalCache,
      key,
      new Uint32Array(0),
      SF_SPEED_LEGAL_CACHE_LIMIT
    );
    return false;
  };

  Chess.prototype.fastGivesCheck = function(move) {
    if (!this._sfSpeedCheckCache) this._sfSpeedCheckCache = new Map();
    const raw = move && move._raw ? move._raw : move;
    const key = this.fastPositionKey() + '|c|' + sfSpeedPackMove(raw);
    const hit = this._sfSpeedCheckCache.get(key);
    if (hit !== undefined) return hit;
    return sfSpeedCacheSet(
      this._sfSpeedCheckCache,
      key,
      sfBaseFastGivesCheck.call(this, raw),
      SF_SPEED_QUERY_CACHE_LIMIT
    );
  };

  Chess.prototype.fastIsMateMove = function(move) {
    if (!this._sfSpeedMateCache) this._sfSpeedMateCache = new Map();
    const raw = move && move._raw ? move._raw : move;
    const key = this.fastPositionKey() + '|m|' + sfSpeedPackMove(raw);
    const hit = this._sfSpeedMateCache.get(key);
    if (hit !== undefined) return hit;

    if (!this.fastGivesCheck(raw)) {
      sfSpeedCacheSet(this._sfSpeedMateCache, key, false, SF_SPEED_QUERY_CACHE_LIMIT);
      return false;
    }

    this.fastApply(raw);
    const mate = !this.fastHasLegalMove();
    this.fastUndo();
    return sfSpeedCacheSet(
      this._sfSpeedMateCache,
      key,
      mate,
      SF_SPEED_QUERY_CACHE_LIMIT
    );
  };

  Chess.prototype.fastMobility = function(side) {
    const oldSide = this.side;
    const oldEp = this.ep;
    const oldKey = this._sfSpeedKey;
    this.side = side;
    this.ep = -1;
    this._sfSpeedKey = null;
    const count = this.fastMoves().length;
    this.side = oldSide;
    this.ep = oldEp;
    this._sfSpeedKey = typeof oldKey === 'string' ? oldKey : null;
    return count;
  };

  Chess.prototype.fastAttackCounts = function(side) {
    if (!this._sfSpeedAttackCache) this._sfSpeedAttackCache = new Map();
    const key = this.fastPositionKey() + '|a|' + side;
    const cached = this._sfSpeedAttackCache.get(key);
    if (cached !== undefined) return cached;

    const counts = new Uint8Array(64);
    const b = this.boardState;

    const markStep = (from, df, dr) => {
      const file = (from & 7) + df;
      const rank = (from >> 3) + dr;
      if (file >= 0 && file < 8 && rank >= 0 && rank < 8) counts[rank * 8 + file] += 1;
    };

    const markRay = (from, df, dr) => {
      let file = (from & 7) + df;
      let rank = (from >> 3) + dr;
      while (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
        const sq = rank * 8 + file;
        counts[sq] += 1;
        if (b[sq]) break;
        file += df;
        rank += dr;
      }
    };

    for (let from = 0; from < 64; from += 1) {
      const piece = b[from];
      if (!piece || (piece > 0 ? 1 : -1) !== side) continue;
      const type = Math.abs(piece);

      if (type === 1) {
        markStep(from, -1, side);
        markStep(from, 1, side);
      } else if (type === 2) {
        for (let i = 0; i < 8; i += 1) markStep(from, SF_KNIGHT_DF[i], SF_KNIGHT_DR[i]);
      } else if (type === 3) {
        for (let i = 0; i < SF_DIAG_DIRS.length; i += 2) markRay(from, SF_DIAG_DIRS[i], SF_DIAG_DIRS[i + 1]);
      } else if (type === 4) {
        for (let i = 0; i < SF_ORTH_DIRS.length; i += 2) markRay(from, SF_ORTH_DIRS[i], SF_ORTH_DIRS[i + 1]);
      } else if (type === 5) {
        for (let i = 0; i < SF_ALL_DIRS.length; i += 2) markRay(from, SF_ALL_DIRS[i], SF_ALL_DIRS[i + 1]);
      } else if (type === 6) {
        for (let i = 0; i < SF_ALL_DIRS.length; i += 2) markStep(from, SF_ALL_DIRS[i], SF_ALL_DIRS[i + 1]);
      }
    }

    return sfSpeedCacheSet(
      this._sfSpeedAttackCache,
      key,
      counts,
      SF_SPEED_ATTACK_CACHE_LIMIT
    );
  };

  // Exact replacements for stable-board evaluation helpers. These use the
  // shared attack-count map instead of re-tracing rays for every queried square.
  if (typeof stonefishV4CenterControl === 'function') {
    stonefishV4CenterControl = function(game, side) {
      const attacks = game.fastAttackCounts(side);
      let score = 0;
      for (let i = 0; i < STONEFISH_V4_CENTER.length; i += 1) {
        const sq = STONEFISH_V4_CENTER[i];
        const piece = game.boardState[sq];
        if (piece && (piece > 0 ? 1 : -1) === side) score += 2;
        if (attacks[sq]) score += 1;
      }
      return score;
    };
  }

  if (typeof stonefishV4BoardControl === 'function') {
    stonefishV4BoardControl = function(game, side) {
      const attacks = game.fastAttackCounts(side);
      let score = 0;
      for (let sq = 0; sq < 64; sq += 1) if (attacks[sq]) score += 1;
      return score;
    };
  }

  if (typeof stonefishV4HangingMax === 'function') {
    stonefishV4HangingMax = function(game, side) {
      const enemyAttacks = game.fastAttackCounts(-side);
      const ownAttacks = game.fastAttackCounts(side);
      let maxValue = 0;
      for (let sq = 0; sq < 64; sq += 1) {
        const piece = game.boardState[sq];
        if (!piece || (piece > 0 ? 1 : -1) !== side || Math.abs(piece) === 6) continue;
        if (enemyAttacks[sq] && !ownAttacks[sq]) {
          maxValue = Math.max(maxValue, STONEFISH_V4_VALUES[Math.abs(piece)] || 0);
        }
      }
      return -maxValue;
    };
  }

  if (typeof stonefishV5ProAttackCount === 'function') {
    stonefishV5ProAttackCount = function(game, sq, side) {
      return game.fastAttackCounts(side)[sq];
    };
  }

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

  if (typeof stonefishV5BestResponseGain === 'function') {
    stonefishV5BestResponseGain = function(game, responses) {
      let best = 0;
      for (let i = 0; i < responses.length; i += 1) {
        const response = responses[i];
        const givesCheck = game.fastGivesCheck(response);
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
  }

  // v5's final tactical function used to apply several branches twice: once to
  // ask if they mate, then again to score them. This keeps the exact arithmetic
  // and repetition rules while reusing the already-generated reply position.
  if (typeof stonefishV5TacticalScore === 'function') {
    stonefishV5TacticalScore = function(game, raw) {
      if (game.fastIsMateMove(raw)) return STONEFISH_V5_MATE * 2;

      let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
      if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

      game.fastApply(raw);
      const replies = game.fastMoves();
      let score;

      if (!replies.length) {
        score = game.in_check() ? STONEFISH_V5_MATE : 0;
      } else {
        let worst = Infinity;

        for (let i = 0; i < replies.length; i += 1) {
          const reply = replies[i];
          const givesCheck = game.fastGivesCheck(reply);

          let opponentGain = STONEFISH_V5_PIECE[reply.captured] || 0;
          if (reply.promotion) opponentGain += (STONEFISH_V5_PIECE[reply.promotion] || 0) - 100;
          if (givesCheck) opponentGain += 14;

          game.fastApply(reply);
          const responses = game.fastMoves();
          if (givesCheck && !responses.length) {
            game.fastUndo();
            game.fastUndo();
            return -STONEFISH_V5_MATE;
          }

          const ourGain = stonefishV5BestResponseGain(game, responses);
          game.fastUndo();

          const branch = immediate - opponentGain + ourGain;
          if (branch < worst) worst = branch;
        }
        score = worst;
      }

      if (score >= STONEFISH_V5_MATE) score = STONEFISH_V5_MATE * 0.5;
      if (score <= -STONEFISH_V5_MATE) {
        game.fastUndo();
        return -STONEFISH_V5_MATE;
      }

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

      game.fastUndo();
      return score;
    };
  }
})();
