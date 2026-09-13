// Stonefish v5.5 native search core — ARMX-guided Guarded PVS.
//
// v5.5 keeps v5 Pro's evaluation/knowledge but spends the expensive five-ply
// budget on only two root finalists. A cheap knowledge gate reviews the best four
// preliminary candidates with Pro's richer root knowledge before those two are
// chosen. ARMX then audits the actual provisional winner and may inject one missed
// opponent reply for a targeted re-search.

const STONEFISH_V5_5_SEARCH = Object.freeze({
  name: 'ARMX-guided Guarded PVS',
  semifinalists: 5,
  knowledgeCandidates: 4,
  rootCandidates: 2,
  branch: [0, 1, 2, 2, 4],
  lmrMinDepth: 3,
  lmrAfterMove: 2,
});

let STONEFISH_V5_5_LAST_SEARCH_STATS = null;

function stonefishV55IsTactical(game, move) {
  return Boolean(move.captured || move.promotion || (game.fastGivesCheck && game.fastGivesCheck(move)));
}

function stonefishV55SameRaw(a, b) {
  return Boolean(a && b && a.from === b.from && a.to === b.to
    && (a.promotion || 0) === (b.promotion || 0) && (a.flags || 0) === (b.flags || 0));
}

function stonefishV55SearchWidth(game, depth, legal) {
  let width = STONEFISH_V5_5_SEARCH.branch[depth] || 1;
  if (game.in_check()) width = Math.max(width, Math.min(5, legal.length));
  const danger = typeof stonefishV5EnemyPasserThreat === 'function'
    ? stonefishV5EnemyPasserThreat(game, game.side)
    : 0;
  if (danger >= 2200) width += 1;
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
    if (typeof stonefishV5ProCheckedLeaf === 'function') {
      return stonefishV5ProCheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot);
    }
  }
  if (!game.fastHasLegalMove()) return 0;
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.leaves += 1;
  return stonefishV5ProLeaf(game, perspective);
}

function stonefishV55Ordered(game, legal, depth, injectedMove) {
  const width = stonefishV55SearchWidth(game, depth, legal);
  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProSpeedMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index));
  const selected = ordered.slice(0, width);

  if (!injectedMove) return selected;
  const injectedIndex = ordered.findIndex(entry => stonefishV55SameRaw(entry.move, injectedMove));
  if (injectedIndex < 0 || injectedIndex < width) return selected;
  selected.push(ordered[injectedIndex]);
  return selected;
}

function stonefishV55Minimax(game, depth, perspective, alpha, beta, plyFromRoot, injectedMove = null) {
  if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.nodes += 1;
  if (depth <= 0) return stonefishV55Leaf(game, perspective, alpha, beta, plyFromRoot);

  const legal = game.fastMoves();
  const terminal = stonefishV55Terminal(game, perspective, plyFromRoot, legal);
  if (terminal !== null) return terminal;
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;

  const ordered = stonefishV55Ordered(game, legal, depth, injectedMove);
  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < ordered.length; i += 1) {
    const move = ordered[i].move;
    const tactical = stonefishV55IsTactical(game, move);
    game.fastApply(move);
    let value;

    if (i === 0) {
      value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
    } else if (depth >= STONEFISH_V5_5_SEARCH.lmrMinDepth
      && i >= STONEFISH_V5_5_SEARCH.lmrAfterMove && !tactical) {
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.reductions += 1;
      value = stonefishV55Minimax(game, Math.max(0, depth - 2), perspective, alpha, beta, plyFromRoot + 1, null);
      const challenges = maximizing ? value > alpha : value < beta;
      if (challenges) {
        if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
        value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
      }
    } else {
      value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
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

function stonefishV55FivePlyScore(game, raw, perspective, criticalReply = null) {
  const historyDepth = game.historyStack.length;
  STONEFISH_V5_5_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, reductions: 0, researches: 0, cutoffs: 0 };
  try {
    game.fastApply(raw);
    const legal = game.fastMoves();
    if (!legal.length) return game.in_check() ? STONEFISH_V5_PRO_MATE - 1 : 0;
    return stonefishV55Minimax(
      game,
      4,
      perspective,
      -STONEFISH_V5_PRO_MATE,
      STONEFISH_V5_PRO_MATE,
      1,
      criticalReply
    );
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55RecomputeFinalScore(entry) {
  if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) return entry.deep;
  const selective = entry.deep * 1.28 + entry.preliminary * 0.46;
  const heritageFloor = entry.heritageMatch
    ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
    : -Infinity;
  return Math.max(selective, heritageFloor);
}

function stonefishV55SortFinalScores(game, ranked) {
  ranked.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw));
  });
  return ranked;
}

