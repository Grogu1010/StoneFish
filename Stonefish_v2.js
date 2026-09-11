// Stonefish_v2
// Priorities:
// 1. Always play mate in 1 when available.
// 2. Avoid any move that allows the opponent to mate in 1, whenever a safe legal move exists.
// 3. Otherwise minimise the highest-value piece the opponent can capture next move.
// Ties are broken randomly.

const STONEFISH_PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 1000
};

function playStonefishCandidate(game, move) {
  return game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
}

function opponentHasMateInOne(game) {
  const replies = game.moves({ verbose: true });

  for (const reply of replies) {
    playStonefishCandidate(game, reply);
    const isMate = game.in_checkmate();
    game.undo();

    if (isMate) {
      return true;
    }
  }

  return false;
}

function highestOpponentCaptureValue(game, pieceValues) {
  const replies = game.moves({ verbose: true });
  let highestValue = 0;

  // chess.js already tells us which piece a legal move captures, so this
  // calculation needs no extra board simulation.
  for (const reply of replies) {
    if (!reply.captured) continue;

    const captureValue = pieceValues[reply.captured] || 0;
    if (captureValue > highestValue) {
      highestValue = captureValue;
    }
  }

  return highestValue;
}

function getStonefishV2MoveWithValues(game, pieceValues) {
  const legalMoves = game.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return null;
  }

  // Analyse on one temporary board instead of repeatedly creating new Chess
  // objects from FEN. This preserves the same logic but is much faster in tests.
  const analysisGame = new Chess(game.fen());

  // Mate in 1 outranks every other concern.
  const matingMoves = [];

  for (const move of legalMoves) {
    playStonefishCandidate(analysisGame, move);
    const isMate = analysisGame.in_checkmate();
    analysisGame.undo();

    if (isMate) {
      matingMoves.push(move);
    }
  }

  if (matingMoves.length > 0) {
    return matingMoves[Math.floor(Math.random() * matingMoves.length)];
  }

  const scoredMoves = [];

  for (const move of legalMoves) {
    playStonefishCandidate(analysisGame, move);

    scoredMoves.push({
      move,
      allowsMateInOne: opponentHasMateInOne(analysisGame),
      maxCaptureValue: highestOpponentCaptureValue(analysisGame, pieceValues)
    });

    analysisGame.undo();
  }

  // If avoiding mate in 1 is possible, unsafe moves are never considered.
  const safeMoves = scoredMoves.filter(candidate => !candidate.allowsMateInOne);
  const candidates = safeMoves.length > 0 ? safeMoves : scoredMoves;

  let lowestMaxCapture = Infinity;
  for (const candidate of candidates) {
    if (candidate.maxCaptureValue < lowestMaxCapture) {
      lowestMaxCapture = candidate.maxCaptureValue;
    }
  }

  const bestMoves = candidates.filter(candidate => candidate.maxCaptureValue === lowestMaxCapture);
  const choice = bestMoves[Math.floor(Math.random() * bestMoves.length)];

  return choice.move;
}

function getStonefishV2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_PIECE_VALUES);
}
