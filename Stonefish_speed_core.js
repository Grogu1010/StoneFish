// StoneFish exact speed core.
//
// This layer only removes duplicated search work. It does not change search
// depth, candidate limits, evaluation weights, move ordering, or tie-breaking.

(function stonefishInstallExactSpeedCore() {
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

  // Preserve v5's exact final tactical arithmetic, but apply each opponent
  // reply only once. The same generated response list is also reused for the
  // repetition check instead of re-applying the root move and generating it a
  // second time.
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

  // The geometry layer calls Pro root knowledge once with tactical=0 to rank
  // every move, then calls the same expensive function again for semifinalists
  // after their real tactical score is known. Only the final confidence term
  // depends on tactical. Capture the adaptive score from the first pass and
  // reuse the static part for subsequent calls on the exact same raw move.
  if (
    typeof stonefishV5ProRootKnowledge === 'function' &&
    typeof stonefishV5ProAdaptivePosition === 'function'
  ) {
    const sfProKnowledgeCache = new WeakMap();
    const sfProAdaptiveBase = stonefishV5ProAdaptivePosition;
    const sfProKnowledgeBase = stonefishV5ProRootKnowledge;
    let sfProAdaptiveCapture = null;

    function sfProDynamicConfidence(tactical, adaptive, heritageMatch, forcing) {
      let agreement = 0;
      if (tactical > 25) agreement += 1;
      if (adaptive > 80) agreement += 1;
      if (heritageMatch) agreement += 1;
      if (forcing) agreement += 1;
      if (agreement >= 3) return 120 + agreement * 25;
      if (tactical < -120 && adaptive > 120) return -160;
      return 0;
    }

    stonefishV5ProAdaptivePosition = function(game, perspective) {
      const score = sfProAdaptiveBase(game, perspective);
      if (
        sfProAdaptiveCapture &&
        sfProAdaptiveCapture.perspective === perspective &&
        sfProAdaptiveCapture.adaptive === undefined
      ) {
        sfProAdaptiveCapture.adaptive = score;
      }
      return score;
    };

    stonefishV5ProRootKnowledge = function(game, raw, heritageMove, bookMove, perspective, tactical) {
      const move = raw && raw._raw ? raw._raw : raw;
      const cached = sfProKnowledgeCache.get(move);
      const heritageMatch = !!heritageMove && stonefishV5SameMove(move, heritageMove);
      const forcing = !!(move.captured || move.promotion || game.fastGivesCheck(move));

      if (
        cached &&
        cached.heritageMove === heritageMove &&
        cached.bookMove === bookMove &&
        cached.perspective === perspective
      ) {
        return cached.staticPoints + sfProDynamicConfidence(
          tactical,
          cached.adaptive,
          cached.heritageMatch,
          cached.forcing
        );
      }

      const previousCapture = sfProAdaptiveCapture;
      const capture = { perspective, adaptive: undefined };
      sfProAdaptiveCapture = capture;
      let value;
      try {
        value = sfProKnowledgeBase(game, move, heritageMove, bookMove, perspective, tactical);
      } finally {
        sfProAdaptiveCapture = previousCapture;
      }

      if (capture.adaptive !== undefined) {
        const dynamic = sfProDynamicConfidence(tactical, capture.adaptive, heritageMatch, forcing);
        sfProKnowledgeCache.set(move, {
          heritageMove,
          bookMove,
          perspective,
          adaptive: capture.adaptive,
          heritageMatch,
          forcing,
          staticPoints: value - dynamic
        });
      }

      return value;
    };
  }
})();
