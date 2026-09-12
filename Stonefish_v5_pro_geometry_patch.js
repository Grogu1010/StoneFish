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

// Deep search only keeps a tiny beam (normally 2-6 moves), so allocating a
// wrapper for every legal move and fully sorting the whole list does extra work.
// This stable top-K selector uses the exact same ordering score and tie rule as
// the previous map/sort/slice pipeline, while retaining at most K wrappers.
function stonefishV5ProSelectOrdered(game, legal, width) {
  const limit = Math.min(width, legal.length);
  if (limit <= 0) return [];
  const ordered = [];

  for (let index = 0; index < legal.length; index += 1) {
    const move = legal[index];
    const order = stonefishV5ProSpeedMoveOrder(game, move);

    if (ordered.length === limit) {
      const last = ordered[limit - 1];
      const versusLast = (last.order - order) || (index - last.index);
      if (versusLast >= 0) continue;
    }

    let position = ordered.length;
    while (position > 0) {
      const previous = ordered[position - 1];
      const versusPrevious = (previous.order - order) || (index - previous.index);
      if (versusPrevious >= 0) break;
      position -= 1;
    }

    if (ordered.length < limit) ordered.length += 1;
    for (let shift = ordered.length - 1; shift > position; shift -= 1) {
      ordered[shift] = ordered[shift - 1];
    }
    ordered[position] = { move, index, order };
  }

  return ordered;
}

stonefishV5ProCheckedLeaf = function(game, perspective, alpha, beta, legal, plyFromRoot) {
  const maximizing = game.side === perspective;
  const ordered = stonefishV5ProSelectOrdered(game, legal, Math.min(6, legal.length));
  let best = maximizing ? -Infinity : Infinity;

  for (const entry of ordered) {
    game.fastApply(entry.move);
    let value;
    if (!game.fastHasLegalMove()) {
      value = game.in_check()
        ? (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot + 1 : STONEFISH_V5_PRO_MATE - plyFromRoot - 1)
        : 0;
    } else {
      value = stonefishV5ProLeaf(game, perspective);
    }
    game.fastUndo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
};

stonefishV5ProMinimax = function(game, depth, perspective, alpha, beta, plyFromRoot) {
  const tt = STONEFISH_V5_PRO_ACTIVE_TT;
  const key = tt ? stonefishV5ProTTKey(game, depth, perspective, plyFromRoot) : null;
  if (tt) {
    const hit = tt.get(key);
    if (hit !== undefined) {
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.ttHits += 1;
      return hit;
    }
  }
  if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.nodes += 1;

  if (depth <= 0) {
    if (game.in_check()) {
      const legal = game.fastMoves();
      if (!legal.length) {
        const terminal = game.side === perspective
          ? -STONEFISH_V5_PRO_MATE + plyFromRoot
          : STONEFISH_V5_PRO_MATE - plyFromRoot;
        if (tt) tt.set(key, terminal);
        return terminal;
      }
      const extended = stonefishV5ProCheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot);
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
      return extended;
    }
    if (!game.fastHasLegalMove()) {
      if (tt) tt.set(key, 0);
      return 0;
    }
    if (game.halfmove >= 100 || game._insufficientMaterial()) {
      if (tt) tt.set(key, 0);
      return 0;
    }
    const leaf = stonefishV5ProLeaf(game, perspective);
    if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
    if (tt) tt.set(key, leaf);
    return leaf;
  }

  const legal = game.fastMoves();
  if (!legal.length) {
    const terminal = !game.in_check()
      ? 0
      : (game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot);
    if (tt) tt.set(key, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) {
    if (tt) tt.set(key, 0);
    return 0;
  }

  let width = STONEFISH_V5_PRO_SPEED_BRANCH[depth] || 2;
  const danger = stonefishV5EnemyPasserThreat(game, game.side);
  if (game.in_check()) width = Math.max(width, 6);
  else if (danger >= 2200) width += 2;
  else if (danger >= 900) width += 1;
  width = Math.min(width, legal.length);

  const ordered = stonefishV5ProSelectOrdered(game, legal, width);
  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;

  for (const entry of ordered) {
    game.fastApply(entry.move);
    const value = stonefishV5ProMinimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
    game.fastUndo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) {
      cutoff = true;
      break;
    }
  }

  if (tt && !cutoff) tt.set(key, best);
  return best;
};
