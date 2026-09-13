// Stonefish v5.5 native search core — Guarded PVS.
//
// v5.5 keeps v5 Pro's evaluation/knowledge and retains four serious root
// finalists, matching Pro's candidate coverage while using a much narrower
// internal five-ply tree. True principal-variation probes, safe exact
// transposition reuse and late-move reductions keep the wider root set cheap.
// The separate native Refutation Guard can inject a missed opponent reply into
// this same search; ARMX-preview is no longer part of the search core.

const STONEFISH_V5_5_SEARCH = Object.freeze({
  name: 'Guarded PVS',
  semifinalists: 7,
  rootCandidates: 4,
  rootProbeKeep: 2,
  branch: [0, 1, 2, 2, 4],
  lmrMinDepth: 3,
  lmrAfterMove: 2,
  pvsEpsilon: 1e-6,
  tacticalWeight: 1.10,
  scoutWeight: 0.20,
  heritageMultiplier: 0.75,
  conversionWeight: 0.50,
});

let STONEFISH_V5_5_LAST_SEARCH_STATS = null;
let STONEFISH_V5_5_ACTIVE_TT = null;

function stonefishV55IsTactical(game, move) {
  return Boolean(move.captured || move.promotion || (game.fastGivesCheck && game.fastGivesCheck(move)));
}

function stonefishV55SameRaw(a, b) {
  return Boolean(a && b && a.from === b.from && a.to === b.to
    && (a.promotion || 0) === (b.promotion || 0) && (a.flags || 0) === (b.flags || 0));
}

function stonefishV55RawKey(move) {
  return move ? `${move.from}:${move.to}:${move.promotion || 0}:${move.flags || 0}` : '-';
}

function stonefishV55TTKey(game, depth, perspective, plyFromRoot, injectedMove) {
  return `${perspective}|${depth}|${plyFromRoot}|${game.halfmove}|${stonefishV55RawKey(injectedMove)}|${game.fastPositionKey()}`;
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

  const tt = STONEFISH_V5_5_ACTIVE_TT;
  const ttKey = tt ? stonefishV55TTKey(game, depth, perspective, plyFromRoot, injectedMove) : null;
  if (tt) {
    const hit = tt.get(ttKey);
    if (hit !== undefined) {
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.ttHits += 1;
      return hit;
    }
  }

  const legal = game.fastMoves();
  const terminal = stonefishV55Terminal(game, perspective, plyFromRoot, legal);
  if (terminal !== null) {
    if (tt) tt.set(ttKey, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) {
    if (tt) tt.set(ttKey, 0);
    return 0;
  }

  const ordered = stonefishV55Ordered(game, legal, depth, injectedMove);
  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;
  let exact = true;

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
      } else {
        exact = false;
      }
    } else {
      const eps = STONEFISH_V5_5_SEARCH.pvsEpsilon;
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.pvsProbes += 1;
      if (maximizing) {
        const probeBeta = Math.min(beta, alpha + eps);
        value = stonefishV55Minimax(game, depth - 1, perspective, alpha, probeBeta, plyFromRoot + 1, null);
        if (value > alpha && value < beta) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
        }
      } else {
        const probeAlpha = Math.max(alpha, beta - eps);
        value = stonefishV55Minimax(game, depth - 1, perspective, probeAlpha, beta, plyFromRoot + 1, null);
        if (value < beta && value > alpha) {
          if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.researches += 1;
          value = stonefishV55Minimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1, null);
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
      cutoff = true;
      if (STONEFISH_V5_5_LAST_SEARCH_STATS) STONEFISH_V5_5_LAST_SEARCH_STATS.cutoffs += 1;
      break;
    }
  }

  if (tt && !cutoff && exact) tt.set(ttKey, best);
  return best;
}

function stonefishV55ResetSearchStats() {
  STONEFISH_V5_5_LAST_SEARCH_STATS = {
    nodes: 0,
    leaves: 0,
    reductions: 0,
    pvsProbes: 0,
    researches: 0,
    cutoffs: 0,
    ttHits: 0,
  };
}

