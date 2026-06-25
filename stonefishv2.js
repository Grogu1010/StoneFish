(function () {
  const VALUES = {
    P: 1,
    N: 3,
    B: 3,
    R: 5,
    Q: 9,
    K: 0
  };

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function withQueenPromotion(game, move) {
    const copy = game.cloneMove(move);
    if (game.isPromotionMove(copy)) copy.promotion = "Q";
    return copy;
  }

  function capturableMaterialScore(game, state, color) {
    // Stonefish v2's idea of "hanging" is deliberately simple:
    // after this move, add up every one of Stonefish's non-king pieces
    // that the opponent could legally capture immediately next move.
    // A piece only counts once, even if several enemy pieces can take it.
    const enemy = game.opponent(color);
    const capturableSquares = new Set();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const enemyPiece = state.board[r][c];
        if (!enemyPiece || game.colorOf(enemyPiece) !== enemy) continue;

        const pseudoMoves = game.getPseudoMoves(r, c, state);
        for (const captureMove of pseudoMoves) {
          const capturedSquare = captureMove.enPassant
            ? { r: captureMove.from.r, c: captureMove.to.c }
            : captureMove.to;

          const capturedPiece = state.board[capturedSquare.r][capturedSquare.c];
          if (!capturedPiece || game.colorOf(capturedPiece) !== color) continue;
          if (game.typeOf(capturedPiece) === "K") continue;

          const testState = game.cloneState(state);
          game.applyMoveToState(testState, captureMove);
          if (!game.isInCheck(enemy, testState)) {
            capturableSquares.add(`${capturedSquare.r},${capturedSquare.c}`);
          }
        }
      }
    }

    let total = 0;
    for (const key of capturableSquares) {
      const [r, c] = key.split(",").map(Number);
      total += VALUES[game.typeOf(state.board[r][c])] || 0;
    }

    return total;
  }

  window.StonefishV2 = {
    name: "Stonefish v2",

    chooseMove(game, color) {
      const legalMoves = game.getAllLegalMoves(color);
      if (!legalMoves.length) return null;

      const candidateMoves = legalMoves.map(move => withQueenPromotion(game, move));
      const mateInOneMoves = [];

      for (const move of candidateMoves) {
        const testState = game.cloneState();
        game.applyMoveToState(testState, move);
        const enemy = game.opponent(color);
        if (game.isInCheck(enemy, testState) && game.getAllLegalMoves(enemy, testState).length === 0) {
          mateInOneMoves.push(move);
        }
      }

      if (mateInOneMoves.length) return randomItem(mateInOneMoves);

      let bestScore = Infinity;
      const bestMoves = [];

      for (const move of candidateMoves) {
        const testState = game.cloneState();
        game.applyMoveToState(testState, move);
        const score = capturableMaterialScore(game, testState, color);

        if (score < bestScore) {
          bestScore = score;
          bestMoves.length = 0;
          bestMoves.push(move);
        } else if (score === bestScore) {
          bestMoves.push(move);
        }
      }

      return randomItem(bestMoves);
    }
  };
})();
