(function () {
  const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const MATE_SCORE = 1000000;
  const DRAW_WHILE_LOSING = 750000;
  const MAX_CACHE_SIZE = 35000;
  const legalMoveCache = new Map();
  const evalCache = new Map();
  const tacticalCache = new Map();
  const mateCache = new Map();

  function stateKey(state, color) {
    const board = state.board.map(row => row.map(piece => piece || "..").join("")).join("/");
    const castling = `${state.castling.w.K ? "K" : ""}${state.castling.w.Q ? "Q" : ""}${state.castling.b.K ? "k" : ""}${state.castling.b.Q ? "q" : ""}`;
    const ep = state.enPassant ? `${state.enPassant.r},${state.enPassant.c}` : "-";
    return `${color}|${state.turn}|${board}|${castling}|${ep}`;
  }

  function clearCachesIfLarge() {
    if (legalMoveCache.size > MAX_CACHE_SIZE) legalMoveCache.clear();
    if (evalCache.size > MAX_CACHE_SIZE) evalCache.clear();
    if (tacticalCache.size > MAX_CACHE_SIZE) tacticalCache.clear();
    if (mateCache.size > MAX_CACHE_SIZE) mateCache.clear();
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
    clearCachesIfLarge();
    return moves;
  }

  function moveKey(move) {
    return `${"abcdefgh"[move.from.c]}${8 - move.from.r}${"abcdefgh"[move.to.c]}${8 - move.to.r}`;
  }

  function capturedSquareForMove(move) {
    return move.enPassant ? { r: move.from.r, c: move.to.c } : move.to;
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

  function movedPieceValue(game, state, move) {
    const piece = state.board[move.from.r][move.from.c];
    return piece ? (VALUES[game.typeOf(piece)] || 0) : 0;
  }

  function moveCheckmates(game, state, move, moverColor) {
    const key = `mate|${stateKey(state, moverColor)}|${moveKey(move)}`;
    if (mateCache.has(key)) return mateCache.get(key);
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    const enemy = game.opponent(moverColor);
    const result = game.isInCheck(enemy, testState) && legalMoves(game, testState, enemy).length === 0;
    mateCache.set(key, result);
    clearCachesIfLarge();
    return result;
  }

  function sideMateInOneMoves(game, state, color) {
    return legalMoves(game, state, color).filter(move => moveCheckmates(game, state, move, color));
  }

  function opponentHasMateInOne(game, state, defenderColor) {
    return sideMateInOneMoves(game, state, game.opponent(defenderColor)).length > 0;
  }

  function materialOnly(game, state, color) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = state.board[r][c];
        if (!piece) continue;
        const value = VALUES[game.typeOf(piece)] || 0;
        score += game.colorOf(piece) === color ? value : -value;
      }
    }
    return score;
  }

  function centralBonus(r, c) {
    const centerDistance = Math.abs(r - 3.5) + Math.abs(c - 3.5);
    return Math.round((7 - centerDistance) * 3);
  }

  function pieceSquareBonus(game, piece, r, c) {
    const type = game.typeOf(piece);
    const color = game.colorOf(piece);
    let score = centralBonus(r, c);
    if (type === "P") score += (color === "w" ? (6 - r) : (r - 1)) * 5;
    if (type === "N") score += centralBonus(r, c) * 2;
    if (type === "B") score += centralBonus(r, c);
    if (type === "K") {
      const home = color === "w" ? 7 : 0;
      score += (r === home && (c === 6 || c === 2)) ? 22 : 0;
      score -= (r === home && Math.abs(c - 4) <= 1) ? 6 : 0;
    }
    return score;
  }

  function terminalScore(game, state, color) {
    const side = state.turn;
    const moves = legalMoves(game, state, side);
    if (moves.length) return null;
    if (game.isInCheck(side, state)) return side === color ? -MATE_SCORE : MATE_SCORE;
    const mat = materialOnly(game, state, color);
    if (mat < -150) return DRAW_WHILE_LOSING;
    if (mat > 150) return -DRAW_WHILE_LOSING / 2;
    return 0;
  }

  function staticEval(game, state, color) {
    const key = `flashStatic|${stateKey(state, color)}`;
    if (evalCache.has(key)) return evalCache.get(key);
    const terminal = terminalScore(game, state, color);
    if (terminal !== null) return terminal;

    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = state.board[r][c];
        if (!piece) continue;
        const sign = game.colorOf(piece) === color ? 1 : -1;
        score += sign * ((VALUES[game.typeOf(piece)] || 0) + pieceSquareBonus(game, piece, r, c));
      }
    }
    const enemy = game.opponent(color);
    score += (legalMoves(game, state, color).length - legalMoves(game, state, enemy).length) * 3;
    if (game.isInCheck(enemy, state)) score += 30;
    if (game.isInCheck(color, state)) score -= 40;

    evalCache.set(key, score);
    clearCachesIfLarge();
    return score;
  }

  function sameSquare(a, b) { return a && b && a.r === b.r && a.c === b.c; }

  function quickBestImmediateReplyAfterCapture(game, stateAfterOpponentReply, color, capturerSquare) {
    const key = `quickReply|${capturerSquare ? capturerSquare.r + "," + capturerSquare.c : "-"}|${stateKey(stateAfterOpponentReply, color)}`;
    if (tacticalCache.has(key)) return tacticalCache.get(key);
    let best = 0;
    for (const move of legalMoves(game, stateAfterOpponentReply, color)) {
      if (moveCheckmates(game, stateAfterOpponentReply, move, color)) {
        tacticalCache.set(key, MATE_SCORE / 10);
        return MATE_SCORE / 10;
      }
      const gain = materialCapturedByMove(game, stateAfterOpponentReply, move, color);
      if (gain <= 0) continue;
      const direct = sameSquare(capturedSquareForMove(move), capturerSquare);
      const effective = direct ? gain : gain * 0.35;
      best = Math.max(best, effective);
    }
    tacticalCache.set(key, best);
    clearCachesIfLarge();
    return best;
  }

  function quickDangerProfile(game, stateAfterCandidate, color, selective) {
    const key = `quickDanger|${selective ? "s" : "a"}|${stateKey(stateAfterCandidate, color)}`;
    if (tacticalCache.has(key)) return tacticalCache.get(key);

    const enemy = game.opponent(color);
    const replies = legalMoves(game, stateAfterCandidate, enemy);
    let worstNetLoss = 0;
    let totalLoss = 0;
    let mateDanger = sideMateInOneMoves(game, stateAfterCandidate, enemy).length > 0;
    let inspected = 0;
    const ordered = replies.slice().sort((a, b) => materialCapturedByMove(game, stateAfterCandidate, b, enemy) - materialCapturedByMove(game, stateAfterCandidate, a, enemy));

    for (const reply of ordered) {
      const captureGain = materialCapturedByMove(game, stateAfterCandidate, reply, enemy);
      if (selective && inspected >= 8 && captureGain < 300) break;
      if (moveCheckmates(game, stateAfterCandidate, reply, enemy)) mateDanger = true;
      if (captureGain <= 0) {
        inspected += 1;
        continue;
      }
      const replyState = game.cloneState(stateAfterCandidate);
      game.applyMoveToState(replyState, reply);
      const myReply = quickBestImmediateReplyAfterCapture(game, replyState, color, reply.to);
      const netLoss = captureGain - myReply;
      worstNetLoss = Math.max(worstNetLoss, netLoss);
      totalLoss += Math.max(0, netLoss);
      inspected += 1;
    }

    const profile = { worstNetLoss, totalLoss, mateDanger };
    tacticalCache.set(key, profile);
    clearCachesIfLarge();
    return profile;
  }

  function allOpeningLines(openingBook) {
    const rows = [];
    const allowed = opening => !openingBook.isOpeningAllowed || openingBook.isOpeningAllowed(opening, "w", 5) || openingBook.isOpeningAllowed(opening, "b", 5);
    const add = opening => {
      if (!allowed(opening)) return;
      const lines = Array.isArray(opening.lines) ? opening.lines : (Array.isArray(opening.moves) ? [opening.moves] : []);
      for (const line of lines) rows.push({ name: opening.name, line });
    };
    for (const opening of openingBook.WHITE_OPENINGS || []) add(opening);
    for (const opening of openingBook.BLACK_OPENINGS || []) add(opening);
    return rows;
  }

  function bookScores(game, color, legal) {
    const result = new Map();
    const openingBook = window.StonefishOpenings;
    if (!openingBook) return result;
    const played = openingBook.historyKeys ? openingBook.historyKeys(game) : (game.moveHistory || []).map(entry => `${entry.from}${entry.to}`);
    const legalByKey = new Map(legal.map(move => [moveKey(move), move]));
    for (const entry of allOpeningLines(openingBook)) {
      const line = entry.line;
      if (!line || played.length >= line.length) continue;
      let ok = true;
      for (let i = 0; i < played.length; i++) {
        if (played[i] !== line[i]) { ok = false; break; }
      }
      if (!ok) continue;
      const nextKey = line[played.length];
      if (!legalByKey.has(nextKey)) continue;
      const remaining = line.length - played.length;
      const current = result.get(nextKey) || { openings: [], lineLength: line.length, score: 0 };
      if (!current.openings.includes(entry.name)) current.openings.push(entry.name);
      current.lineLength = Math.max(current.lineLength, line.length);
      current.score = Math.max(current.score, 110 + Math.min(95, remaining * 11));
      result.set(nextKey, current);
    }
    return result;
  }

  function repetitionResource(game, move, color, materialScore, testState) {
    if (materialScore >= -180) return 0;
    const history = game.moveHistory || [];
    const key = moveKey(move);
    const reverse = `${"abcdefgh"[move.to.c]}${8 - move.to.r}${"abcdefgh"[move.from.c]}${8 - move.from.r}`;
    const recent = history.slice(-8).map(entry => `${entry.from}${entry.to}`);
    let score = 0;
    if (recent.includes(key) || recent.includes(reverse)) score += 35;
    if (game.isInCheck(game.opponent(color), testState)) score += 25;
    if (legalMoves(game, testState, game.opponent(color)).length <= 3) score += 30;
    return score;
  }

  function cheapMoveScore(game, state, move, color, bookMap) {
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    const enemy = game.opponent(color);
    const book = bookMap.get(moveKey(move));
    const captured = materialCapturedByMove(game, state, move, color);
    const moved = movedPieceValue(game, state, move);
    const staticScore = staticEval(game, testState, color);
    const givesCheck = game.isInCheck(enemy, testState);
    const enemyMoves = legalMoves(game, testState, enemy).length;
    const materialBefore = materialOnly(game, state, color);

    let score = staticScore;
    score += captured * 0.42 - moved * 0.03;
    score += givesCheck ? 34 : 0;
    score += (26 - enemyMoves) * 2;
    score += move.castle ? 48 : 0;
    score += move.promotion ? 650 : 0;
    score += book ? book.score : 0;
    score += repetitionResource(game, move, color, materialBefore, testState);

    return { move, testState, score, book, captured, moved, givesCheck };
  }

  function decorateBookMove(game, chosen) {
    const move = game.cloneMove(chosen.move);
    if (chosen.book) {
      move._stonefishBook = true;
      move._stonefishOpeningNames = chosen.book.openings.slice();
      move._stonefishOpeningName = move._stonefishOpeningNames[0] || "Book move";
    }
    return move;
  }

  window.StonefishV5Flash = {
    name: "Stonefish v5 Flash",

    chooseMove(game, color) {
      const state = game.state;
      const legal = legalMoves(game, state, color);
      if (!legal.length) return null;
      const bookMap = bookScores(game, color, legal);

      const mateMoves = legal.filter(move => moveCheckmates(game, state, move, color));
      if (mateMoves.length) {
        mateMoves.sort((a, b) => moveKey(a).localeCompare(moveKey(b)));
        return game.cloneMove(mateMoves[0]);
      }

      let candidates = legal.map(move => cheapMoveScore(game, state, move, color, bookMap));
      candidates.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));

      const bestBook = candidates.find(candidate => candidate.book);
      if (bestBook) {
        const danger = quickDangerProfile(game, bestBook.testState, color, true);
        const mateUnsafe = danger.mateDanger;
        if (!mateUnsafe && danger.worstNetLoss <= 120 && bestBook.score >= candidates[0].score - 85) {
          bestBook.score += 30;
          return decorateBookMove(game, bestBook);
        }
      }

      for (const candidate of candidates) {
        const danger = quickDangerProfile(game, candidate.testState, color, true);
        candidate.danger = danger;
        candidate.score -= Math.max(0, danger.worstNetLoss) * 4.25;
        candidate.score -= danger.totalLoss * 1.15;
        if (danger.worstNetLoss >= 300) candidate.score -= 520;
        if (danger.mateDanger) candidate.score -= MATE_SCORE / 2;
        const terminal = terminalScore(game, candidate.testState, color);
        if (terminal !== null) candidate.score += terminal;
      }

      candidates.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
      return decorateBookMove(game, candidates[0]);
    },

    _stonefishDepthProfile: "fast candidate scoring with selective one-reply danger checks and book-aware early exits"
  };
})();
