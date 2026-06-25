(function () {
  const VALUES = {
    P: 1,
    N: 3,
    B: 3,
    R: 5,
    Q: 9,
    K: 0
  };

  const MATE_PUNISHMENT = 1000;
  const legalMoveCache = new Map();

  function stateKey(state, color) {
    const board = state.board.map(row => row.map(piece => piece || "..").join("")).join("/");
    const castling = `${state.castling.w.K ? "K" : ""}${state.castling.w.Q ? "Q" : ""}${state.castling.b.K ? "k" : ""}${state.castling.b.Q ? "q" : ""}`;
    const ep = state.enPassant ? `${state.enPassant.r},${state.enPassant.c}` : "-";
    return `${color}|${state.turn}|${board}|${castling}|${ep}`;
  }

  function clearCacheIfLarge() {
    if (legalMoveCache.size > 20000) legalMoveCache.clear();
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function cloneMoveWithQueenPromotion(game, state, move) {
    const copy = game.cloneMove(move);
    if (game.isPromotionMove(copy, state)) copy.promotion = "Q";
    return copy;
  }

  function legalMoves(game, state, color) {
    const key = stateKey(state, color);
    const cached = legalMoveCache.get(key);
    if (cached) return cached.map(move => game.cloneMove(move));

    const moves = game.getAllLegalMoves(color, state).map(move => cloneMoveWithQueenPromotion(game, state, move));
    legalMoveCache.set(key, moves.map(move => game.cloneMove(move)));
    clearCacheIfLarge();
    return moves;
  }

  function capturedSquareForMove(move) {
    return move.enPassant
      ? { r: move.from.r, c: move.to.c }
      : move.to;
  }

  function capturedPieceForMove(state, move) {
    const capturedSquare = capturedSquareForMove(move);
    return state.board[capturedSquare.r][capturedSquare.c];
  }

  function materialCapturedByMove(game, state, move, moverColor) {
    const capturedPiece = capturedPieceForMove(state, move);
    if (!capturedPiece || game.colorOf(capturedPiece) === moverColor) return 0;
    return VALUES[game.typeOf(capturedPiece)] || 0;
  }

  function moveCheckmates(game, state, move, moverColor) {
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    const enemy = game.opponent(moverColor);
    return game.isInCheck(enemy, testState) && legalMoves(game, testState, enemy).length === 0;
  }

  function sideHasMateInOne(game, state, color) {
    const moves = legalMoves(game, state, color);
    for (const move of moves) {
      if (moveCheckmates(game, state, move, color)) return true;
    }
    return false;
  }

  function opponentHasMateInOne(game, state, defenderColor) {
    return sideHasMateInOne(game, state, game.opponent(defenderColor));
  }

  function bestImmediateReplyAfterOpponentCapture(game, stateAfterOpponentReply, color) {
    const moves = legalMoves(game, stateAfterOpponentReply, color);
    let bestCaptureGain = 0;

    for (const move of moves) {
      const responseState = game.cloneState(stateAfterOpponentReply);
      game.applyMoveToState(responseState, move);
      const enemy = game.opponent(color);

      if (game.isInCheck(enemy, responseState) && legalMoves(game, responseState, enemy).length === 0) {
        return MATE_PUNISHMENT;
      }

      const gain = materialCapturedByMove(game, stateAfterOpponentReply, move, color);
      if (gain > bestCaptureGain) bestCaptureGain = gain;
    }

    return bestCaptureGain;
  }

  function replyAwareDangerProfile(game, stateAfterCandidate, color) {
    const enemy = game.opponent(color);
    const opponentReplies = legalMoves(game, stateAfterCandidate, enemy);
    const capturableSquares = new Map();

    let sawCapture = false;
    let worstReplyNetLoss = 0;
    let biggestReplyAwareSingleLoss = 0;

    for (const reply of opponentReplies) {
      const capturedSquare = capturedSquareForMove(reply);
      const capturedPiece = stateAfterCandidate.board[capturedSquare.r][capturedSquare.c];

      if (!capturedPiece || game.colorOf(capturedPiece) !== color) continue;
      if (game.typeOf(capturedPiece) === "K") continue;

      sawCapture = true;

      const opponentGain = VALUES[game.typeOf(capturedPiece)] || 0;
      const replyState = game.cloneState(stateAfterCandidate);
      game.applyMoveToState(replyState, reply);

      // v4's main change: apparent hanging material is judged by the reply.
      // If the opponent grabs this piece, Stonefish checks whether it can
      // immediately punish that capture by mating or winning more material.
      const myBestImmediateReplyGain = bestImmediateReplyAfterOpponentCapture(game, replyState, color);
      const netLoss = opponentGain - myBestImmediateReplyGain;

      if (netLoss > worstReplyNetLoss) worstReplyNetLoss = netLoss;

      const positiveLoss = Math.max(0, netLoss);
      if (positiveLoss > biggestReplyAwareSingleLoss) biggestReplyAwareSingleLoss = positiveLoss;

      const key = `${capturedSquare.r},${capturedSquare.c}`;
      const previous = capturableSquares.get(key);
      if (!previous || netLoss > previous.netLoss) {
        capturableSquares.set(key, { value: opponentGain, netLoss });
      }
    }

    let replyAwareTotal = 0;
    let rawCapturableTotal = 0;
    let rawBiggestSingleLoss = 0;

    for (const danger of capturableSquares.values()) {
      replyAwareTotal += Math.max(0, danger.netLoss);
      rawCapturableTotal += danger.value;
      if (danger.value > rawBiggestSingleLoss) rawBiggestSingleLoss = danger.value;
    }

    return {
      replyAwareDanger: sawCapture ? worstReplyNetLoss : 0,
      biggestSingleLoss: biggestReplyAwareSingleLoss,
      replyAwareTotal,
      rawCapturableTotal,
      rawBiggestSingleLoss
    };
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

  window.StonefishV4 = {
    name: "Stonefish v4",

    chooseMove(game, color) {
      const candidateMoves = legalMoves(game, game.state, color);
      if (!candidateMoves.length) return null;

      const mateInOneMoves = candidateMoves.filter(move => moveCheckmates(game, game.state, move, color));
      if (mateInOneMoves.length) return randomItem(mateInOneMoves);

      let pool = candidateMoves.map(move => {
        const testState = game.cloneState();
        game.applyMoveToState(testState, move);
        return { move, testState };
      });

      // Keep v3.1's mate-safety gate before any material logic.
      for (const candidate of pool) {
        candidate.allowsMateInOne = opponentHasMateInOne(game, candidate.testState, color);
      }

      const mateSafePool = pool.filter(candidate => !candidate.allowsMateInOne);
      if (mateSafePool.length) pool = mateSafePool;

      // Compute the expensive reply-aware danger only after illegal/mate-losing
      // tactical moves have been separated out.
      for (const candidate of pool) {
        const danger = replyAwareDangerProfile(game, candidate.testState, color);
        candidate.replyAwareDanger = danger.replyAwareDanger;
        candidate.biggestSingleLoss = danger.biggestSingleLoss;
        candidate.replyAwareTotal = danger.replyAwareTotal;
        candidate.rawCapturableTotal = danger.rawCapturableTotal;
        candidate.rawBiggestSingleLoss = danger.rawBiggestSingleLoss;
      }

      // This replaces v3.1's blind capturableTotal filter. Lower is better;
      // negative means the opponent's capture loses more than it wins.
      pool = filterMinimum(pool, "replyAwareDanger");
      pool = filterMinimum(pool, "biggestSingleLoss");

      for (const candidate of pool) {
        candidate.materialGain = materialCapturedByMove(game, game.state, candidate.move, color);
      }
      pool = filterMaximum(pool, "materialGain");

      for (const candidate of pool) {
        const enemy = game.opponent(color);
        candidate.givesCheck = game.isInCheck(enemy, candidate.testState);
      }
      const checkingMoves = pool.filter(candidate => candidate.givesCheck);
      if (checkingMoves.length) pool = checkingMoves;

      for (const candidate of pool) {
        const enemy = game.opponent(color);
        candidate.opponentLegalMoves = legalMoves(game, candidate.testState, enemy).length;
      }
      pool = filterMinimum(pool, "opponentLegalMoves");

      return randomItem(pool).move;
    }
  };
})();
