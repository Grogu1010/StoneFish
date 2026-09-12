// Exact v5 Pro search optimizations.
// Hoists node-invariant passed-pawn analysis out of per-move ordering, reuses
// exact attack-count maps inside Pro evaluation, and reuses position keys at
// leaves. Search width, depth, ordering scores, alpha-beta logic, TT semantics
// and evaluation formulas are unchanged.

(function stonefishInstallExactProSearchSpeed() {
  if (
    typeof stonefishV5ProMinimax !== 'function' ||
    typeof STONEFISH_V5_PRO_SPEED_BRANCH === 'undefined' ||
    typeof STONEFISH_V5_PRO_POSITION_CACHE === 'undefined'
  ) return;

  // Pro repeatedly asks for attack COUNTS, not just attacked/not-attacked. Build
  // the exact count map once for each side at a stable board state instead of
  // retracing rays separately for every queried square.
  const sfProBaseReset = Chess.prototype.reset;
  const sfProBaseApplyRaw = Chess.prototype._applyRaw;
  const sfProBaseUndoRaw = Chess.prototype._undoRaw;

  Chess.prototype.reset = function() {
    const result = sfProBaseReset.call(this);
    this._sfProAttackCache = null;
    return result;
  };

  Chess.prototype._applyRaw = function(move, trackRepetition) {
    const result = sfProBaseApplyRaw.call(this, move, trackRepetition);
    this._sfProAttackCache = null;
    return result;
  };

  Chess.prototype._undoRaw = function() {
    const result = sfProBaseUndoRaw.call(this);
    if (result) this._sfProAttackCache = null;
    return result;
  };

  Chess.prototype.fastProAttackCounts = function(side) {
    let cache = this._sfProAttackCache;
    if (!cache) {
      cache = Object.create(null);
      this._sfProAttackCache = cache;
    }
    if (cache[side]) return cache[side];

    const counts = new Uint8Array(64);
    const b = this.boardState;

    function markStep(from, df, dr) {
      const f = (from & 7) + df;
      const r = (from >> 3) + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) counts[r * 8 + f] += 1;
    }

    function markRay(from, df, dr) {
      let f = (from & 7) + df;
      let r = (from >> 3) + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const sq = r * 8 + f;
        counts[sq] += 1;
        if (b[sq]) break;
        f += df;
        r += dr;
      }
    }

    for (let from = 0; from < 64; from += 1) {
      const p = b[from];
      if (!p || (p > 0 ? 1 : -1) !== side) continue;
      const type = Math.abs(p);

      if (type === 1) {
        markStep(from, -1, side);
        markStep(from, 1, side);
      } else if (type === 2) {
        for (let i = 0; i < 8; i += 1) {
          markStep(from, SF_KNIGHT_DF[i], SF_KNIGHT_DR[i]);
        }
      } else if (type === 3) {
        for (let i = 0; i < SF_DIAG_DIRS.length; i += 2) {
          markRay(from, SF_DIAG_DIRS[i], SF_DIAG_DIRS[i + 1]);
        }
      } else if (type === 4) {
        for (let i = 0; i < SF_ORTH_DIRS.length; i += 2) {
          markRay(from, SF_ORTH_DIRS[i], SF_ORTH_DIRS[i + 1]);
        }
      } else if (type === 5) {
        for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
          markRay(from, SF_ALL_DIRS[i], SF_ALL_DIRS[i + 1]);
        }
      } else if (type === 6) {
        for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
          markStep(from, SF_ALL_DIRS[i], SF_ALL_DIRS[i + 1]);
        }
      }
    }

    cache[side] = counts;
    return counts;
  };

  stonefishV5ProAttackCount = function(game, sq, side) {
    return game.fastProAttackCounts(side)[sq];
  };

  stonefishV5ProKingZonePressure = function(game, attacker) {
    const counts = game.fastProAttackCounts(attacker);
    const kingSq = game.kingSq[-attacker];
    const kf = kingSq & 7;
    const kr = kingSq >> 3;
    let pressure = 0;

    for (let df = -1; df <= 1; df += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const f = kf + df;
        const r = kr + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        pressure += counts[r * 8 + f];
      }
    }
    return pressure;
  };

  stonefishV5ProLooseAndCoordination = function(game, perspective) {
    const white = game.fastProAttackCounts(1);
    const black = game.fastProAttackCounts(-1);
    let score = 0;

    for (let sq = 0; sq < 64; sq += 1) {
      const p = game.boardState[sq];
      if (!p || Math.abs(p) === 6) continue;
      const side = p > 0 ? 1 : -1;
      const value = STONEFISH_V5_PIECE[Math.abs(p)] || 0;
      const attackers = (side === 1 ? black : white)[sq];
      const defenders = (side === 1 ? white : black)[sq];
      let pieceScore = defenders > 0 ? Math.min(40, 8 + defenders * 6) : 0;

      if (attackers > 0) {
        if (defenders === 0) pieceScore -= value * 0.22;
        else if (attackers > defenders) {
          pieceScore -= value * 0.11 * Math.min(2, attackers - defenders);
        } else {
          pieceScore -= value * 0.025;
        }
      }
      score += side === perspective ? pieceScore : -pieceScore;
    }
    return score;
  };

  function sfProThreatFromPassers(passers) {
    let max = 0;
    for (let i = 0; i < passers.length; i += 1) {
      max = Math.max(max, stonefishV5PasserDanger(passers[i].distance));
    }
    return max;
  }

  function sfProMoveOrderWithPassers(game, move, passers) {
    let score = stonefishV5ProMoveOrder(game, move);
    const enemy = -game.side;

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

  function sfProOrderedMoves(game, legal, limit, passers) {
    return legal
      .map((move, index) => ({
        move,
        index,
        order: sfProMoveOrderWithPassers(game, move, passers)
      }))
      .sort((a, b) => (b.order - a.order) || (a.index - b.index))
      .slice(0, Math.min(limit, legal.length));
  }

  function sfProLeafWithPositionKey(game, perspective, positionKey) {
    const cacheKey = perspective + '|' + positionKey;
    let score = STONEFISH_V5_PRO_POSITION_CACHE.get(cacheKey);
    if (score === undefined) {
      score = stonefishV5ProSpeedCacheSet(
        STONEFISH_V5_PRO_POSITION_CACHE,
        cacheKey,
        stonefishV5PositionScore(game, perspective)
      );
    }

    const enemyThreat = sfProThreatFromPassers(stonefishV5PassedPawnInfo(game, -perspective));
    const ourThreat = sfProThreatFromPassers(stonefishV5PassedPawnInfo(game, perspective));
    if (enemyThreat >= 2200) score -= enemyThreat * 1.35;
    else if (enemyThreat >= 900) score -= enemyThreat * 0.55;
    if (ourThreat >= 2200) score += ourThreat * 0.42;
    else if (ourThreat >= 900) score += ourThreat * 0.18;
    return score;
  }

  function sfProCheckedLeafExact(game, perspective, alpha, beta, legal, plyFromRoot) {
    const passers = stonefishV5PassedPawnInfo(game, -game.side);
    const ordered = sfProOrderedMoves(game, legal, 6, passers);
    const maximizing = game.side === perspective;
    let best = maximizing ? -Infinity : Infinity;

    for (let i = 0; i < ordered.length; i += 1) {
      const entry = ordered[i];
      game.fastApply(entry.move);
      let value;

      if (!game.fastHasLegalMove()) {
        value = game.in_check()
          ? (game.side === perspective
              ? -STONEFISH_V5_PRO_MATE + plyFromRoot + 1
              : STONEFISH_V5_PRO_MATE - plyFromRoot - 1)
          : 0;
      } else {
        value = sfProLeafWithPositionKey(game, perspective, game.fastPositionKey());
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
    let positionKey = null;
    let key = null;

    if (tt) {
      positionKey = game.fastPositionKey();
      key = perspective + '|' + depth + '|' + plyFromRoot + '|' + game.halfmove + '|' + positionKey;
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

        const extended = sfProCheckedLeafExact(
          game,
          perspective,
          alpha,
          beta,
          legal,
          plyFromRoot
        );
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

      if (positionKey === null) positionKey = game.fastPositionKey();
      const leaf = sfProLeafWithPositionKey(game, perspective, positionKey);
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
      if (tt) tt.set(key, leaf);
      return leaf;
    }

    const legal = game.fastMoves();
    if (!legal.length) {
      const terminal = !game.in_check()
        ? 0
        : (game.side === perspective
            ? -STONEFISH_V5_PRO_MATE + plyFromRoot
            : STONEFISH_V5_PRO_MATE - plyFromRoot);
      if (tt) tt.set(key, terminal);
      return terminal;
    }
    if (game.halfmove >= 100 || game._insufficientMaterial()) {
      if (tt) tt.set(key, 0);
      return 0;
    }

    const passers = stonefishV5PassedPawnInfo(game, -game.side);
    const danger = sfProThreatFromPassers(passers);
    let width = STONEFISH_V5_PRO_SPEED_BRANCH[depth] || 2;
    if (game.in_check()) width = Math.max(width, 6);
    else if (danger >= 2200) width += 2;
    else if (danger >= 900) width += 1;
    width = Math.min(width, legal.length);

    const ordered = sfProOrderedMoves(game, legal, width, passers);
    const maximizing = game.side === perspective;
    let best = maximizing ? -Infinity : Infinity;
    let cutoff = false;

    for (let i = 0; i < ordered.length; i += 1) {
      game.fastApply(ordered[i].move);
      const value = stonefishV5ProMinimax(
        game,
        depth - 1,
        perspective,
        alpha,
        beta,
        plyFromRoot + 1
      );
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
})();
