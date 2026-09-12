// Experimental Pro-aware root prepass + selective verification for v5 Pro.
//
// The root prepass keeps strong quiet moves alive without paying the three-ply
// tactical cost on every legal move. A second, modestly wider five-ply search
// is used only when the fast deep score strongly contradicts the root signal.
// This targets unstable tactical evaluations without slowing every move.

const STONEFISH_V5_PRO_ROOT_PREPASS = 10;
const STONEFISH_V5_PRO_VERIFY_BRANCH = [0, 3, 4, 4, 6];

function stonefishV5ProNeedsVerification(entry) {
  if (entry.deep === null || !Number.isFinite(entry.deep)) return false;
  return (entry.preliminary >= 700 && entry.deep <= -100)
    || (entry.preliminary <= -250 && entry.deep >= 100);
}

function stonefishV5ProVerifyTTKey(game, depth, perspective, plyFromRoot) {
  return perspective + '|' + depth + '|' + plyFromRoot + '|' + game.halfmove + '|' + game.fastPositionKey();
}

function stonefishV5ProVerifyMinimax(game, depth, perspective, alpha, beta, plyFromRoot, tt) {
  const key = stonefishV5ProVerifyTTKey(game, depth, perspective, plyFromRoot);
  const hit = tt.get(key);
  if (hit !== undefined) return hit;

  if (depth <= 0) {
    if (game.in_check()) {
      const legal = game.fastMoves();
      if (!legal.length) {
        const terminal = game.side === perspective
          ? -STONEFISH_V5_PRO_MATE + plyFromRoot
          : STONEFISH_V5_PRO_MATE - plyFromRoot;
        tt.set(key, terminal);
        return terminal;
      }
      return stonefishV5ProCheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot);
    }
    if (!game.fastHasLegalMove()) {
      tt.set(key, 0);
      return 0;
    }
    if (game.halfmove >= 100 || game._insufficientMaterial()) {
      tt.set(key, 0);
      return 0;
    }
    const leaf = stonefishV5ProLeaf(game, perspective);
    tt.set(key, leaf);
    return leaf;
  }

  const legal = game.fastMoves();
  if (!legal.length) {
    const terminal = !game.in_check()
      ? 0
      : (game.side === perspective
          ? -STONEFISH_V5_PRO_MATE + plyFromRoot
          : STONEFISH_V5_PRO_MATE - plyFromRoot);
    tt.set(key, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) {
    tt.set(key, 0);
    return 0;
  }

  let width = STONEFISH_V5_PRO_VERIFY_BRANCH[depth] || 3;
  const danger = stonefishV5EnemyPasserThreat(game, game.side);
  if (game.in_check()) width = Math.max(width, 6);
  else if (danger >= 2200) width += 2;
  else if (danger >= 900) width += 1;
  width = Math.min(width, legal.length);

  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProSpeedMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
    .slice(0, width);

  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;

  for (const entry of ordered) {
    game.fastApply(entry.move);
    const value = stonefishV5ProVerifyMinimax(
      game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, tt
    );
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

  if (!cutoff) tt.set(key, best);
  return best;
}

function stonefishV5ProVerifyFivePlyScore(game, raw, perspective) {
  if (game.fastIsMateMove(raw)) return STONEFISH_V5_PRO_MATE;
  const tt = new Map();
  game.fastApply(raw);
  const value = stonefishV5ProVerifyMinimax(
    game,
    4,
    perspective,
    -STONEFISH_V5_PRO_MATE,
    STONEFISH_V5_PRO_MATE,
    1,
    tt
  );
  game.fastUndo();
  return value;
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
      verified: false,
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
    }
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }

  // Re-run only contradictory root/deep signals with a modestly wider tree.
  const finalistCount = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, semifinalCount);
  for (let i = 0; i < finalistCount; i += 1) {
    const entry = scored[i];
    if (stonefishV5ProNeedsVerification(entry)) {
      entry.deep = stonefishV5ProVerifyFivePlyScore(game, entry.raw, perspective);
      entry.verified = true;
    }
    if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) {
      entry.score = entry.deep;
    } else {
      entry.score = entry.deep * 1.35 + entry.preliminary * 0.38;
    }
  }

  for (let i = finalistCount; i < scored.length; i += 1) {
    scored[i].score = -Infinity;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
