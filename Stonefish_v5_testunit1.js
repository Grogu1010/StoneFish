// Stonefish_v5 testunit1 — frozen snapshot of the current strong v4.5 decision architecture.
// This intentionally preserves the current v4.5 behaviour before further v4.5 balancing.

const stonefishV5Testunit1BookMove = stonefishV45BookMove;
const stonefishV5Testunit1BestByInverse = stonefishV45BestByInverse;
const stonefishV5Testunit1PatternTieBreak = stonefishV45StrictPatternTieBreak;

function getStonefishV5Testunit1Move(game) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return null;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];

    if (criterion === 'mobility') {
      const book = stonefishV5Testunit1BookMove(game, 0, candidates);
      if (book) return stonefishV3PublicMove(game, book);

      candidates = stonefishV5Testunit1BestByInverse(game, candidates, 'oppCheckRisk');
      if (candidates.length > 1) {
        candidates = stonefishV5Testunit1BestByInverse(game, candidates, 'oppMobility');
      }
    }

    candidates = stonefishV4BestByCriterion(game, candidates, criterion);

    if (criterion === 'pieceSupport' && candidates.length > 1) {
      candidates = stonefishV5Testunit1PatternTieBreak(game, candidates);
    }
  }

  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
}
