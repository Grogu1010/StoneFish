// Stonefish_v4.5 balance patch.
// Keeps v4.5 limited to its three intended additions: openings, mate patterns, inverses.
// The opponent-mobility inverse is deliberately delayed until fullmove 24 so v4.5
// remains a modest step over v4 instead of dominating from the opening.

getStonefishV45MoveWithProfile = function(game, profileIndex = 0) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return null;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];

    if (criterion === 'mobility') {
      // Opening knowledge still gets its normal weighted choice among the early
      // v4-safe candidates.
      const book = stonefishV45BookMove(game, profileIndex, candidates);
      if (book) return stonefishV3PublicMove(game, book);

      // Inverse knowledge is intentionally quieter until the middlegame.
      // This is the measured natural balance point: no random weakening.
      if (game.fullmove >= 24 && candidates.length > 1) {
        candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
      }
    }

    candidates = stonefishV4BestByCriterion(game, candidates, criterion);

    if (criterion === 'pieceSupport' && candidates.length > 1) {
      candidates = stonefishV45StrictPatternTieBreak(game, candidates);
    }
  }

  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
};

stonefishV45BestRawMoves = function(game) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return candidates;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];
    if (criterion === 'mobility' && game.fullmove >= 24 && candidates.length > 1) {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
    }
    candidates = stonefishV4BestByCriterion(game, candidates, criterion);
    if (criterion === 'pieceSupport' && candidates.length > 1) {
      candidates = stonefishV45StrictPatternTieBreak(game, candidates);
    }
  }
  return candidates;
};

getStonefishV45Move = function(game) {
  return getStonefishV45MoveWithProfile(game, 0);
};
