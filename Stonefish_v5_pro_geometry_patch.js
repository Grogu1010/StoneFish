// Stonefish v5 Pro recovery layer.
//
// The fast candidate proved the speed target (100-0-0 vs v5 while no slower
// than v5) but lost too much strength against released Pro on varied openings.
// Diagnostics found two distinct causes:
//   1) strong quiet moves were sometimes filtered before tactical/deep search;
//   2) the cheap v5 leaf disagreed sharply with released Pro's adaptive leaf.
//
// This layer fixes both without returning to released Pro's huge search tree:
// - exact-semantics tactical scoring for every legal root move, implemented with
//   early legal-existence tests instead of repeated full mate move generation,
// - released-Pro preliminary ranking across the full legal root set,
// - a fused adaptive evaluator that is mathematically equivalent to released
//   Pro's adaptive leaf but reuses feature calculations instead of recomputing
//   mobility/development/king terms,
// - the proven narrow five-ply alpha-beta tree, checked-leaf extension and
//   passer-aware move ordering from the fast candidate.

const STONEFISH_V5_PRO_RECOVERY_ROOT_CANDIDATES = 4;
const STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE = new Map();
const stonefishV5ProRecoveryReferenceAdaptive = stonefishV5ProAdaptivePosition;
const stonefishV5ProRecoveryReferenceTactical = stonefishV5TacticalScore;

function stonefishV5ProRecoveryCacheSet(cache, key, value) {
  if (cache.size >= STONEFISH_V5_PRO_SPEED_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

// Fused form of released Pro's stonefishV5ProAdaptivePosition.
//
// stonefishV5PositionScore already computes mobility, development, king
// protection/freedom/placement, board control and passed pawns. Released Pro
// then computed all of those again for its adaptive increments. Compute each
// difference once and apply both the v5 base weight and Pro adaptive increment.
stonefishV5ProAdaptivePosition = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE.get(key);
  if (cached !== undefined) return cached;

  const enemy = -perspective;
  const c = stonefishV5ProContexts(game, perspective);

  const ourMobility = game.fastMobility(perspective);
  const enemyMobility = game.fastMobility(enemy);
  const mobility = ourMobility - enemyMobility;
  const development = stonefishV4Development(game, perspective) - stonefishV4Development(game, enemy);
  const center = stonefishV4CenterControl(game, perspective) - stonefishV4CenterControl(game, enemy);
  const minorCentral = stonefishV4MinorCentralization(game, perspective) - stonefishV4MinorCentralization(game, enemy);
  const kingProtection = stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, enemy);
  const kingFreedom = stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, enemy);
  const pawnStructure = stonefishV4PawnStructure(game, perspective) - stonefishV4PawnStructure(game, enemy);
  const rookActivity = stonefishV4RookActivity(game, perspective) - stonefishV4RookActivity(game, enemy);
  const kingPlacement = stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, enemy);
  const boardControl = stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, enemy);
  const hanging = stonefishV4HangingMax(game, perspective) - stonefishV4HangingMax(game, enemy);
  const bishopPair = stonefishV5BishopPair(game, perspective) - stonefishV5BishopPair(game, enemy);
  const passers = stonefishV5PassedPawns(game, perspective) - stonefishV5PassedPawns(game, enemy);

  let score = c.lead;
  score += mobility * STONEFISH_V5_WEIGHTS.mobility;
  score += development * STONEFISH_V5_WEIGHTS.development;
  score += center * STONEFISH_V5_WEIGHTS.center;
  score += minorCentral * STONEFISH_V5_WEIGHTS.minorCentral;
  score += kingProtection * STONEFISH_V5_WEIGHTS.kingProtection;
  score += kingFreedom * STONEFISH_V5_WEIGHTS.kingFreedom;
  score += pawnStructure * STONEFISH_V5_WEIGHTS.pawnStructure;
  score += rookActivity * STONEFISH_V5_WEIGHTS.rookActivity;
  score += kingPlacement * STONEFISH_V5_WEIGHTS.kingPlacement;
  score += boardControl * STONEFISH_V5_WEIGHTS.boardControl;
  score += hanging * STONEFISH_V5_WEIGHTS.hanging;
  score += bishopPair * STONEFISH_V5_WEIGHTS.bishopPair;
  score += passers * STONEFISH_V5_WEIGHTS.passedPawn;

  score += mobility * (2 + c.attack * 2.5 + c.defence * 1.5);
  score += development * (9 * c.opening);
  score += kingProtection * (5 + 18 * c.defence + 8 * c.attack);
  score += kingFreedom * (3 + 10 * c.endgame);
  score += kingPlacement * (5 + 17 * c.endgame);
  score += boardControl * (1.5 + 4 * c.attack);
  score += passers * (18 + 45 * c.endgame + 65 * c.pawnRace);
  score += stonefishV5ProLooseAndCoordination(game, perspective) * (1.0 + 0.35 * c.defence);
  score += stonefishV5ProRayTactics(game, perspective) * (1.0 + 0.55 * c.attack);
  score += (c.attackPressure - c.defencePressure) * (24 + 22 * c.attack + 18 * c.defence);

  if (c.conversion > 0) {
    score -= enemyMobility * 2.5 * c.conversion;
    score += c.lead * 0.18 * c.conversion;
  }

  return stonefishV5ProRecoveryCacheSet(
    STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE,
    key,
    score
  );
};

