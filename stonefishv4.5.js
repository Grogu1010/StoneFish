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
  const tacticalEvalCache = new Map();

  function stateKey(state, color) {
    const board = state.board.map(row => row.map(piece => piece || "..").join("")).join("/");
    const castling = `${state.castling.w.K ? "K" : ""}${state.castling.w.Q ? "Q" : ""}${state.castling.b.K ? "k" : ""}${state.castling.b.Q ? "q" : ""}`;
    const ep = state.enPassant ? `${state.enPassant.r},${state.enPassant.c}` : "-";
    return `${color}|${state.turn}|${board}|${castling}|${ep}`;
  }

  function clearCacheIfLarge() {
    if (legalMoveCache.size > 20000) legalMoveCache.clear();
    if (tacticalEvalCache.size > 20000) tacticalEvalCache.clear();
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

  function bestOpponentImmediateResponseGain(game, stateAfterStonefishReply, color) {
    const cacheKey = `oppResponse|${stateKey(stateAfterStonefishReply, color)}`;
    if (tacticalEvalCache.has(cacheKey)) return tacticalEvalCache.get(cacheKey);

    const enemy = game.opponent(color);

    // This is the one extra move beyond Flash: after Stonefish's immediate
    // punish, v4.5 checks whether the opponent can instantly refute it.
    if (sideHasMateInOne(game, stateAfterStonefishReply, enemy)) {
      tacticalEvalCache.set(cacheKey, MATE_PUNISHMENT);
      clearCacheIfLarge();
      return MATE_PUNISHMENT;
    }

    let bestGain = 0;
    for (const reply of legalMoves(game, stateAfterStonefishReply, enemy)) {
      const gain = materialCapturedByMove(game, stateAfterStonefishReply, reply, enemy);
      if (gain > bestGain) bestGain = gain;
    }

    tacticalEvalCache.set(cacheKey, bestGain);
    clearCacheIfLarge();
    return bestGain;
  }

  function bestReplyAfterOpponentCaptureWithOneExtraMove(game, stateAfterOpponentReply, color) {
    const cacheKey = `bestReply|${stateKey(stateAfterOpponentReply, color)}`;
    if (tacticalEvalCache.has(cacheKey)) return tacticalEvalCache.get(cacheKey);

    const moves = legalMoves(game, stateAfterOpponentReply, color);
    let bestEffectiveGain = 0;

    // Keep Flash's mate-punish behavior exactly: if the opponent's capture lets
    // Stonefish mate immediately, the original move was tactically justified.
    for (const move of moves) {
      if (moveCheckmates(game, stateAfterOpponentReply, move, color)) {
        tacticalEvalCache.set(cacheKey, MATE_PUNISHMENT);
        clearCacheIfLarge();
        return MATE_PUNISHMENT;
      }
    }

    for (const move of moves) {
      const immediateGain = materialCapturedByMove(game, stateAfterOpponentReply, move, color);
      if (immediateGain <= 0) continue;

      const responseState = game.cloneState(stateAfterOpponentReply);
      game.applyMoveToState(responseState, move);
      const opponentResponseGain = bestOpponentImmediateResponseGain(game, responseState, color);
      const effectiveGain = immediateGain - opponentResponseGain;

      if (effectiveGain > bestEffectiveGain) bestEffectiveGain = effectiveGain;
    }

    tacticalEvalCache.set(cacheKey, bestEffectiveGain);
    clearCacheIfLarge();
    return bestEffectiveGain;
  }

  function replyAwareDangerProfile(game, stateAfterCandidate, color) {
    const profileKey = `danger|${stateKey(stateAfterCandidate, color)}`;
    if (tacticalEvalCache.has(profileKey)) return tacticalEvalCache.get(profileKey);

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

      // v4.5 keeps Flash's core idea, but gives it exactly one extra move of
      // information. If the opponent grabs a hanging piece, Stonefish asks:
      // "Can I punish that capture, and if I do, can they immediately refute
      // my punish on their very next move?"
      const myBestReplyGain = bestReplyAfterOpponentCaptureWithOneExtraMove(game, replyState, color);
      const netLoss = opponentGain - myBestReplyGain;

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

    const profile = {
      replyAwareDanger: sawCapture ? worstReplyNetLoss : 0,
      biggestSingleLoss: biggestReplyAwareSingleLoss,
      replyAwareTotal,
      rawCapturableTotal,
      rawBiggestSingleLoss
    };

    tacticalEvalCache.set(profileKey, profile);
    clearCacheIfLarge();
    return profile;
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

  window.StonefishV45 = {
    name: "Stonefish v4.5",

    chooseMove(game, color) {
      const candidateMoves = legalMoves(game, game.state, color);
      if (!candidateMoves.length) return null;

      // v4.5 opening book layer. This happens before normal v4 thinking:
      // while the exact full move history is still a prefix of one of the
      // allowed opening lines, Stonefish chooses randomly from legal moves
      // that continue those lines. As soon as either side deviates, the book
      // returns no moves and the engine falls back to normal v4 logic.
      const openingBook = window.StonefishOpenings;
      if (openingBook && typeof openingBook.getBookMoves === "function") {
        const bookLimit = color === "w" ? openingBook.FIRST_WHITE_LIMIT : openingBook.FIRST_BLACK_LIMIT;
        const bookMoves = openingBook.getBookMoves(game, color, candidateMoves, bookLimit);
        if (bookMoves.length) {
          const picked = randomItem(bookMoves);
          const bookMove = game.cloneMove(picked.move);
          bookMove._stonefishBook = true;
          bookMove._stonefishOpeningNames = picked.openings ? picked.openings.slice() : [];
          bookMove._stonefishOpeningName = bookMove._stonefishOpeningNames.length
            ? randomItem(bookMove._stonefishOpeningNames)
            : "Book move";
          return bookMove;
        }
      }

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

      // Same filter ladder as v4.5 Flash. The only difference is that the
      // danger numbers above are one opponent move better informed.
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
