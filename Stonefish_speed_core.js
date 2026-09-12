// StoneFish exact speed core.
//
// This layer only removes duplicated search work. It does not change search
// depth, candidate limits, evaluation weights, move ordering, or tie-breaking.

(function stonefishInstallExactSpeedCore() {
  const sfV5RootReplySummary = new WeakMap();

  // A mate test only needs to know whether at least one legal reply exists.
  // Stop at the first legal reply instead of constructing the full legal list.
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

  // v3 previously generated every legal response after a checking third-ply
  // move just to learn whether any reply existed.
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

  // v4.5's strict mating-pattern scorer used to test mate by applying the move,
  // undoing it, and then immediately applying the same move again for geometry.
  // Keep the candidate applied once and do the exact mate-existence test there.
  if (typeof stonefishV45StrictPatternScore === 'function') {
    stonefishV45StrictPatternScore = function(game, raw) {
      game.fastApply(raw);
      const ownSide = -game.side;
      const enemySide = game.side;

      if (game.in_check() && !game.fastHasLegalMove()) {
        game.fastUndo();
        return 1000000;
      }

      let score = 0;
      score += stonefishV45LadderScore(game, ownSide, enemySide);
      score += stonefishV45TriangleScore(game, ownSide, enemySide);
      score += stonefishV45BackRankScore(game, ownSide, enemySide);
      score += stonefishV45SmotheredScore(game, ownSide, enemySide, raw);
      score += stonefishV45ArabianScore(game, ownSide, enemySide);
      score += stonefishV45BodenScore(game, ownSide, enemySide);

      const freedom = stonefishV4KingFreedom(game, enemySide);
      if (
        game.in_check() &&
        freedom === 0 &&
        stonefishV45Pieces(game, ownSide, 5).length &&
        stonefishV45Pieces(game, ownSide, 4).length
      ) {
        score += 24;
      }

      game.fastUndo();
      return score;
    };
  }

  // v5 used to calculate "gives check" once inside fastIsMateMove and then a
  // second time for the check bonus. Reuse that answer and use the existence
  // test for mate replies.
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

  // Preserve v5's exact final tactical arithmetic while applying each root move
  // and each opponent reply only once. Also retain opponent mobility/check facts
  // for the immediately-following root knowledge calculation.
  if (typeof stonefishV5TacticalScore === 'function') {
    stonefishV5TacticalScore = function(game, raw) {
      let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
      if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

      game.fastApply(raw);
      const replies = game.fastMoves();

      if (!replies.length && game.in_check()) {
        game.fastUndo();
        return STONEFISH_V5_MATE * 2;
      }

      let score;
      let replyChecks = 0;
      if (!replies.length) {
        score = 0;
      } else {
        let worst = Infinity;

        for (let i = 0; i < replies.length; i += 1) {
          const reply = replies[i];
          const givesCheck = game.fastGivesCheck(reply);
          if (givesCheck) replyChecks += 1;

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

      sfV5RootReplySummary.set(raw, {
        mobility: replies.length,
        checks: replyChecks
      });

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

  function sfV5StrictPatternScoreApplied(game, raw, checking, replyCount) {
    if (checking && replyCount === 0) return 1000000;

    const ownSide = -game.side;
    const enemySide = game.side;
    let score = 0;
    score += stonefishV45LadderScore(game, ownSide, enemySide);
    score += stonefishV45TriangleScore(game, ownSide, enemySide);
    score += stonefishV45BackRankScore(game, ownSide, enemySide);
    score += stonefishV45SmotheredScore(game, ownSide, enemySide, raw);
    score += stonefishV45ArabianScore(game, ownSide, enemySide);
    score += stonefishV45BodenScore(game, ownSide, enemySide);

    const freedom = stonefishV4KingFreedom(game, enemySide);
    if (
      checking &&
      freedom === 0 &&
      stonefishV45Pieces(game, ownSide, 5).length &&
      stonefishV45Pieces(game, ownSide, 4).length
    ) {
      score += 24;
    }
    return score;
  }

  // v5's root knowledge used to make/undo the same candidate separately for
  // opponent-check risk, opponent mobility, mating geometry, positional score,
  // repetition and (for the heritage move) passer danger. Those questions all
  // describe the same hypothetical board, so answer them in one make/undo.
  if (typeof stonefishV5RootKnowledge === 'function') {
    stonefishV5RootKnowledge = function(game, raw, heritageMove, bookMove, perspective) {
      let points = 0;
      const heritageMatch = !!heritageMove && stonefishV5SameMove(raw, heritageMove);
      if (bookMove && stonefishV5SameMove(raw, bookMove)) points += STONEFISH_V5_WEIGHTS.book;
      if (raw.flags & (4 | 8)) points += STONEFISH_V5_WEIGHTS.castle;
      if (raw.promotion) points += STONEFISH_V5_WEIGHTS.promotion;

      game.fastApply(raw);
      const checking = game.in_check();
      if (checking) points += STONEFISH_V5_WEIGHTS.check;

      let summary = sfV5RootReplySummary.get(raw);
      if (!summary) {
        const replies = game.fastMoves();
        let checks = 0;
        for (let i = 0; i < replies.length; i += 1) {
          if (game.fastGivesCheck(replies[i])) checks += 1;
        }
        summary = { mobility: replies.length, checks };
        sfV5RootReplySummary.set(raw, summary);
      }

      points += -summary.checks * STONEFISH_V5_WEIGHTS.oppCheckRisk;
      points += -summary.mobility * STONEFISH_V5_WEIGHTS.oppMobility;
      points += sfV5StrictPatternScoreApplied(
        game,
        raw,
        checking,
        summary.mobility
      ) * STONEFISH_V5_WEIGHTS.matePattern;

      points += stonefishV5PositionScore(game, perspective) * STONEFISH_V5_WEIGHTS.positional;

      const ownSide = -game.side;
      const enemySide = game.side;
      const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
      const lead = stonefishV5Material(game, ownSide) - stonefishV5Material(game, enemySide);
      if (visits > 0) {
        points -= visits * STONEFISH_V5_WEIGHTS.repetition;
        if (lead >= 200) points -= STONEFISH_V5_WEIGHTS.repetitionAhead;
      }
      if (game.halfmove >= 60 && (raw.piece === 1 || raw.captured)) {
        points += STONEFISH_V5_WEIGHTS.fiftyReset;
      }

      if (heritageMatch) {
        const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
        const heritageScale = enemyThreat >= 300
          ? 0
          : enemyThreat >= 120
            ? 0.18
            : enemyThreat >= 35
              ? 0.60
              : 1.0;
        points += STONEFISH_V5_WEIGHTS.heritage * heritageScale;
      }

      game.fastUndo();
      return points;
    };
  }
})();
