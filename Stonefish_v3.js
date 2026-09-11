// Stonefish_v3
// Three-ply material engine:
// 1. Take mate in 1.
// 2. Avoid allowing mate in 1 whenever possible.
// 3. For every move, maximise the worst-case material swing across:
//    our move -> opponent reply -> our best response.
// Bishops are worth 3.1 by default.

const STONEFISH_V3_OWN_VALUES = { p: 1, n: 3, b: 3.1, r: 5, q: 9, k: 1000 };
const STONEFISH_V3_OPPONENT_VALUES = { p: 1, n: 3, b: 3.1, r: 5, q: 9, k: 1000 };
const STONEFISH_V3_MATE_SCORE = 1000000;
const STONEFISH_V3_CACHE = new Map();
const STONEFISH_V3_RESPONSE_CACHE = new Map();
const STONEFISH_V3_CACHE_LIMIT = 50000;

function stonefishV3Signature(values) {
  return `p${values.p}|n${values.n}|b${values.b}|r${values.r}|q${values.q}`;
}

function stonefishV3PositionKey(game) {
  return game.fen().split(' ').slice(0, 4).join(' ');
}

function stonefishV3ProfileKey(game, ownValues, opponentValues) {
  return `${stonefishV3PositionKey(game)}|own:${stonefishV3Signature(ownValues)}|opp:${stonefishV3Signature(opponentValues)}`;
}

function stonefishV3TrimCache(cache) {
  if (cache.size < STONEFISH_V3_CACHE_LIMIT) return;
  cache.delete(cache.keys().next().value);
}

function stonefishV3Play(game, move) {
  return game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function stonefishV3Random(moves) {
  if (!moves || moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function stonefishV3Compact(move) {
  return { from: move.from, to: move.to, promotion: move.promotion || null };
}

function stonefishV3BestResponseGain(game, opponentValues) {
  const key = `${stonefishV3PositionKey(game)}|gain:${stonefishV3Signature(opponentValues)}`;
  const cached = STONEFISH_V3_RESPONSE_CACHE.get(key);
  if (cached !== undefined) return cached;

  const responses = game.moves({ verbose: true });
  let best = 0;

  for (const response of responses) {
    if (response.san && response.san.endsWith('#')) {
      best = STONEFISH_V3_MATE_SCORE;
      break;
    }

    if (response.captured) {
      const gain = opponentValues[response.captured] || 0;
      if (gain > best) best = gain;
    }
  }

  stonefishV3TrimCache(STONEFISH_V3_RESPONSE_CACHE);
  STONEFISH_V3_RESPONSE_CACHE.set(key, best);
  return best;
}

function getStonefishV3MoveWithValues(game, ownValues, opponentValues) {
  const cacheKey = stonefishV3ProfileKey(game, ownValues, opponentValues);
  const cached = STONEFISH_V3_CACHE.get(cacheKey);
  if (cached) return stonefishV3Random(cached);

  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  const matingMoves = legalMoves.filter(move => move.san && move.san.endsWith('#'));
  if (matingMoves.length > 0) {
    const compact = matingMoves.map(stonefishV3Compact);
    stonefishV3TrimCache(STONEFISH_V3_CACHE);
    STONEFISH_V3_CACHE.set(cacheKey, compact);
    return stonefishV3Random(compact);
  }

  const scored = [];

  for (const move of legalMoves) {
    const immediateGain = move.captured ? (opponentValues[move.captured] || 0) : 0;
    stonefishV3Play(game, move);

    const replies = game.moves({ verbose: true });
    let allowsMateInOne = false;
    let worstCaseScore = Infinity;

    if (replies.length === 0) worstCaseScore = immediateGain;

    for (const reply of replies) {
      if (reply.san && reply.san.endsWith('#')) {
        allowsMateInOne = true;
        worstCaseScore = -STONEFISH_V3_MATE_SCORE;
        continue;
      }

      const opponentGain = reply.captured ? (ownValues[reply.captured] || 0) : 0;
      stonefishV3Play(game, reply);
      const ourBestResponseGain = stonefishV3BestResponseGain(game, opponentValues);
      game.undo();

      const score = immediateGain - opponentGain + ourBestResponseGain;
      if (score < worstCaseScore) worstCaseScore = score;
    }

    game.undo();
    scored.push({ move, allowsMateInOne, score: worstCaseScore });
  }

  const safe = scored.filter(candidate => !candidate.allowsMateInOne);
  const candidates = safe.length > 0 ? safe : scored;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (candidate.score > bestScore) bestScore = candidate.score;
  }

  const bestMoves = candidates
    .filter(candidate => Math.abs(candidate.score - bestScore) < 1e-9)
    .map(candidate => stonefishV3Compact(candidate.move));

  stonefishV3TrimCache(STONEFISH_V3_CACHE);
  STONEFISH_V3_CACHE.set(cacheKey, bestMoves);
  return stonefishV3Random(bestMoves);
}

function getStonefishV3Move(game) {
  return getStonefishV3MoveWithValues(game, STONEFISH_V3_OWN_VALUES, STONEFISH_V3_OPPONENT_VALUES);
}
