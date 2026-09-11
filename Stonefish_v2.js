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

function cloneStonefishGame(game) {
  return new Chess(game.fen());
}

function playStonefishCandidate(game, move) {
  return game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
}

function opponentHasMateInOne(game) {
  const replies = game.moves({ verbose: true });

  return replies.some(reply => {
    const testGame = cloneStonefishGame(game);
    playStonefishCandidate(testGame, reply);
    return testGame.in_checkmate();
  });
}

function highestOpponentCaptureValue(game, pieceValues) {
  const replies = game.moves({ verbose: true });
  let highestValue = 0;

  for (const reply of replies) {
    if (!reply.captured) continue;

    const captureValue = pieceValues[reply.captured] || 0;
    highestValue = Math.max(highestValue, captureValue);
  }

  return highestValue;
}

function getStonefishV2MoveWithValues(game, pieceValues) {
  const legalMoves = game.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return null;
  }

  // Mate in 1 outranks every other concern.
  const matingMoves = legalMoves.filter(move => {
    const testGame = cloneStonefishGame(game);
    playStonefishCandidate(testGame, move);
    return testGame.in_checkmate();
  });

  if (matingMoves.length > 0) {
    return matingMoves[Math.floor(Math.random() * matingMoves.length)];
  }

  const scoredMoves = legalMoves.map(move => {
    const testGame = cloneStonefishGame(game);
    playStonefishCandidate(testGame, move);

    return {
      move,
      allowsMateInOne: opponentHasMateInOne(testGame),
      maxCaptureValue: highestOpponentCaptureValue(testGame, pieceValues)
    };
  });

  // If avoiding mate in 1 is possible, unsafe moves are never considered.
  const safeMoves = scoredMoves.filter(candidate => !candidate.allowsMateInOne);
  const candidates = safeMoves.length > 0 ? safeMoves : scoredMoves;

  const lowestMaxCapture = Math.min(...candidates.map(candidate => candidate.maxCaptureValue));
  const bestMoves = candidates.filter(candidate => candidate.maxCaptureValue === lowestMaxCapture);
  const choice = bestMoves[Math.floor(Math.random() * bestMoves.length)];

  return choice.move;
}

function getStonefishV2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_PIECE_VALUES);
}
