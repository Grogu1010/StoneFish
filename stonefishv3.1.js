(function () {
  const VALUES = {
    P: 1,
    N: 3,
    B: 3,
    R: 5,
    Q: 9,
    K: 0
  };

  const PROMOTIONS = ["Q", "R", "B", "N"];

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function withQueenPromotion(game, move) {
    const copy = game.cloneMove(move);
    if (game.isPromotionMove(copy)) copy.promotion = "Q";
    return copy;
  }

  function expandPromotionChoices(game, move, state) {
    if (!game.isPromotionMove(move, state)) return [game.cloneMove(move)];

    return PROMOTIONS.map(promotion => {
      const copy = game.cloneMove(move);
      copy.promotion = promotion;
      return copy;
    });
  }

  function forEachPseudoMove(game, state, color, callback) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = state.board[r][c];
        if (!piece || game.colorOf(piece) !== color) continue;

        const pseudoMoves = game.getPseudoMoves(r, c, state);
        for (const pseudoMove of pseudoMoves) {
          for (const move of expandPromotionChoices(game, pseudoMove, state)) {
            if (callback(move) === true) return true;
          }
        }
      }
    }
    return false;
  }

  function capturedPieceForMove(game, state, move) {
    const capturedSquare = move.enPassant
      ? { r: move.from.r, c: move.to.c }
      : move.to;
    return state.board[capturedSquare.r][capturedSquare.c];
  }

  function materialCapturedByMove(game, state, move, moverColor) {
    const capturedPiece = capturedPieceForMove(game, state, move);
    if (!capturedPiece || game.colorOf(capturedPiece) === moverColor) return 0;
    return VALUES[game.typeOf(capturedPiece)] || 0;
  }

  function moveCheckmates(game, state, move, moverColor) {
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    const enemy = game.opponent(moverColor);
    return game.isInCheck(enemy, testState) && game.getAllLegalMoves(enemy, testState).length === 0;
  }

  function opponentHasMateInOne(game, state, defenderColor) {
    const attacker = game.opponent(defenderColor);

    return forEachPseudoMove(game, state, attacker, move => {
      const testState = game.cloneState(state);
      game.applyMoveToState(testState, move);

      if (game.isInCheck(attacker, testState)) return false;
      if (!game.isInCheck(defenderColor, testState)) return false;

      return game.getAllLegalMoves(defenderColor, testState).length === 0;
    });
  }

  function capturableMaterialProfile(game, state, color) {
    // Stonefish v3.1 keeps the v3 hanging definition:
    // after this candidate move, count every own non-king piece that the
    // opponent could legally capture immediately next turn. Count each piece once.
    const enemy = game.opponent(color);
    const capturableSquares = new Map();

    forEachPseudoMove(game, state, enemy, captureMove => {
      const capturedSquare = captureMove.enPassant
        ? { r: captureMove.from.r, c: captureMove.to.c }
        : captureMove.to;

      const capturedPiece = state.board[capturedSquare.r][capturedSquare.c];
      if (!capturedPiece || game.colorOf(capturedPiece) !== color) return false;
      if (game.typeOf(capturedPiece) === "K") return false;

      const testState = game.cloneState(state);
      game.applyMoveToState(testState, captureMove);
      if (game.isInCheck(enemy, testState)) return false;

      const value = VALUES[game.typeOf(capturedPiece)] || 0;
      const key = `${capturedSquare.r},${capturedSquare.c}`;
      capturableSquares.set(key, value);
      return false;
    });

    let total = 0;
    let maxSingle = 0;
    for (const value of capturableSquares.values()) {
      total += value;
      if (value > maxSingle) maxSingle = value;
    }

    return { total, maxSingle };
  }

  function filterMinimum(items, scoreName) {
    let best = Infinity;
    const winners = [];
    for (const item of items) {
      const score = item[scoreName];
      if (score < best) {
        best = score;
        winners.length = 0;
        winners.push(item);
      } else if (score === best) {
        winners.push(item);
      }
    }
    return winners;
  }

  function filterMaximum(items, scoreName) {
    let best = -Infinity;
    const winners = [];
    for (const item of items) {
      const score = item[scoreName];
      if (score > best) {
        best = score;
        winners.length = 0;
        winners.push(item);
      } else if (score === best) {
        winners.push(item);
      }
    }
    return winners;
  }

  window.StonefishV31 = {
    name: "Stonefish v3.1",

    chooseMove(game, color) {
      const legalMoves = game.getAllLegalMoves(color);
      if (!legalMoves.length) return null;

      const candidateMoves = legalMoves.map(move => withQueenPromotion(game, move));
      const mateInOneMoves = candidateMoves.filter(move => moveCheckmates(game, game.state, move, color));
      if (mateInOneMoves.length) return randomItem(mateInOneMoves);

      const candidates = candidateMoves.map(move => {
        const testState = game.cloneState();
        game.applyMoveToState(testState, move);
        const enemy = game.opponent(color);
        const profile = capturableMaterialProfile(game, testState, color);
        return {
          move,
          allowsMateInOne: opponentHasMateInOne(game, testState, color),
          capturableTotal: profile.total,
          biggestSingleLoss: profile.maxSingle,
          materialGain: materialCapturedByMove(game, game.state, move, color),
          givesCheck: game.isInCheck(enemy, testState),
          opponentLegalMoves: game.getAllLegalMoves(enemy, testState).length
        };
      });

      let pool = candidates.filter(candidate => !candidate.allowsMateInOne);
      if (!pool.length) pool = candidates;

      pool = filterMinimum(pool, "capturableTotal");
      pool = filterMinimum(pool, "biggestSingleLoss");
      pool = filterMaximum(pool, "materialGain");

      const checkingMoves = pool.filter(candidate => candidate.givesCheck);
      if (checkingMoves.length) pool = checkingMoves;

      pool = filterMinimum(pool, "opponentLegalMoves");

      return randomItem(pool).move;
    }
  };
})();
