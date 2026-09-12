// Stonefish v5 / v5 Pro: no opening book.
//
// v4.5 keeps its weighted opening repertoire unchanged. v5 and v5 Pro do not
// consult that repertoire at all: their move choice comes only from their own
// tactical, positional, heritage (minus book), conversion, and search logic.
//
// The existing v5/v5 Pro implementations contain historical book hooks in a
// few internal paths. Rather than changing v4.5's shared book implementation,
// this final layer suppresses those hooks only while v5/v5 Pro are scoring.

STONEFISH_V5_WEIGHTS.book = 0;

function stonefishV5RunWithoutOpeningBook(fn, game) {
  const savedBookMove = stonefishV45BookMove;
  stonefishV45BookMove = function() { return null; };
  try {
    return fn(game);
  } finally {
    stonefishV45BookMove = savedBookMove;
  }
}

const stonefishV5ScoreAllMovesBeforeNoBook = stonefishV5ScoreAllMoves;
stonefishV5ScoreAllMoves = function(game) {
  return stonefishV5RunWithoutOpeningBook(stonefishV5ScoreAllMovesBeforeNoBook, game);
};

if (typeof stonefishV5ProScoreAllMoves === 'function') {
  const stonefishV5ProScoreAllMovesBeforeNoBook = stonefishV5ProScoreAllMoves;
  stonefishV5ProScoreAllMoves = function(game) {
    return stonefishV5RunWithoutOpeningBook(stonefishV5ProScoreAllMovesBeforeNoBook, game);
  };
}
