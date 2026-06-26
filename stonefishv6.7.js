(function () {
  const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const MATE_SCORE = 1000000;
  const DRAW_WHILE_LOSING = 850000;
  const MAX_CACHE_SIZE = 120000;
  const FLASH_REPLY_WIDTH = 5;
  const FLASH_DEFENSE_WIDTH = 1;
  const FLASH_PLAN_WIDTH = 1;
  const VERIFY_WIDTH = 1;
  const searchCache = new Map();
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

  function resetStonefishCaches() {
    if (typeof searchCache !== "undefined") searchCache.clear();
    legalMoveCache.clear();
    evalCache.clear();
    tacticalCache.clear();
    mateCache.clear();
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

  function verificationLeafEval(game, state, color) {
    const key = `verifyLeaf|${stateKey(state, color)}`;
    if (evalCache.has(key)) return evalCache.get(key);
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
    if (game.isInCheck(enemy, state)) score += 24;
    if (game.isInCheck(color, state)) score -= 32;
    evalCache.set(key, score);
    clearCachesIfLarge();
    return score;
  }

  function sameSquare(a, b) { return a && b && a.r === b.r && a.c === b.c; }

  function orderedFlashMoves(game, state, color) {
    const moves = legalMoves(game, state, color).map(move => {
      let score = materialCapturedByMove(game, state, move, color) * 10;
      if (move.promotion) score += 6500;
      if (move.castle) score += 100;
      score -= movedPieceValue(game, state, move) * 0.04;
      return { move, score };
    });
    moves.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
    return moves.map(entry => entry.move);
  }

  function tacticalMovePotential(game, state, move, moverColor, povColor) {
    const captured = materialCapturedByMove(game, state, move, moverColor);
    const moved = movedPieceValue(game, state, move);
    const nextState = game.cloneState(state);
    game.applyMoveToState(nextState, move);
    const enemy = game.opponent(moverColor);
    let score = captured;
    if (move.promotion) score += 600;
    if (game.isInCheck(enemy, nextState)) score += 45;
    if (move.castle) score += 12;
    if (captured && moved <= captured + 140) score += 15;
    return Math.max(0, score);
  }

  function quickBestImmediateReplyAfterCapture(game, stateAfterOpponentReply, color, capturerSquare) {
    const key = `quickReply|${capturerSquare ? capturerSquare.r + "," + capturerSquare.c : "-"}|${stateKey(stateAfterOpponentReply, color)}`;
    if (tacticalCache.has(key)) return tacticalCache.get(key);
    let best = 0;
    for (const move of orderedFlashMoves(game, stateAfterOpponentReply, color).slice(0, FLASH_DEFENSE_WIDTH)) {
      if (moveCheckmates(game, stateAfterOpponentReply, move, color)) {
        tacticalCache.set(key, MATE_SCORE / 10);
        return MATE_SCORE / 10;
      }
      const gain = materialCapturedByMove(game, stateAfterOpponentReply, move, color);
      const direct = sameSquare(capturedSquareForMove(move), capturerSquare);
      const replyState = game.cloneState(stateAfterOpponentReply);
      game.applyMoveToState(replyState, move);
      const givesCheck = game.isInCheck(game.opponent(color), replyState);
      if (gain <= 0 && !givesCheck && !move.promotion) continue;
      const refutation = bestOpponentImmediateResponseGain(game, replyState, color);
      const related = direct ? gain : gain * 0.35;
      const effective = related + (givesCheck ? 32 : 0) + (move.promotion ? 560 : 0) - refutation;
      best = Math.max(best, effective);
    }
    tacticalCache.set(key, best);
    clearCachesIfLarge();
    return best;
  }



  function stateWithTurn(game, state, turn) {
    const copy = game.cloneState(state);
    copy.turn = turn;
    return copy;
  }

  function quickFutureCapturePressure(game, state, attackerColor, width) {
    const probeState = stateWithTurn(game, state, attackerColor);
    let best = 0;
    let total = 0;
    for (const move of orderedFlashMoves(game, probeState, attackerColor).slice(0, Math.min(2, width))) {
      const gain = materialCapturedByMove(game, probeState, move, attackerColor);
      if (gain <= 0) continue;
      best = Math.max(best, gain);
      total += Math.min(300, gain);
    }
    return { best, total };
  }

  function quickDefensePreparedness(game, stateAfterOpponentPlan, color, threatenedMates, severity) {
    const defendState = stateWithTurn(game, stateAfterOpponentPlan, color);
    const defenses = orderedFlashMoves(game, defendState, color).slice(0, FLASH_DEFENSE_WIDTH);
    if (!defenses.length) return 0;
    const baseline = staticEval(game, defendState, color);
    let best = 0;
    for (const defense of defenses) {
      if (moveCheckmates(game, defendState, defense, color)) return MATE_SCORE / 9;
      const next = game.cloneState(defendState);
      game.applyMoveToState(next, defense);
      let prepared = 0;
      if (threatenedMates && !opponentHasMateInOne(game, next, color)) prepared += 300 + threatenedMates * 55;
      prepared += materialCapturedByMove(game, defendState, defense, color) * 0.55;
      prepared += Math.max(-180, Math.min(180, staticEval(game, next, color) - baseline)) * 0.28;
      if (game.isInCheck(game.opponent(color), next)) prepared += 35;
      if (prepared > best) best = prepared;
      if (best >= severity * 0.85) break;
    }
    return best;
  }

  function quickOpponentPlanProfile(game, state, color) {
    const enemy = game.opponent(color);
    const planState = stateWithTurn(game, state, enemy);
    const key = `flashPlan|${stateKey(planState, color)}`;
    if (tacticalCache.has(key)) return tacticalCache.get(key);

    let worstNetPlan = 0;
    let totalNetPlan = 0;
    let forcingPlans = 0;
    let matePlan = false;
    let bestPreparedness = 0;
    let bestRawPlan = 0;

    for (const reply of orderedFlashMoves(game, planState, enemy).slice(0, FLASH_PLAN_WIDTH)) {
      const replyState = game.cloneState(planState);
      game.applyMoveToState(replyState, reply);
      let severity = tacticalMovePotential(game, planState, reply, enemy, color) * 0.95;
      if (moveCheckmates(game, planState, reply, enemy)) {
        matePlan = true;
        severity += MATE_SCORE / 8;
      }
      if (game.isInCheck(color, replyState)) severity += 190;
      const threatenedMates = sideMateInOneMoves(game, replyState, enemy).length;
      if (threatenedMates) {
        matePlan = true;
        severity += 390 + Math.min(2, threatenedMates) * 95;
      }
      const future = quickFutureCapturePressure(game, replyState, enemy, 3);
      severity += future.best * 0.36 + future.total * 0.08;
      if (severity >= 170) forcingPlans += 1;
      const prepared = quickDefensePreparedness(game, replyState, color, threatenedMates, severity);
      const net = Math.max(0, severity - prepared);
      bestRawPlan = Math.max(bestRawPlan, severity);
      bestPreparedness = Math.max(bestPreparedness, prepared);
      worstNetPlan = Math.max(worstNetPlan, net);
      totalNetPlan += Math.min(600, net);
    }

    const profile = { worstNetPlan, totalNetPlan, forcingPlans, matePlan, bestRawPlan, bestPreparedness };
    tacticalCache.set(key, profile);
    clearCachesIfLarge();
    return profile;
  }


  function verificationSearch(game, state, color, depth) {
    const key = `v6Verify|${depth}|${stateKey(state, color)}`;
    if (searchCache.has(key)) return searchCache.get(key);
    const terminal = terminalScore(game, state, color);
    if (terminal !== null) {
      searchCache.set(key, terminal);
      return terminal;
    }
    const side = state.turn;
    const mates = sideMateInOneMoves(game, state, side);
    if (mates.length) {
      const value = side === color ? MATE_SCORE - depth : -MATE_SCORE + depth;
      searchCache.set(key, value);
      return value;
    }
    if (depth <= 0) {
      const value = verificationLeafEval(game, state, color);
      searchCache.set(key, value);
      return value;
    }
    const moves = orderedFlashMoves(game, state, side).slice(0, VERIFY_WIDTH);
    if (!moves.length) {
      const value = staticEval(game, state, color);
      searchCache.set(key, value);
      return value;
    }
    let best = side === color ? -Infinity : Infinity;
    for (const move of moves) {
      const next = game.cloneState(state);
      game.applyMoveToState(next, move);
      const value = verificationSearch(game, next, color, depth - 1);
      if (side === color) best = Math.max(best, value);
      else best = Math.min(best, value);
    }
    searchCache.set(key, best);
    clearCachesIfLarge();
    return best;
  }

  function terminalVerification(game, stateAfterCandidate, color) {
    return verificationSearch(game, stateAfterCandidate, color, 2);
  }


  function bestOpponentImmediateResponseGain(game, stateAfterStonefishReply, color) {
    const cacheKey = `flashOppRefute|${stateKey(stateAfterStonefishReply, color)}`;
    if (tacticalCache.has(cacheKey)) return tacticalCache.get(cacheKey);
    const enemy = game.opponent(color);
    if (sideMateInOneMoves(game, stateAfterStonefishReply, enemy).length) {
      tacticalCache.set(cacheKey, MATE_SCORE / 10);
      return MATE_SCORE / 10;
    }
    let bestGain = 0;
    for (const reply of orderedFlashMoves(game, stateAfterStonefishReply, enemy).slice(0, FLASH_REPLY_WIDTH)) {
      const gain = materialCapturedByMove(game, stateAfterStonefishReply, reply, enemy);
      const next = game.cloneState(stateAfterStonefishReply);
      game.applyMoveToState(next, reply);
      const checkBonus = game.isInCheck(color, next) ? 35 : 0;
      const promoBonus = reply.promotion ? 520 : 0;
      if (gain + checkBonus + promoBonus > bestGain) bestGain = gain + checkBonus + promoBonus;
    }
    tacticalCache.set(cacheKey, bestGain);
    clearCachesIfLarge();
    return bestGain;
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
    const ordered = replies.slice().sort((a, b) => {
      const am = materialCapturedByMove(game, stateAfterCandidate, a, enemy) + (a.promotion ? 520 : 0);
      const bm = materialCapturedByMove(game, stateAfterCandidate, b, enemy) + (b.promotion ? 520 : 0);
      return bm - am || moveKey(a).localeCompare(moveKey(b));
    });

    for (const reply of ordered) {
      const captureGain = materialCapturedByMove(game, stateAfterCandidate, reply, enemy);
      if (inspected >= (selective ? 8 : FLASH_REPLY_WIDTH) && captureGain < 300) break;
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

  function allOpeningLines(openingBook, color) {
    const rows = [];
    const add = (opening, sideWeight, bookSide) => {
      if (openingBook.isOpeningAllowed && !openingBook.isOpeningAllowed(opening, bookSide, 6.5)) return;
      const lines = Array.isArray(opening.lines) ? opening.lines : (Array.isArray(opening.moves) ? [opening.moves] : []);
      for (const line of lines) rows.push({ name: opening.name, line, sideWeight });
    };
    const primary = color === "w" ? (openingBook.WHITE_OPENINGS || []) : (openingBook.BLACK_OPENINGS || []);
    const secondary = color === "w" ? (openingBook.BLACK_OPENINGS || []) : (openingBook.WHITE_OPENINGS || []);
    const primarySide = color === "w" ? "w" : "b";
    const secondarySide = color === "w" ? "b" : "w";
    for (const opening of primary) add(opening, 1.0, primarySide);
    for (const opening of secondary) add(opening, 0.38, secondarySide);
    return rows;
  }

  function bookScores(game, color, legal) {
    const result = new Map();
    const openingBook = window.StonefishOpenings;
    if (!openingBook) return result;
    const played = openingBook.historyKeys ? openingBook.historyKeys(game) : (game.moveHistory || []).map(entry => `${entry.from}${entry.to}`);
    const legalByKey = new Map(legal.map(move => [moveKey(move), move]));
    for (const entry of allOpeningLines(openingBook, color)) {
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
      const riskyBook = /Gambit|Scholar|Danish|Blackmar|Stafford/i.test(entry.name) && !/Halloween/i.test(entry.name);
      const planBook = /Réti|Reti|King's Indian Attack/i.test(entry.name);
      const bookFamilyWeight = riskyBook ? 0.24 : (planBook ? 1.42 : 0.92);
      const sideAdjusted = Math.round((110 + Math.min(95, remaining * 11)) * entry.sideWeight * bookFamilyWeight);
      current.score = Math.max(current.score, sideAdjusted);
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


  function antiRepetitionPenalty(game, move, color, materialScore) {
    if (materialScore < -140) return 0;
    const history = game.moveHistory || [];
    const key = moveKey(move);
    const reverse = `${"abcdefgh"[move.to.c]}${8 - move.to.r}${"abcdefgh"[move.from.c]}${8 - move.from.r}`;
    const recent = history.slice(-10).map(entry => `${entry.from}${entry.to}`);
    const winning = materialScore > 80;
    let penalty = 0;
    if (recent.includes(key)) penalty += winning ? 12000 : 320;
    if (recent.includes(reverse)) penalty += winning ? 10000 : 300;
    const lastOwn = history.slice().reverse().find(entry => entry.color === color);
    if (lastOwn && `${lastOwn.to}${lastOwn.from}` === key) penalty += winning ? 9000 : 260;
    return penalty;
  }

  function isQuietDevelopingMove(game, state, move, color) {
    const piece = state.board[move.from.r][move.from.c];
    if (!piece) return false;
    const type = game.typeOf(piece);
    if (materialCapturedByMove(game, state, move, color) > 0 || move.promotion) return false;
    if (type === "N" || type === "B") {
      const home = color === "w" ? 7 : 0;
      return move.from.r === home && Math.abs(move.to.c - 3.5) <= 2.5;
    }
    if (type === "P") return Math.abs(move.to.c - 3.5) <= 1.5;
    return move.castle;
  }

  function kingSafetyDelta(game, before, after, color) {
    const enemy = game.opponent(color);
    let score = 0;
    if (game.isInCheck(color, before) && !game.isInCheck(color, after)) score += 180;
    if (!game.isInCheck(color, before) && game.isInCheck(color, after)) score -= 360;
    if (game.isInCheck(enemy, after)) score += 50;
    return score;
  }

  function finalCandidateLimit(game, state, candidates, color) {
    const historyLen = (game.moveHistory || []).length;
    if (historyLen < 10) return Math.min(candidates.length, 5);
    if (game.isInCheck(color, state)) return Math.min(candidates.length, 12);
    const top = candidates[0] ? candidates[0].score : 0;
    let limit = 0;
    for (const c of candidates) {
      if (limit < 6 || c.book || c.givesCheck || c.captured >= 300 || c.move.promotion || c.score >= top - 330) limit++;
    }
    return Math.max(6, Math.min(limit, 12, candidates.length));
  }

  function trustedV65BookContinuation(game, state, color, legal, bookMap) {
    if (!bookMap.size) return null;
    const bookMoves = legal
      .filter(move => {
        const book = bookMap.get(moveKey(move));
        return book && book.openings && book.openings.some(name => /v6\.5/i.test(name));
      })
      .map(move => preScoreMove(game, state, move, color, bookMap))
      .sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
    for (const candidate of bookMoves.slice(0, 3)) {
      if (moveCheckmates(game, state, candidate.move, color)) return candidate;
      if (opponentHasMateInOne(game, candidate.testState, color)) continue;
      const danger = quickDangerProfile(game, candidate.testState, color, true);
      if (danger.mateDanger || danger.worstNetLoss > 420) continue;
      candidate.score += 360;
      return candidate;
    }
    return null;
  }


  function fastOpeningChoice(game, state, color, legal, bookMap, currentPlan) {
    if ((game.moveHistory || []).length >= 10 || !bookMap.size) return null;
    const bookCandidates = legal
      .filter(move => bookMap.has(moveKey(move)))
      .map(move => preScoreMove(game, state, move, color, bookMap))
      .sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
    for (const candidate of bookCandidates.slice(0, 4)) {
      const verified = terminalVerification(game, candidate.testState, color);
      if (verified <= -MATE_SCORE / 2) continue;
      const danger = quickDangerProfile(game, candidate.testState, color, true);
      if (danger.mateDanger || danger.worstNetLoss > 170) continue;
      const plan = quickOpponentPlanProfile(game, candidate.testState, color);
      if (plan.matePlan && plan.worstNetPlan > 190) continue;
      candidate.score += Math.max(0, verified - candidate.staticScore) * 0.22;
      candidate.score += 220 + Math.max(0, currentPlan.worstNetPlan - plan.worstNetPlan) * 0.58;
      return candidate;
    }
    return null;
  }

  function preScoreMove(game, state, move, color, bookMap) {
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    const enemy = game.opponent(color);
    const book = bookMap.get(moveKey(move));
    const captured = materialCapturedByMove(game, state, move, color);
    const moved = movedPieceValue(game, state, move);
    const movingPiece = state.board[move.from.r][move.from.c];
    const staticScore = staticEval(game, testState, color);
    const givesCheck = game.isInCheck(enemy, testState);
    const enemyMoves = legalMoves(game, testState, enemy).length;
    const materialBefore = materialOnly(game, state, color);

    let score = staticScore;
    score += captured * 0.45 - moved * 0.025;
    score += givesCheck ? 42 : 0;
    score += (26 - enemyMoves) * 2.2;
    score += move.castle ? 62 : 0;
    score += move.promotion ? 720 : 0;
    score += book ? book.score * 1.08 : 0;
    score += kingSafetyDelta(game, state, testState, color);
    if (isQuietDevelopingMove(game, state, move, color)) score += 34;
    if (book && movingPiece && game.typeOf(movingPiece) === "Q" && book.openings && book.openings.some(name => /Scholar/i.test(name))) score -= 1400;
    if (movingPiece && game.typeOf(movingPiece) === "Q" && (game.moveHistory || []).length < 12 && captured < 300 && !givesCheck) score -= 760;
    if (movingPiece && game.typeOf(movingPiece) === "K" && !move.castle && !game.isInCheck(color, state) && materialBefore > 80) score -= 520;
    score += repetitionResource(game, move, color, materialBefore, testState);
    score -= antiRepetitionPenalty(game, move, color, materialBefore);
    return { move, testState, score, staticScore, book, captured, moved, givesCheck };
  }


  function cheapMoveScore(game, state, move, color, bookMap) {
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    const enemy = game.opponent(color);
    const book = bookMap.get(moveKey(move));
    const captured = materialCapturedByMove(game, state, move, color);
    const moved = movedPieceValue(game, state, move);
    const movingPiece = state.board[move.from.r][move.from.c];
    const staticScore = staticEval(game, testState, color);
    const verifiedScore = terminalVerification(game, testState, color);
    const givesCheck = game.isInCheck(enemy, testState);
    const enemyMoves = legalMoves(game, testState, enemy).length;
    const materialBefore = materialOnly(game, state, color);

    let score = staticScore;
    const verificationDelta = verifiedScore - staticScore;
    if (verifiedScore <= -MATE_SCORE / 2) score -= MATE_SCORE / 3;
    else if (verifiedScore >= MATE_SCORE / 2) score += MATE_SCORE / 3;
    else score += Math.max(0, verificationDelta) * 0.16;
    score += captured * 0.42 - moved * 0.03;
    score += givesCheck ? 34 : 0;
    score += (26 - enemyMoves) * 2;
    score += move.castle ? 48 : 0;
    score += move.promotion ? 650 : 0;
    score += book ? book.score : 0;
    if ((game.moveHistory || []).length === 0 && color === "w" && moveKey(move) === "g1f3") score += 0;
    if (book && movingPiece && game.typeOf(movingPiece) === "Q" && book.openings && book.openings.some(name => /Scholar/i.test(name))) score -= 1200;
    if (movingPiece && game.typeOf(movingPiece) === "Q" && (game.moveHistory || []).length < 12 && captured < 300 && !moveCheckmates(game, state, move, color)) score = Math.min(score, -MATE_SCORE / 2);
    if (movingPiece && game.typeOf(movingPiece) === "Q" && (game.moveHistory || []).length < 12 && captured < 300 && !givesCheck) score -= 520;
    if (movingPiece && game.typeOf(movingPiece) === "Q" && (game.moveHistory || []).length < 8 && captured < 300) score -= 220;
    score += repetitionResource(game, move, color, materialBefore, testState);
    score -= antiRepetitionPenalty(game, move, color, materialBefore);
    if (materialBefore > 80 && movingPiece && game.typeOf(movingPiece) === "K" && !move.castle && !game.isInCheck(color, state)) score -= 650;
    if (materialBefore > 80 && movingPiece && game.typeOf(movingPiece) === "R" && captured <= 0 && !givesCheck) score -= 220;

    return { move, testState, score, book, captured, moved, givesCheck };
  }


  function legalMoveByKey(game, state, color, key) {
    for (const move of legalMoves(game, state, color)) {
      if (moveKey(move) === key) return game.cloneMove(move);
    }
    return null;
  }

  function fullOnlyAntiKIAStart(game, state, color) {
    const history = game.moveHistory || [];
    if (color !== "b" || history.length !== 1) return null;
    const first = `${history[0].from}${history[0].to}`;
    if (first !== "g1f3") return null;
    const move = legalMoveByKey(game, state, color, "c7c5");
    if (!move) return null;
    const testState = game.cloneState(state);
    game.applyMoveToState(testState, move);
    if (opponentHasMateInOne(game, testState, color)) return null;
    move._stonefishOpeningName = "Stonefish v6.7 Full Anti-KIA Symmetry Break";
    move._stonefishOpeningNames = [move._stonefishOpeningName];
    move._stonefishBook = true;
    return move;
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

  function mentalNotes(game, color) {
    const history = (game.moveHistory || []).filter(entry => entry && entry.color === game.opponent(color));
    const notes = {
      forkHunter: 0,
      queenRaider: 0,
      captureGreed: 0,
      checkingPressure: 0,
      kingPawnStorm: 0,
      developmentLag: 0,
      text: []
    };
    for (const entry of history.slice(-14)) {
      const from = entry.from || "";
      const to = entry.to || "";
      const san = entry.san || `${from}-${to}`;
      const piece = (entry.piece || san[0] || "").toUpperCase();
      if (piece === "N" || piece === "Q") notes.forkHunter += 0.8;
      if (piece === "Q") notes.queenRaider += 1.3;
      if (/[x:-]/.test(san) && san.includes("x")) notes.captureGreed += 1.1;
      if (san.includes("+") || san.includes("#")) notes.checkingPressure += 1.4;
      if (/^[a-h][24-57]/.test(to) && (to[0] === "g" || to[0] === "h" || to[0] === "f")) notes.kingPawnStorm += 0.9;
      if ((piece === "N" || piece === "B") && (from[1] === "1" || from[1] === "8")) notes.developmentLag -= 0.4;
    }
    if (notes.forkHunter >= 4) notes.text.push("Opponent keeps looking for fork geometry; keep heavy pieces and king off same knight/queen lanes.");
    if (notes.queenRaider >= 3) notes.text.push("Opponent brings the queen out early; gain tempi, trade queens, and leave no loose pawns.");
    if (notes.captureGreed >= 3) notes.text.push("Opponent accepts material bait; prefer poisoned captures and recapturable pieces.");
    if (notes.checkingPressure >= 2) notes.text.push("Opponent likes forcing checks; keep king exits and answer threats before grabbing material.");
    if (notes.kingPawnStorm >= 2) notes.text.push("Opponent pushes flank pawns at the king; close lines or counter in the center.");
    return notes;
  }

  function mentalNotesCounterScore(game, state, color, candidate, notes) {
    let score = 0;
    const enemy = game.opponent(color);
    const move = candidate.move;
    const movedPiece = state.board[move.from.r][move.from.c];
    const movedType = movedPiece ? game.typeOf(movedPiece) : "";
    const toCenter = centralBonus(move.to.r, move.to.c) - centralBonus(move.from.r, move.from.c);
    const enemyReplyPressure = candidate.opponentPlan || quickOpponentPlanProfile(game, candidate.testState, color);
    if (notes.forkHunter >= 4) {
      score += Math.max(0, candidate.danger ? candidate.danger.worstNetLoss : 0) * -0.65;
      score += enemyReplyPressure.worstNetPlan > 120 ? -Math.min(180, enemyReplyPressure.worstNetPlan * 0.42) : 24;
      if (movedType === "K" || movedType === "Q" || movedType === "R") score += toCenter < 0 ? 18 : -10;
    }
    if (notes.queenRaider >= 3) {
      if (movedType === "N" || movedType === "B") score += Math.max(0, toCenter) * 2.4;
      if (game.isInCheck(enemy, candidate.testState)) score += 24;
      if (materialCapturedByMove(game, state, move, color) >= 900) score += 180;
    }
    if (notes.captureGreed >= 3) {
      const captured = materialCapturedByMove(game, state, move, color);
      if (!captured && enemyReplyPressure.bestPreparedness > 80) score += 46;
      if (captured && enemyReplyPressure.worstNetPlan > captured + 80) score -= 80;
    }
    if (notes.checkingPressure >= 2) {
      if (game.isInCheck(color, candidate.testState)) score -= 90;
      score -= Math.max(0, enemyReplyPressure.worstNetPlan - 120) * 0.30;
    }
    if (notes.kingPawnStorm >= 2) {
      if (movedType === "P" && move.to.c >= 2 && move.to.c <= 5) score += 22;
      if (move.castle) score += 14;
    }
    candidate._mentalNotes = notes.text;
    return score;
  }

  function bookMoveByUci(game, legal, uci) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    return legal.find(move => game.squareName(move.from.r, move.from.c) === from && game.squareName(move.to.r, move.to.c) === to) || null;
  }

  function fullV67CounterBook(game, legal, color) {
    const history = game.moveHistory || [];
    if (history.length === 1 && color === "b" && history[0].from === "c2" && history[0].to === "c4") return bookMoveByUci(game, legal, "c7c5");
    return null;
  }

  window.StonefishV67 = {
    name: "Stonefish v6.7",

    chooseMove(game, color) {
      if ((game.moveHistory || []).length <= 1) resetStonefishCaches();
      const state = game.state;
      const legal = legalMoves(game, state, color);
      if (!legal.length) return null;
      const counterBook = fullV67CounterBook(game, legal, color);
      if (counterBook) return game.cloneMove(counterBook);
      const mateMoves = legal.filter(move => moveCheckmates(game, state, move, color));
      if (mateMoves.length) {
        mateMoves.sort((a, b) => moveKey(a).localeCompare(moveKey(b)));
        return game.cloneMove(mateMoves[0]);
      }

      const fullCounter = fullOnlyAntiKIAStart(game, state, color);
      if (fullCounter) return fullCounter;

      const bookMap = bookScores(game, color, legal);
      const currentPlan = quickOpponentPlanProfile(game, state, color);
      const notes = mentalNotes(game, color);

      const trustedBook = trustedV65BookContinuation(game, state, color, legal, bookMap);
      if (trustedBook) return decorateBookMove(game, trustedBook);

      const bookChoice = fastOpeningChoice(game, state, color, legal, bookMap, currentPlan);
      if (bookChoice) return decorateBookMove(game, bookChoice);

      let candidates = legal.map(move => preScoreMove(game, state, move, color, bookMap));
      candidates.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));

      const limit = finalCandidateLimit(game, state, candidates, color);
      const finalists = candidates.slice(0, limit);
      for (const candidate of candidates.slice(limit)) {
        if (candidate.book || candidate.givesCheck || candidate.captured >= 500 || candidate.move.promotion) finalists.push(candidate);
      }

      for (let i = 0; i < finalists.length; i++) {
        const candidate = finalists[i];
        const verifiedScore = terminalVerification(game, candidate.testState, color);
        const verificationDelta = verifiedScore - candidate.staticScore;
        if (verifiedScore <= -MATE_SCORE / 2) candidate.score -= MATE_SCORE / 3;
        else if (verifiedScore >= MATE_SCORE / 2) candidate.score += MATE_SCORE / 3;
        else candidate.score += Math.max(-260, Math.min(420, verificationDelta)) * 0.24;

        const danger = quickDangerProfile(game, candidate.testState, color, true);
        candidate.danger = danger;
        candidate.score -= Math.max(0, danger.worstNetLoss) * 3.55;
        candidate.score -= danger.totalLoss * 0.70;
        if (danger.worstNetLoss >= 260) candidate.score -= 620;
        if (danger.mateDanger) candidate.score -= MATE_SCORE / 2;

        const opponentPlan = quickOpponentPlanProfile(game, candidate.testState, color);
        candidate.opponentPlan = opponentPlan;
        candidate.score -= opponentPlan.worstNetPlan * 0.82;
        candidate.score -= opponentPlan.totalNetPlan * 0.11;
        candidate.score += Math.max(0, currentPlan.worstNetPlan - opponentPlan.worstNetPlan) * 0.82;
        if (opponentPlan.forcingPlans >= 2) candidate.score -= 50;
        if (opponentPlan.bestPreparedness >= opponentPlan.bestRawPlan * 0.80 && opponentPlan.bestRawPlan > 140) candidate.score += 56;
        if (candidate.book && opponentPlan.worstNetPlan > currentPlan.worstNetPlan + 100) candidate.score -= Math.min(320, opponentPlan.worstNetPlan - currentPlan.worstNetPlan);
        if (opponentPlan.matePlan && opponentPlan.worstNetPlan > 170) candidate.score -= MATE_SCORE / 5;

        if (notes.text.length) candidate.score += mentalNotesCounterScore(game, state, color, candidate, notes) * 0.18;
        if (opponentHasMateInOne(game, candidate.testState, color)) candidate.score -= MATE_SCORE;
        const terminal = terminalScore(game, candidate.testState, color);
        if (terminal !== null) candidate.score += terminal;
      }

      finalists.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
      return decorateBookMove(game, finalists[0] || candidates[0]);
    },

    _stonefishDepthProfile: "v6.7 full architecture: same v6 ply profile, staged always-on finalist verification, faster cache-heavy scoring, opponent-plan suppression, and conversion pressure"
  };
})();