function stonefishV55FivePlyWindowScore(game, raw, perspective, alpha, beta, injectedReply = null) {
  const historyDepth = game.historyStack.length;
  stonefishV55ResetSearchStats();
  try {
    game.fastApply(raw);
    const legal = game.fastMoves();
    if (!legal.length) return game.in_check() ? STONEFISH_V5_PRO_MATE - 1 : 0;
    return stonefishV55Minimax(game, 4, perspective, alpha, beta, 1, injectedReply);
  } finally {
    while (game.historyStack.length > historyDepth) game.fastUndo();
  }
}

function stonefishV55FivePlyScore(game, raw, perspective, injectedReply = null) {
  return stonefishV55FivePlyWindowScore(
    game,
    raw,
    perspective,
    -STONEFISH_V5_PRO_MATE,
    STONEFISH_V5_PRO_MATE,
    injectedReply
  );
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
    knowledge: 0,
    conversion: 0,
    heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
    scout: stonefishV5ProFastScoutScore(game, raw, bookMove, heritageMove, perspective),
    preliminary: -Infinity,
    deep: null,
    score: -Infinity,
  }));
  scored.v55Context = { legal, perspective, bookMove, heritageMove };

  scored.sort((a, b) => {
    if (Math.abs(b.scout - a.scout) > 1e-9) return b.scout - a.scout;
    return stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw));
  });

  const n = Math.min(STONEFISH_V5_5_SEARCH.semifinalists, scored.length);
  for (let i = 0; i < n; i += 1) {
    const entry = scored[i];
    entry.tactical = stonefishV5TacticalScore(game, entry.raw);
    const heritageBoost = entry.heritageMatch
      ? STONEFISH_V5_WEIGHTS.heritage * STONEFISH_V5_5_SEARCH.heritageMultiplier
      : 0;
    entry.conversion = stonefishV5ProConversionUrgency(game, entry.raw, perspective);
    entry.preliminary = entry.tactical * STONEFISH_V5_5_SEARCH.tacticalWeight
      + entry.scout * STONEFISH_V5_5_SEARCH.scoutWeight
      + heritageBoost
      + entry.conversion * STONEFISH_V5_5_SEARCH.conversionWeight;
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
  return scored;
}

function stonefishV55RootSecondScore(entries) {
  let first = -Infinity;
  let second = -Infinity;
  for (const entry of entries) {
    if (!entry || !Number.isFinite(entry.score)) continue;
    if (entry.score > first) {
      second = first;
      first = entry.score;
    } else if (entry.score > second) {
      second = entry.score;
    }
  }
  return second;
}

function stonefishV55RootProbeThreshold(entry, secondScore) {
  if (!Number.isFinite(secondScore)) return null;
  const heritageFloor = entry.heritageMatch
    ? entry.preliminary * STONEFISH_V5_PRO_HERITAGE_FLOOR
    : -Infinity;
  if (heritageFloor >= secondScore - 1e-9) return null;
  if (secondScore <= -STONEFISH_V5_PRO_MATE * 0.9) return null;
  if (secondScore >= STONEFISH_V5_PRO_MATE * 0.9) return secondScore;
  return (secondScore - entry.preliminary * 0.46) / 1.28;
}

