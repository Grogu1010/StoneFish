(function () {
  const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const MATE_SCORE = 1000000;
  const DRAW_WHILE_LOSING = 850000;
  const MAX_CACHE_SIZE = 50000;
  const legalMoveCache = new Map();
  const evalCache = new Map();
  const tacticalCache = new Map();
  const mateCache = new Map();
  const searchCache = new Map();

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
    if (searchCache.size > MAX_CACHE_SIZE) searchCache.clear();
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

  function advancementBonus(game, piece, r) {
    const type = game.typeOf(piece);
    const color = game.colorOf(piece);
    if (type !== "P") return 0;
    return color === "w" ? (6 - r) * 6 : (r - 1) * 6;
  }

  function pieceSquareBonus(game, piece, r, c) {
    const type = game.typeOf(piece);
    let score = centralBonus(r, c);
    if (type === "P") score += advancementBonus(game, piece, r);
    if (type === "N") score += centralBonus(r, c) * 2;
    if (type === "B") score += centralBonus(r, c);
    if (type === "R") score += (r === 0 || r === 7 ? 0 : 4);
    if (type === "Q") score += Math.floor(centralBonus(r, c) / 2);
    if (type === "K") {
      const color = game.colorOf(piece);
      const home = color === "w" ? 7 : 0;
      score += (r === home && (c === 6 || c === 2)) ? 25 : 0;
      score -= (Math.abs(c - 4) <= 1 && r === home) ? 8 : 0;
    }
    return score;
  }

  function bishopPair(game, state, color) {
    let bishops = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) if (state.board[r][c] === color + "B") bishops += 1;
    }
    return bishops >= 2 ? 35 : 0;
  }

  function kingShield(game, state, color) {
    const king = game.findKing(color, state);
    if (!king) return -MATE_SCORE;
    const dir = color === "w" ? -1 : 1;
    let shield = 0;
    for (const dc of [-1, 0, 1]) {
      const r = king.r + dir;
      const c = king.c + dc;
      if (game.isOnBoard(r, c) && state.board[r][c] === color + "P") shield += 9;
    }
    return shield;
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

  function insufficientMaterial(game, state) {
    const pieces = { w: [], b: [] };
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = state.board[r][c];
        if (!piece) continue;
        const type = game.typeOf(piece);
        if (type !== "K") pieces[game.colorOf(piece)].push(type);
      }
    }
    const light = list => list.length === 0 || (list.length === 1 && ["B", "N"].includes(list[0]));
    return light(pieces.w) && light(pieces.b);
  }

  function staticEval(game, state, color) {
    const key = `static|${stateKey(state, color)}`;
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
    const ownMoves = legalMoves(game, state, color).length;
    const enemyMoves = legalMoves(game, state, enemy).length;
    score += (ownMoves - enemyMoves) * 4;
    score += bishopPair(game, state, color) - bishopPair(game, state, enemy);
    score += kingShield(game, state, color) - kingShield(game, state, enemy);

    if (game.isInCheck(enemy, state)) score += 35;
    if (game.isInCheck(color, state)) score -= 45;

    if (insufficientMaterial(game, state)) {
      score = score < -120 ? 300 : score > 120 ? -120 : 0;
    }

    evalCache.set(key, score);
    clearCachesIfLarge();
    return score;
  }

  function bestOpponentImmediateResponseGain(game, stateAfterStonefishReply, color) {
    const cacheKey = `oppRefute|${stateKey(stateAfterStonefishReply, color)}`;
    if (tacticalCache.has(cacheKey)) return tacticalCache.get(cacheKey);
    const enemy = game.opponent(color);
    if (sideMateInOneMoves(game, stateAfterStonefishReply, enemy).length) {
      tacticalCache.set(cacheKey, MATE_SCORE / 10);
      return MATE_SCORE / 10;
    }
    let bestGain = 0;
    for (const reply of legalMoves(game, stateAfterStonefishReply, enemy)) {
      const gain = materialCapturedByMove(game, stateAfterStonefishReply, reply, enemy);
      if (gain > bestGain) bestGain = gain;
    }
    tacticalCache.set(cacheKey, bestGain);
    clearCachesIfLarge();
    return bestGain;
  }

  function sameSquare(a, b) { return a && b && a.r === b.r && a.c === b.c; }

  function bestReplyAfterOpponentCaptureWithRefutation(game, stateAfterOpponentReply, color, capturerSquare) {
    const cacheKey = `punish|${capturerSquare ? capturerSquare.r + "," + capturerSquare.c : "-"}|${stateKey(stateAfterOpponentReply, color)}`;
    if (tacticalCache.has(cacheKey)) return tacticalCache.get(cacheKey);
    let bestEffectiveGain = 0;
    const moves = legalMoves(game, stateAfterOpponentReply, color);
    for (const move of moves) {
      if (moveCheckmates(game, stateAfterOpponentReply, move, color)) {
        tacticalCache.set(cacheKey, MATE_SCORE / 10);
        return MATE_SCORE / 10;
      }
      const immediateGain = materialCapturedByMove(game, stateAfterOpponentReply, move, color);
      const direct = sameSquare(capturedSquareForMove(move), capturerSquare);
      if (immediateGain <= 0 && !game.isInCheck(game.opponent(color), stateAfterOpponentReply)) continue;
      const responseState = game.cloneState(stateAfterOpponentReply);
      game.applyMoveToState(responseState, move);
      const refutation = bestOpponentImmediateResponseGain(game, responseState, color);
      const checkBonus = game.isInCheck(game.opponent(color), responseState) ? 40 : 0;
      const relatedGain = direct ? immediateGain : immediateGain * 0.35;
      const effectiveGain = relatedGain + checkBonus - refutation;
      if (effectiveGain > bestEffectiveGain) bestEffectiveGain = effectiveGain;
    }
    tacticalCache.set(cacheKey, bestEffectiveGain);
    clearCachesIfLarge();
    return bestEffectiveGain;
  }

  function replyAwareDangerProfile(game, stateAfterCandidate, color) {
    const profileKey = `danger|${stateKey(stateAfterCandidate, color)}`;
    if (tacticalCache.has(profileKey)) return tacticalCache.get(profileKey);

    const enemy = game.opponent(color);
    const opponentReplies = legalMoves(game, stateAfterCandidate, enemy);
    const capturableSquares = new Map();
    let worstReplyNetLoss = 0;
    let biggestSingleLoss = 0;
    let totalLoss = 0;
    let mateDanger = false;
    let bestOpponentCaptureGain = 0;

    for (const reply of opponentReplies) {
      if (moveCheckmates(game, stateAfterCandidate, reply, enemy)) mateDanger = true;
      const capturedSquare = capturedSquareForMove(reply);
      const capturedPiece = stateAfterCandidate.board[capturedSquare.r][capturedSquare.c];
      if (!capturedPiece || game.colorOf(capturedPiece) !== color || game.typeOf(capturedPiece) === "K") continue;

      const opponentGain = VALUES[game.typeOf(capturedPiece)] || 0;
      bestOpponentCaptureGain = Math.max(bestOpponentCaptureGain, opponentGain);
      const replyState = game.cloneState(stateAfterCandidate);
      game.applyMoveToState(replyState, reply);
      const myBestReplyGain = bestReplyAfterOpponentCaptureWithRefutation(game, replyState, color, reply.to);
      const netLoss = opponentGain - myBestReplyGain;
      const key = `${capturedSquare.r},${capturedSquare.c}`;
      const previous = capturableSquares.get(key);
      if (!previous || netLoss > previous.netLoss) capturableSquares.set(key, { value: opponentGain, netLoss });
      if (netLoss > worstReplyNetLoss) worstReplyNetLoss = netLoss;
      biggestSingleLoss = Math.max(biggestSingleLoss, Math.max(0, netLoss));
    }

    for (const danger of capturableSquares.values()) totalLoss += Math.max(0, danger.netLoss);
    const profile = { worstReplyNetLoss, biggestSingleLoss, totalLoss, mateDanger, bestOpponentCaptureGain };
    tacticalCache.set(profileKey, profile);
    clearCachesIfLarge();
    return profile;
  }

  function createsUsefulMateThreat(game, stateAfterCandidate, color) {
    const threats = sideMateInOneMoves(game, stateAfterCandidate, color).length;
    return Math.min(2, threats);
  }

  function repetitionResource(game, move, color, materialScore, testState) {
    if (materialScore >= -180) return 0;
    let score = 0;
    const history = game.moveHistory || [];
    const key = moveKey(move);
    const recentKeys = history.slice(-8).map(entry => `${entry.from}${entry.to}`);
    const reverse = `${"abcdefgh"[move.to.c]}${8 - move.to.r}${"abcdefgh"[move.from.c]}${8 - move.from.r}`;
    if (recentKeys.includes(key) || recentKeys.includes(reverse)) score += 45;
    if (game.isInCheck(game.opponent(color), testState)) score += 35;
    const enemyMoves = legalMoves(game, testState, game.opponent(color)).length;
    if (enemyMoves <= 3) score += 30;
    return score;
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

  function candidateBaseScore(game, state, move, color, bookMap) {
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    const enemy = game.opponent(color);
    const matBefore = materialOnly(game, state, color);
    const staticScore = staticEval(game, testState, color);
    const danger = replyAwareDangerProfile(game, testState, color);
    const captured = materialCapturedByMove(game, state, move, color);
    const moved = movedPieceValue(game, state, move);
    const book = bookMap.get(moveKey(move));
    const enemyMoves = legalMoves(game, testState, enemy).length;
    const givesCheck = game.isInCheck(enemy, testState);
    let score = staticScore;
    score += captured * 0.34;
    score += givesCheck ? 38 : 0;
    score += (28 - enemyMoves) * 3;
    score += book ? book.score : 0;
    score -= Math.max(0, danger.worstReplyNetLoss) * 1.75;
    score -= danger.biggestSingleLoss * 0.9;
    score -= danger.totalLoss * 0.55;
    if (danger.mateDanger) score -= MATE_SCORE / 3;
    if (move.promotion) score += 600;
    if (move.castle) score += 55;
    if (captured && moved <= captured + 120) score += 25;
    score += repetitionResource(game, move, color, matBefore, testState);

    const terminal = terminalScore(game, testState, color);
    if (terminal !== null) score += terminal;

    return { move, testState, score, book, givesCheck, danger, staticScore };
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

  window.StonefishV5 = {
    name: "Stonefish v5",

    chooseMove(game, color) {
      const state = game.state;
      const legal = legalMoves(game, state, color);
      if (!legal.length) return null;
      const bookMap = bookScores(game, color, legal);

      const candidates = legal.map(move => candidateBaseScore(game, state, move, color, bookMap));
      for (const candidate of candidates) {
        if (moveCheckmates(game, state, candidate.move, color)) candidate.score += MATE_SCORE;
      }

      candidates.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));

      for (const candidate of candidates) {
        if (candidate.book && !candidate.danger.mateDanger && candidate.danger.worstReplyNetLoss <= 120) candidate.score += 35;
      }

      candidates.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
      return decorateBookMove(game, candidates[0]);
    },

    _stonefishDepthProfile: "full scored-candidate architecture with reply-aware tactical scoring at the center"
  };
})();
