// Experimental released-root / fast-tree architecture for v5 Pro.
//
// Keep the optimized narrow five-ply minimax from the speed layer, but restore
// the released Pro's high-quality root evaluation across EVERY legal move.
// This directly addresses the fast scout discarding strong quiet moves before
// they can reach deep search. It also removes the speed patch's heritage floor
// and returns to the released Pro's deep/preliminary blend.

stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  // Released-Pro root intelligence for every legal move. Deep search remains
  // selective and uses the optimized fast-tree minimax from the speed layer.
  for (const raw of legal) {
    const tactical = stonefishV5TacticalScore(game, raw);
    const knowledge = Math.abs(tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(game, raw, heritageMove, bookMove, perspective, tactical);
    const preliminary = tactical + knowledge;
    scored.push({
      raw,
      tactical,
      knowledge,
      scout: null,
      heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
      preliminary,
      deep: null,
      score: preliminary
    });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.preliminary - a.preliminary) > 1e-9) return b.preliminary - a.preliminary;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    const finalistCount = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, scored.length);
    for (let i = 0; i < finalistCount; i += 1) {
      const entry = scored[i];
      entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
      if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) {
        entry.score = entry.deep;
      } else {
        entry.score = entry.deep * 1.35 + entry.preliminary * 0.38;
      }
    }
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }

  // Non-finalists are intentionally not allowed to leapfrog deep-searched moves.
  for (let i = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, scored.length); i < scored.length; i += 1) {
    scored[i].score = -Infinity;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
