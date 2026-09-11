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

// Analyse all opponent replies in one pass. This avoids generating the same
// legal-move list twice for every candidate move during large test runs.
function analyseOpponentReplies(game, pieceValues) {
  const replies = game.moves({ verbose: true });
  let allowsMateInOne = false;
  let maxCaptureValue = 0;

  for (const reply of replies) {
    if (reply.captured) {
      const captureValue = pieceValues[reply.captured] || 0;
      if (captureValue > maxCaptureValue) maxCaptureValue = captureValue;
    }

    // Once mate-in-1 is found we still continue scanning captures, because the
    // capture-risk score is needed if every legal candidate allows mate.
    if (!allowsMateInOne) {
      playStonefishCandidate(game, reply);
      allowsMateInOne = game.in_checkmate();
      game.undo();
    }
  }

  return { allowsMateInOne, maxCaptureValue };
}

function getStonefishV2MoveWithValues(game, pieceValues) {
  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  // Reuse one analysis board instead of constructing a new Chess object for
  // every branch.
  const analysisGame = new Chess(game.fen());
  const matingMoves = [];

  for (const move of legalMoves) {
    playStonefishCandidate(analysisGame, move);
    const isMate = analysisGame.in_checkmate();
    analysisGame.undo();
    if (isMate) matingMoves.push(move);
  }

  if (matingMoves.length > 0) {
    return matingMoves[Math.floor(Math.random() * matingMoves.length)];
  }

  const scoredMoves = [];
  let hasSafeMove = false;

  for (const move of legalMoves) {
    playStonefishCandidate(analysisGame, move);
    const replyAnalysis = analyseOpponentReplies(analysisGame, pieceValues);
    analysisGame.undo();

    if (!replyAnalysis.allowsMateInOne) hasSafeMove = true;
    scoredMoves.push({ move, ...replyAnalysis });
  }

  let lowestMaxCapture = Infinity;
  const bestMoves = [];

  for (const candidate of scoredMoves) {
    if (hasSafeMove && candidate.allowsMateInOne) continue;

    if (candidate.maxCaptureValue < lowestMaxCapture) {
      lowestMaxCapture = candidate.maxCaptureValue;
      bestMoves.length = 0;
      bestMoves.push(candidate.move);
    } else if (candidate.maxCaptureValue === lowestMaxCapture) {
      bestMoves.push(candidate.move);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function getStonefishV2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_PIECE_VALUES);
}
