// Experimental Pro-aware root prepass for v5 Pro.
//
// The failed fast scout was discarding strong quiet released-Pro moves before
// they reached deep search. Instead, rank EVERY legal move with Pro root
// knowledge first (without the expensive three-ply tactical calculation), then
// spend tactical work on only the best root candidates. The final deep blend
// matches released Pro in ordinary positions and uses bounded confidence
// adjustments when strong root evidence sharply contradicts a negative narrow
// deep score. These adjustments add no search nodes.

const STONEFISH_V5_PRO_ROOT_PREPASS = 10;
const STONEFISH_V5_PRO_CONFIDENCE_ROOT = 900;
const STONEFISH_V5_PRO_CONFIDENCE_DEEP = -250;
const STONEFISH_V5_PRO_CONFIDENCE_DEEP_WEIGHT = 1.20;
const STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_ROOT = 1000;
const STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_BONUS = 30;

function stonefishV5ProConfidenceDeepWeight(entry) {
  if (entry.preliminary >= STONEFISH_V5_PRO_CONFIDENCE_ROOT
      && entry.deep <= STONEFISH_V5_PRO_CONFIDENCE_DEEP) {
    return STONEFISH_V5_PRO_CONFIDENCE_DEEP_WEIGHT;
  }
  return 1.35;
}

function stonefishV5ProHeritageConfidenceBonus(entry) {
  if (entry.heritageMatch
      && entry.preliminary >= STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_ROOT
      && entry.deep <= STONEFISH_V5_PRO_CONFIDENCE_DEEP) {
    return STONEFISH_V5_PRO_HERITAGE_CONFIDENCE_BONUS;
  }
  return 0;
}

stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  // Quiet-move-aware first pass: no three-ply tactical search yet.
  for (const raw of legal) {
    const knowledge = stonefishV5ProRootKnowledge(
      game, raw, heritageMove, bookMove, perspective, 0
    );
    scored.push({
      raw,
      tactical: null,
      knowledge,
      scout: knowledge,
      heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
      preliminary: knowledge,
      deep: null,
      score: -Infinity
    });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.knowledge - a.knowledge) > 1e-9) return b.knowledge - a.knowledge;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  const semifinalCount = Math.min(STONEFISH_V5_PRO_ROOT_PREPASS, scored.length);
  for (let i = 0; i < semifinalCount; i += 1) {
    const entry = scored[i];
    entry.tactical = stonefishV5TacticalScore(game, entry.raw);
    // Recompute knowledge with the real tactical signal so confidence logic is
    // identical to released Pro for the moves that survive the prepass.
    entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(
          game, entry.raw, heritageMove, bookMove, perspective, entry.tactical
        );
    entry.preliminary = entry.tactical + entry.knowledge;
  }
  for (let i = semifinalCount; i < scored.length; i += 1) {
    scored[i].preliminary = -Infinity;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.preliminary - a.preliminary) > 1e-9) return b.preliminary - a.preliminary;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    const finalistCount = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, semifinalCount);
    for (let i = 0; i < finalistCount; i += 1) {
      const entry = scored[i];
      entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
      if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) {
        entry.score = entry.deep;
      } else {
        const deepWeight = stonefishV5ProConfidenceDeepWeight(entry);
        entry.score = entry.deep * deepWeight + entry.preliminary * 0.38
          + stonefishV5ProHeritageConfidenceBonus(entry);
      }
    }
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }

  for (let i = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, semifinalCount); i < scored.length; i += 1) {
    scored[i].score = -Infinity;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
