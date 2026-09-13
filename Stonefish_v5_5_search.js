// Stonefish v5.5 native search core.
//
// v5.5 keeps Stonefish v5 Pro's chess knowledge/evaluation but replaces Pro's
// expensive root search with a faster guarded PVS pipeline:
// - only two root finalists receive the full five-ply search;
// - the first opponent layer is WIDER than Pro to catch more refutations early;
// - later quiet moves use principal-variation probes and late-move reductions;
// - tactical/checking moves are never reduced.
//
// This is intentionally a v5.5 feature, separate from ARMX. ARMX then audits the
// chosen leader for opponent replies outside this search beam.

const STONEFISH_V5_5_SEARCH = Object.freeze({
  name: 'Guarded PVS',
  semifinalists: 6,
  rootCandidates: 2,
  branch: [0, 2, 2, 3, 7],
  lmrMinDepth: 3,
  lmrAfterMove: 2,
});

let STONEFISH_V5_5_LAST_SEARCH_STATS = null;

function stonefishV55IsTactical(game, move) {
  if (move.captured || move.promotion) return true;
  return Boolean(game.fastGivesCheck && game.fastGivesCheck(move));
}

function stonefishV55SearchWidth(game, depth, legal) {
  let width = STONEFISH_V5_5_SEARCH.branch[depth] || 2;
  const danger = typeof stonefishV5EnemyPasserThreat === 'function'
    ? stonefishV5EnemyPasserThreat(game, game.side)
    : 0;
  if (game.in_check()) width = Math.max(width, Math.min(6, legal.length));
  else if (danger >= 2200) width += 2;
  else if (danger >= 900) width += 1;
  return Math.min(width, legal.length);
}

function stonefishV55Terminal(game, perspective, plyFromRoot, legal) {
  if (legal.length) return null;
  if (!game.in_check()) return 0;
  return game.side === perspective
    ? -STONEFISH_V5_PRO_MATE + plyFromRoot
    : STONEFISH_V5_PRO_MATE - plyFromRoot;
}

function stonefishV55Leaf(game, perspective, alpha, beta, plyFromRoot) {
  if (game.in_check()) {
    const legal = game.fastMoves();
    if (!legal.length) return game.side === perspective
      ? -STONEFISH_V5_PRO_MATE + plyFromRoot
      : STONEFISH_V5_PRO_MATE - plyFromRoot;
    // Reuse Pro's proven forced-evasion leaf extension.
    if (typeof stonefishV5ProCheckedLeaf === 'function') {
      return stonefishV5ProCheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot);
    }
  }
  if (!game.fastHasLegalMove()) return 0;
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.leaves += 1;
  return stonefishV5ProLeaf(game, perspective);
}

function stonefishV55Minimax(game, depth, perspective, alpha, beta, plyFromRoot) {
  if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.nodes += 1;
  if (depth <= 0) return stonefishV55Leaf(game, perspective, alpha, beta, plyFromRoot);

  const legal = game.fastMoves();
  const terminal = stonefishV55Terminal(game, perspective, plyFromRoot, legal);
  if (terminal !== null) return terminal;
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;

  const width = stonefishV55SearchWidth(game, depth, legal);
  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProSpeedMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
    .slice(0, width);

  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < ordered.length; i += 1) {
    const move = ordered[i].move;
    const tactical = stonefishV55IsTactical(game, move);
    game.fastApply(move);

    let value;
    if (i === 0) {
      value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
    } else if (depth >= STONEFISH_V5_5_SEARCH.lmrMinDepth
      && i >= STONEFISH_V5_5_SEARCH.lmrAfterMove
      && !tactical) {
      // Cheap reduced-depth proof first. Only restore full depth if the quiet move
      // can actually challenge the current principal variation.
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.reductions += 1;
      if (maximizing) {
        value = stonefishV55Minimax(game, Math.max(0, depth - 2), perspective, alpha, Math.min(beta, alpha + 1), plyFromRoot + 1);
        if (value > alpha && value < beta) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
        }
      } else {
        value = stonefishV55Minimax(game, Math.max(0, depth - 2), perspective, Math.max(alpha, beta - 1), beta, plyFromRoot + 1);
        if (value < beta && value > alpha) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
        }
      }
    } else {
      // Principal-variation search: later ordered moves get a null-window probe.
      if (maximizing) {
        value = stonefishV55Minimax(game, depth - 1, perspective, alpha, Math.min(beta, alpha + 1), plyFromRoot + 1);
        if (value > alpha && value < beta) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
        }
      } else {
        value = stonefishV55Minimax(game, depth - 1, perspective, Math.max(alpha, beta - 1), beta, plyFromRoot + 1);
        if (value < beta && value > alpha) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
        }
      }
    }

    game.fastUndo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) {
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.cutoffs += 1;
      break;
    }
  }

  return best;
}

function stonefishV55FivePlyScore(game, raw, perspective) {
  const historyDepth = game.historyStack.length;
  STONEFISH_V5_5_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, reductions: 0, researches: 0, cutoffs: 0 };
  try {
    game.fastApply(raw);
    if (!game.fastHasLegalMove()) {
      if (game.in_check()) return STONEFISH_V5_PRO_MATE - 1;
      return 0;
    }
    return stonefishV55Minimax(
      game,
      4,
      perspective,
      -STONEFISH_V5_PRO_MATE,
      STONEFISH_V5_PRO_MATE,
      1
    );
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55NativeScoreAllMoves(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const heritageMove = stonefishV5HeritageMove(game);

  const scored = legal.map(raw => ({
    raw,
    tactical: null,
    knowledge: 0,
    heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
    scout: stonefishV5ProFastScoutScore(game, raw, bookMove, heritageMove, perspective),
    preliminary: -Infinity,
    deep: null,
    score: -Infinity
  }));

  scored.sort((a, b) => {
    if (Math.abs(b.scout - a.scout) > 1e-9) return b.scout - a.scout;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  const semifinalCount = Math.min(STONEFISH_V5_5_SEARCH.semifinalists, scored.length);
  for (let i = 0; i < semifinalCount; i += 1) {
    const entry = scored[i];
    entry.tactical = stonefishV5TacticalScore(game, entry.raw);
    const heritageBoost = entry.heritageMatch ? STONEFISH_V5_WEIGHTS.heritage * 1.25 : 0;
    entry.preliminary = entry.tactical + entry.scout * 0.34 + heritageBoost
      + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
  }

  scored.sort((a, b) => {
    if (Math.abs(b.preliminary - a.preliminary) > 1e-9) return b.preliminary - a.preliminary;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  const finalistCount = Math.min(STONEFISH_V5_5_SEARCH.rootCandidates, semifinalCount);
  for (let i = 0; i < finalistCount; i += 1) {
    const entry = scored[i];
    entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(game, entry.raw, heritageMove, bookMove, perspective, entry.tactical);
    entry.preliminary = entry.tactical + entry.knowledge
      + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
    entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective);
    if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) {
      entry.score = entry.deep;
    } else {
      const selective = entry.deep * 1.28 + entry.preliminary * 0.46;
      const heritageFloor = entry.heritageMatch
        ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
        : -Infinity;
      entry.score = Math.max(selective, heritageFloor);
    }
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_SEARCH = STONEFISH_V5_5_SEARCH;
  globalThis.stonefishV55Minimax = stonefishV55Minimax;
  globalThis.stonefishV55FivePlyScore = stonefishV55FivePlyScore;
  globalThis.stonefishV55NativeScoreAllMoves = stonefishV55NativeScoreAllMoves;
}