// Restore released Pro's adaptive leaf quality. Draw/terminal handling remains
// in the selective minimax wrapper from the speed layer.
stonefishV5ProLeaf = function(game, perspective) {
  return stonefishV5ProAdaptivePosition(game, perspective);
};

function stonefishV5ProFastMateAfterApplied(game) {
  return game.in_check() && !game.fastHasLegalMove();
}

// Exact semantic replacement for stonefishV5BestResponseGain, but a mating
// response only asks whether a legal reply exists instead of constructing the
// entire reply list.
function stonefishV5ProBestResponseGainExactFast(game, responses) {
  let best = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const response = responses[i];
    const givesCheck = game.fastGivesCheck(response);

    if (givesCheck) {
      game.fastApply(response);
      const mates = stonefishV5ProFastMateAfterApplied(game);
      game.fastUndo();
      if (mates) return STONEFISH_V5_MATE;
    }

    let gain = STONEFISH_V5_PIECE[response.captured] || 0;
    if (response.promotion) {
      gain += (STONEFISH_V5_PIECE[response.promotion] || 0) - 100;
    }
    if (givesCheck) gain += 18;
    if (gain > best) best = gain;
  }
  return best;
}

// Same score as stonefishV5TacticalScore, with duplicate mate move generation
// fused into the move/reply traversal. This makes full-root tactical coverage
// practical without changing v5 itself or weakening the speed comparison.
function stonefishV5ProTacticalScoreExactFast(game, raw) {
  let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
  if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

  game.fastApply(raw);
  const replies = game.fastMoves();
  if (!replies.length) {
    const score = game.in_check() ? STONEFISH_V5_MATE : 0;
    game.fastUndo();
    return score;
  }

  let worst = Infinity;
  for (let i = 0; i < replies.length; i += 1) {
    const reply = replies[i];
    const givesCheck = game.fastGivesCheck(reply);

    let opponentGain = STONEFISH_V5_PIECE[reply.captured] || 0;
    if (reply.promotion) {
      opponentGain += (STONEFISH_V5_PIECE[reply.promotion] || 0) - 100;
    }
    if (givesCheck) opponentGain += 14;

    game.fastApply(reply);
    const responses = game.fastMoves();

    if (!responses.length && game.in_check()) {
      game.fastUndo();
      game.fastUndo();
      return -STONEFISH_V5_MATE;
    }

    const ourGain = stonefishV5ProBestResponseGainExactFast(game, responses);
    game.fastUndo();

    const branch = immediate - opponentGain + ourGain;
    if (branch < worst) worst = branch;
  }

  game.fastUndo();
  return worst;
}

// Released-Pro root semantics across every legal move, followed by the proven
// fast four-candidate five-ply tree. The checked-leaf extension and selective
// danger widening still come from Stonefish_v5_pro_speed_patch.js.
stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];

  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  for (let i = 0; i < legal.length; i += 1) {
    const raw = legal[i];
    const tactical = stonefishV5ProTacticalScoreExactFast(game, raw);
    const knowledge = Math.abs(tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(
          game, raw, heritageMove, bookMove, perspective, tactical
        );
    const preliminary = tactical + knowledge;
    scored.push({
      raw,
      tactical,
      knowledge,
      scout: knowledge,
      heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
      preliminary,
      deep: null,
      score: -Infinity
    });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.preliminary - a.preliminary) > 1e-9) {
      return b.preliminary - a.preliminary;
    }
    const au = stonefishV45RawUci(game, a.raw);
    const bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    const finalistCount = Math.min(
      STONEFISH_V5_PRO_RECOVERY_ROOT_CANDIDATES,
      scored.length
    );
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

  for (let i = Math.min(
    STONEFISH_V5_PRO_RECOVERY_ROOT_CANDIDATES,
    scored.length
  ); i < scored.length; i += 1) {
    scored[i].score = -Infinity;
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw);
    const bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
