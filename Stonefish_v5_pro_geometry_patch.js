// Pro-aware root prepass with released-Pro adaptive leaves, optimized without
// changing the evaluation formula. The fast path reuses one position key across
// adaptive/context/base-position caches so unique leaves do less duplicate work.

const STONEFISH_V5_PRO_ROOT_PREPASS = 10;

function stonefishV5ProAdaptivePositionFast(game, perspective) {
  const positionKey = game.fastPositionKey();
  const adaptiveKey = perspective + '|' + game.fullmove + '|' + positionKey;
  const cachedAdaptive = STONEFISH_V5_PRO_ADAPTIVE_CACHE.get(adaptiveKey);
  if (cachedAdaptive !== undefined) return cachedAdaptive;

  let c = STONEFISH_V5_PRO_CONTEXT_CACHE.get(adaptiveKey);
  if (c === undefined) {
    c = stonefishV5ProSpeedBaseContexts(game, perspective);
    stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_CONTEXT_CACHE, adaptiveKey, c);
  }

  const positionScoreKey = perspective + '|' + positionKey;
  let score = STONEFISH_V5_PRO_POSITION_CACHE.get(positionScoreKey);
  if (score === undefined) {
    score = stonefishV5PositionScore(game, perspective);
    stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_POSITION_CACHE, positionScoreKey, score);
  }

  const mobility = game.fastMobility(perspective) - game.fastMobility(-perspective);
  const development = stonefishV4Development(game, perspective) - stonefishV4Development(game, -perspective);
  const kingProtection = stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, -perspective);
  const kingFreedom = stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, -perspective);
  const kingPlacement = stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, -perspective);
  const boardControl = stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, -perspective);
  const passers = stonefishV5PassedPawns(game, perspective) - stonefishV5PassedPawns(game, -perspective);

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
    const enemyMobility = game.fastMobility(-perspective);
    score -= enemyMobility * 2.5 * c.conversion;
    score += (stonefishV5Material(game, perspective) - stonefishV5Material(game, -perspective)) * 0.18 * c.conversion;
  }

  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_ADAPTIVE_CACHE, adaptiveKey, score);
}

stonefishV5ProAdaptivePosition = stonefishV5ProAdaptivePositionFast;

stonefishV5ProLeaf = function(game, perspective) {
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  return stonefishV5ProAdaptivePositionFast(game, perspective);
};

stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

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
    entry.knowledge = Math.abs(entry.tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(
          game, entry.raw, heritageMove, bookMove, perspective, entry.tactical
        );
    entry.preliminary = entry.tactical + entry.knowledge;
  }
  for (let i = semifinalCount; i < scored.length; i += 1) scored[i].preliminary = -Infinity;

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
      if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) entry.score = entry.deep;
      else entry.score = entry.deep * 1.35 + entry.preliminary * 0.38;
    }
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }

  for (let i = Math.min(STONEFISH_V5_PRO_SPEED_ROOT_CANDIDATES, semifinalCount); i < scored.length; i += 1) scored[i].score = -Infinity;

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
