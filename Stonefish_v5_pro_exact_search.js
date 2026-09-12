// Exact v5 Pro search optimizations.
// Hoists node-invariant passed-pawn analysis out of per-move ordering and
// reuses the already-computed position key at leaves. Search width, depth,
// ordering scores, alpha-beta logic, TT semantics and leaf scores are unchanged.

(function stonefishInstallExactProSearchSpeed() {
  if (
    typeof stonefishV5ProMinimax !== 'function' ||
    typeof STONEFISH_V5_PRO_SPEED_BRANCH === 'undefined' ||
    typeof STONEFISH_V5_PRO_POSITION_CACHE === 'undefined'
  ) return;

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
