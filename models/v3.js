// Stonefish_v3.js
// Stonefish_v3
// Three-ply material engine:
// 1. Take mate in 1.
// 2. Avoid allowing mate in 1 whenever possible.
// 3. Maximise worst-case material swing across our move -> their reply -> our response.
// Bishops are worth 3.1.

const STONEFISH_V3_OWN_VALUES = { p: 1, n: 3, b: 3.1, r: 5, q: 9, k: 1000 };
const STONEFISH_V3_VALUES = [0, 1, 3, 3.1, 5, 9, 1000];
const STONEFISH_V3_MATE_SCORE = 1000000;
const STONEFISH_V3_CACHE = new Map();
const STONEFISH_V3_CACHE_LIMIT = 50000;

function stonefishV3TrimCache() {
  if (STONEFISH_V3_CACHE.size < STONEFISH_V3_CACHE_LIMIT) return;
  STONEFISH_V3_CACHE.delete(STONEFISH_V3_CACHE.keys().next().value);
}

function stonefishV3CloneRaw(move) {
  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion || 0,
    flags: move.flags || 0,
    piece: move.piece || 0,
    captured: move.captured || 0
  };
}

function stonefishV3PublicMove(game, raw) {
  return {
    from: game._alg(raw.from),
    to: game._alg(raw.to),
    promotion: raw.promotion ? game._typeChar(raw.promotion) : null,
    captured: raw.captured ? game._typeChar(raw.captured) : null,
    _raw: raw
  };
}

function stonefishV3RandomRaw(moves) {
  if (!moves || !moves.length) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function stonefishV3OrderByCapture(moves) {
  return moves.slice().sort((a, b) => STONEFISH_V3_VALUES[b.captured] - STONEFISH_V3_VALUES[a.captured]);
}

function stonefishV3BestThirdPlyGain(game, responses) {
  let best = 0;

  for (let i = 0; i < responses.length; i += 1) {
    const response = responses[i];
    const gain = STONEFISH_V3_VALUES[response.captured];
    if (gain > best) best = gain;

    // Mate on our response beats every material result. Most responses are not
    // checks, so use the board-only check test before doing another legal-move generation.
    if (game.fastGivesCheck(response)) {
      game.fastApply(response);
      const mate = game.fastMoves().length === 0;
      game.fastUndo();
      if (mate) return STONEFISH_V3_MATE_SCORE;
    }
  }

  return best;
}

function getStonefishV3BestRawMoves(game) {
  const cacheKey = game.fastPositionKey();
  const cached = STONEFISH_V3_CACHE.get(cacheKey);
  if (cached) return cached;

  const legalMoves = game.fastMoves();
  if (!legalMoves.length) return [];

  const orderedMoves = stonefishV3OrderByCapture(legalMoves);
  const matingMoves = [];
  const scored = [];
  let bestCompletedSafeScore = -Infinity;

  for (let moveIndex = 0; moveIndex < orderedMoves.length; moveIndex += 1) {
    const move = orderedMoves[moveIndex];
    const immediateGain = STONEFISH_V3_VALUES[move.captured];
    game.fastApply(move);

    const replies = game.fastMoves();
    if (!replies.length && game.in_check()) {
      game.fastUndo();
      matingMoves.push(move);
      continue;
    }

    const orderedReplies = stonefishV3OrderByCapture(replies);
    let allowsMateInOne = false;
    let worstCaseScore = orderedReplies.length ? Infinity : immediateGain;
    let pruned = false;

    for (let replyIndex = 0; replyIndex < orderedReplies.length; replyIndex += 1) {
      const reply = orderedReplies[replyIndex];
      const opponentGain = STONEFISH_V3_VALUES[reply.captured];
      game.fastApply(reply);

      const ourResponses = game.fastMoves();
      if (!ourResponses.length && game.in_check()) {
        allowsMateInOne = true;
        worstCaseScore = -STONEFISH_V3_MATE_SCORE;
        game.fastUndo();
        break;
      }

      const ourBestResponseGain = stonefishV3BestThirdPlyGain(game, ourResponses);
      game.fastUndo();

      const score = immediateGain - opponentGain + ourBestResponseGain;
      if (score < worstCaseScore) worstCaseScore = score;

      // Once a fully-evaluated safe move already exists, this candidate cannot
      // recover from a lower worst-case score: more opponent replies can only
      // keep or lower its minimum. Drop the branch without changing the result.
      if (bestCompletedSafeScore > -Infinity && worstCaseScore < bestCompletedSafeScore) {
        pruned = true;
        break;
      }
    }

    game.fastUndo();
    if (pruned) continue;

    scored.push({ move, allowsMateInOne, score: worstCaseScore });
    if (!allowsMateInOne && worstCaseScore > bestCompletedSafeScore) {
      bestCompletedSafeScore = worstCaseScore;
    }
  }

  let bestRawMoves;

  if (matingMoves.length) {
    bestRawMoves = matingMoves.map(stonefishV3CloneRaw);
  } else {
    const safe = scored.filter(candidate => !candidate.allowsMateInOne);
    const candidates = safe.length ? safe : scored;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i += 1) {
      if (candidates[i].score > bestScore) bestScore = candidates[i].score;
    }
    bestRawMoves = candidates
      .filter(candidate => Math.abs(candidate.score - bestScore) < 1e-9)
      .map(candidate => stonefishV3CloneRaw(candidate.move));
  }

  stonefishV3TrimCache();
  STONEFISH_V3_CACHE.set(cacheKey, bestRawMoves);
  return bestRawMoves;
}

function getStonefishV3Move(game) {
  const raw = stonefishV3RandomRaw(getStonefishV3BestRawMoves(game));
  return raw ? stonefishV3PublicMove(game, raw) : null;
}
