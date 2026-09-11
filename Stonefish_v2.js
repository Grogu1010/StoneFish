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

const STONEFISH_V2_CACHE = new Map();
const STONEFISH_V2_CACHE_LIMIT = 50000;

function playStonefishCandidate(game, move) {
  return game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
}

function stonefishValueSignature(pieceValues) {
  return `p${pieceValues.p}|n${pieceValues.n}|b${pieceValues.b}|r${pieceValues.r}|q${pieceValues.q}`;
}

function stonefishPositionKey(game, pieceValues) {
  // Board, side to move, castling rights and en-passant square determine legal
  // moves. Halfmove/fullmove counters do not affect this engine's choice.
  const fenParts = game.fen().split(' ');
  return `${fenParts.slice(0, 4).join(' ')}|${stonefishValueSignature(pieceValues)}`;
}

function cacheStonefishBestMoves(key, moves) {
  if (STONEFISH_V2_CACHE.size >= STONEFISH_V2_CACHE_LIMIT) {
    const oldestKey = STONEFISH_V2_CACHE.keys().next().value;
    STONEFISH_V2_CACHE.delete(oldestKey);
  }

  STONEFISH_V2_CACHE.set(key, moves.map(move => ({
    from: move.from,
    to: move.to,
    promotion: move.promotion || null
  })));
}

function chooseRandomStonefishMove(moves) {
  if (!moves || moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function getStonefishV2MoveWithValues(game, pieceValues) {
  const cacheKey = stonefishPositionKey(game, pieceValues);
  const cachedMoves = STONEFISH_V2_CACHE.get(cacheKey);

  if (cachedMoves) {
    return chooseRandomStonefishMove(cachedMoves);
  }

  const legalMoves = game.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return null;
  }

  // chess.js has already calculated SAN for each legal move. A trailing '#'
  // means that move is checkmate, so no extra simulation is necessary here.
  const matingMoves = legalMoves.filter(move => move.san && move.san.endsWith('#'));

  if (matingMoves.length > 0) {
    cacheStonefishBestMoves(cacheKey, matingMoves);
    return chooseRandomStonefishMove(matingMoves);
  }

  const analysisGame = new Chess(game.fen());
  const scoredMoves = [];

  for (const move of legalMoves) {
    playStonefishCandidate(analysisGame, move);

    // One reply generation gives us everything v2 needs: SAN identifies mate
    // in one, and `captured` identifies the value at risk.
    const replies = analysisGame.moves({ verbose: true });
    let allowsMateInOne = false;
    let maxCaptureValue = 0;

    for (const reply of replies) {
      if (reply.san && reply.san.endsWith('#')) {
        allowsMateInOne = true;
      }

      if (reply.captured) {
        const captureValue = pieceValues[reply.captured] || 0;
        if (captureValue > maxCaptureValue) {
          maxCaptureValue = captureValue;
        }
      }
    }

    scoredMoves.push({ move, allowsMateInOne, maxCaptureValue });
    analysisGame.undo();
  }

  const safeMoves = scoredMoves.filter(candidate => !candidate.allowsMateInOne);
  const candidates = safeMoves.length > 0 ? safeMoves : scoredMoves;

  let lowestMaxCapture = Infinity;
  for (const candidate of candidates) {
    if (candidate.maxCaptureValue < lowestMaxCapture) {
      lowestMaxCapture = candidate.maxCaptureValue;
    }
  }

  const bestMoves = candidates
    .filter(candidate => candidate.maxCaptureValue === lowestMaxCapture)
    .map(candidate => candidate.move);

  cacheStonefishBestMoves(cacheKey, bestMoves);
  return chooseRandomStonefishMove(bestMoves);
}

function getStonefishV2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_PIECE_VALUES);
}