function stonefishV55FinishCandidates(game, ranked) {
  if (!ranked.length) return [];
  const context = ranked.v55Context || null;
  const perspective = context ? context.perspective : game.side;
  const legal = context ? context.legal : ranked.map(entry => entry.raw);
  const bookMove = context ? context.bookMove : stonefishV45BookMove(game, 1, legal);
  const heritageMove = context ? context.heritageMove : stonefishV5HeritageMove(game);
  const finalists = Math.min(STONEFISH_V5_5_SEARCH.rootCandidates, ranked.length);
  const oldTT = STONEFISH_V5_5_ACTIVE_TT;
  const rootTT = new Map();
  ranked.v55SearchTT = rootTT;
  STONEFISH_V5_5_ACTIVE_TT = rootTT;

  try {
    // Root knowledge is cheap relative to the five-ply search. Compute it for all
    // four finalists first so the lower finalists can be probed against the exact
    // score needed to enter the current top two.
    for (let i = 0; i < finalists; i += 1) {
      const entry = ranked[i];
      entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
        ? 0
        : stonefishV5ProRootKnowledge(game, entry.raw, heritageMove, bookMove, perspective, entry.tactical);
      entry.preliminary = entry.tactical + entry.knowledge + entry.conversion;
      entry.refutationGuardCriticalReply = null;
      entry.rootProbeOnly = false;
      entry.rootProbeBound = null;
      entry.deep = null;
      entry.score = -Infinity;
    }

    const keep = Math.min(STONEFISH_V5_5_SEARCH.rootProbeKeep, finalists);
    const exact = [];
    for (let i = 0; i < keep; i += 1) {
      const entry = ranked[i];
      entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, null);
      entry.score = stonefishV55RecomputeFinalScore(entry);
      exact.push(entry);
    }

    for (let i = keep; i < finalists; i += 1) {
      const entry = ranked[i];
      const secondScore = stonefishV55RootSecondScore(exact);
      const threshold = stonefishV55RootProbeThreshold(entry, secondScore);
      let needsFullSearch = threshold === null;

      if (!needsFullSearch) {
        const alpha = Math.max(-STONEFISH_V5_PRO_MATE, threshold);
        const beta = Math.min(STONEFISH_V5_PRO_MATE, alpha + STONEFISH_V5_5_SEARCH.pvsEpsilon);
        const probe = stonefishV55FivePlyWindowScore(game, entry.raw, perspective, alpha, beta, null);
        entry.rootProbeBound = probe;
        if (probe > alpha + STONEFISH_V5_5_SEARCH.pvsEpsilon * 0.5) {
          needsFullSearch = true;
        } else {
          // The zero-window search proved this candidate cannot enter the exact
          // top two under the same final-score formula. ARMX only consumes those
          // exact top two, so no full search is needed here.
          entry.rootProbeOnly = true;
          entry.deep = probe;
          entry.score = -Infinity;
        }
      }

      if (needsFullSearch) {
        entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, null);
        entry.score = stonefishV55RecomputeFinalScore(entry);
        exact.push(entry);
      }
    }
  } finally {
    STONEFISH_V5_5_ACTIVE_TT = oldTT;
  }

  for (let i = finalists; i < ranked.length; i += 1) ranked[i].score = -Infinity;
  return stonefishV55SortFinalScores(game, ranked);
}

function stonefishV55VerifyInjectedReply(game, entry, perspective, injectedReply, reusableTT = null) {
  if (!entry || !injectedReply) return entry;
  entry.refutationGuardOriginalDeep = entry.deep;
  entry.refutationGuardCriticalReply = injectedReply;
  const oldTT = STONEFISH_V5_5_ACTIVE_TT;
  STONEFISH_V5_5_ACTIVE_TT = reusableTT || new Map();
  try {
    entry.deep = stonefishV55FivePlyScore(game, entry.raw, perspective, injectedReply);
  } finally {
    STONEFISH_V5_5_ACTIVE_TT = oldTT;
  }
  entry.score = stonefishV55RecomputeFinalScore(entry);
  entry.refutationGuardVerifiedDeep = entry.deep;
  return entry;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_SEARCH = STONEFISH_V5_5_SEARCH;
  globalThis.stonefishV55Minimax = stonefishV55Minimax;
  globalThis.stonefishV55FivePlyScore = stonefishV55FivePlyScore;
  globalThis.stonefishV55FivePlyWindowScore = stonefishV55FivePlyWindowScore;
  globalThis.stonefishV55FastCandidates = stonefishV55FastCandidates;
  globalThis.stonefishV55FinishCandidates = stonefishV55FinishCandidates;
  globalThis.stonefishV55VerifyInjectedReply = stonefishV55VerifyInjectedReply;
  globalThis.stonefishV55SortFinalScores = stonefishV55SortFinalScores;
}