function stonefishV55FastCandidates(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const heritageMove = stonefishV5HeritageMove(game);
  const scored = legal.map(raw => ({
    raw,
    tactical: null,
    knowledge: null,
    knowledgeReady: false,
    heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
    scout: stonefishV5ProFastScoutScore(game, raw, bookMove, heritageMove, perspective),
    preliminary: -Infinity,
    deep: null,
    score: -Infinity,
  }));

  scored.sort((a, b) => {
    if (Math.abs(b.scout - a.scout) > 1e-9) return b.scout - a.scout;
    return stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw));
  });

  const n = Math.min(STONEFISH_V5_5_SEARCH.semifinalists, scored.length);
  for (let i = 0; i < n; i += 1) {
    const entry = scored[i];
    entry.tactical = stonefishV5TacticalScore(game, entry.raw);
    const heritageBoost = entry.heritageMatch ? STONEFISH_V5_WEIGHTS.heritage * 1.25 : 0;
    entry.preliminary = entry.tactical + entry.scout * 0.34 + heritageBoost
      + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
    entry.score = entry.preliminary;
  }
  for (let i = n; i < scored.length; i += 1) {
    scored[i].preliminary = -Infinity;
    scored[i].score = -Infinity;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw));
  });

  // Native v5.5 feature: use rich positional/root knowledge as a cheap gate before
  // committing the expensive five-ply budget. Four candidates receive knowledge;
  // only the best two after this reranking are searched deeply.
  const knowledgeCount = Math.min(STONEFISH_V5_5_SEARCH.knowledgeCandidates, n);
  for (let i = 0; i < knowledgeCount; i += 1) {
    const entry = scored[i];
    entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(game, entry.raw, heritageMove, bookMove, perspective, entry.tactical);
    entry.knowledgeReady = true;
    entry.preliminary = entry.tactical + entry.knowledge
      + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
    entry.score = entry.preliminary;
  }
  for (let i = knowledgeCount; i < scored.length; i += 1) scored[i].score = -Infinity;

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw));
  });
  return scored;
}

function stonefishV55FinishCandidates(game, ranked) {
  if (!ranked.length) return [];
  const perspective = game.side;
  const legal = game.fastMoves();
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const heritageMove = stonefishV5HeritageMove(game);
  const finalists = Math.min(STONEFISH_V5_5_SEARCH.rootCandidates, ranked.length);

  for (let i = 0; i < finalists; i += 1) {
    const entry = ranked[i];
    if (!entry.knowledgeReady) {
      entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
        ? 0
        : stonefishV5ProRootKnowledge(game, entry.raw, heritageMove, bookMove, perspective, entry.tactical);
      entry.knowledgeReady = true;
      entry.preliminary = entry.tactical + entry.knowledge
        + stonefishV5ProConversionUrgency(game, entry.raw, perspective);
    }
    entry.armxCriticalReply = null;
    entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, null);
    entry.score = stonefishV55RecomputeFinalScore(entry);
  }

  for (let i = finalists; i < ranked.length; i += 1) ranked[i].score = -Infinity;
  return stonefishV55SortFinalScores(game, ranked);
}

function stonefishV55AuditCandidate(game, entry, perspective, criticalReply) {
  if (!entry || !criticalReply) return entry;
  entry.armxOriginalDeep = entry.deep;
  entry.armxCriticalReply = criticalReply;
  entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, criticalReply);
  entry.score = stonefishV55RecomputeFinalScore(entry);
  entry.armxVerifiedDeep = entry.deep;
  return entry;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_SEARCH = STONEFISH_V5_5_SEARCH;
  globalThis.stonefishV55Minimax = stonefishV55Minimax;
  globalThis.stonefishV55FivePlyScore = stonefishV55FivePlyScore;
  globalThis.stonefishV55FastCandidates = stonefishV55FastCandidates;
  globalThis.stonefishV55FinishCandidates = stonefishV55FinishCandidates;
  globalThis.stonefishV55AuditCandidate = stonefishV55AuditCandidate;
  globalThis.stonefishV55SortFinalScores = stonefishV55SortFinalScores;
}
