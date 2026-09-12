// Experimental fast-leaf geometry for v5 Pro.
// Adds a focused subset of Pro tactical geometry to the proven fast static leaf.

const STONEFISH_V5_PRO_GEOMETRY_CACHE = new Map();

stonefishV5ProLeaf = function(game, perspective) {
  const key = perspective + '|' + game.fastPositionKey();
  const hit = STONEFISH_V5_PRO_GEOMETRY_CACHE.get(key);
  if (hit !== undefined) return hit;

  let score = stonefishV5ProCachedPositionScore(game, perspective);
  const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
  const ourThreat = stonefishV5EnemyPasserThreat(game, -perspective);
  if (enemyThreat >= 2200) score -= enemyThreat * 1.35;
  else if (enemyThreat >= 900) score -= enemyThreat * 0.55;
  if (ourThreat >= 2200) score += ourThreat * 0.42;
  else if (ourThreat >= 900) score += ourThreat * 0.18;

  const ourKingPressure = stonefishV5ProKingZonePressure(game, perspective);
  const theirKingPressure = stonefishV5ProKingZonePressure(game, -perspective);
  score += (ourKingPressure - theirKingPressure) * 32;
  score += stonefishV5ProRayTactics(game, perspective) * 1.10;
  score += stonefishV5ProLooseAndCoordination(game, perspective) * 0.65;

  return stonefishV5ProSpeedCacheSet(STONEFISH_V5_PRO_GEOMETRY_CACHE, key, score);
};

// Geometry-aware leaves are more trustworthy than the cheap baseline, so spend
// a little more search budget without jumping to the failed aggressive width.
STONEFISH_V5_PRO_SPEED_BRANCH[1] = 3;
STONEFISH_V5_PRO_SPEED_BRANCH[2] = 3;
STONEFISH_V5_PRO_SPEED_BRANCH[3] = 4;
STONEFISH_V5_PRO_SPEED_BRANCH[4] = 6;
