// Stonefish_v3
// Three-ply material engine:
// 1. Take mate in 1.
// 2. Avoid allowing mate in 1 whenever possible.
// 3. Maximise worst-case material swing across our move -> their reply -> our response.
// Bishops are worth 3.1 by default.

const STONEFISH_V3_OWN_VALUES = { p: 1, n: 3, b: 3.1, r: 5, q: 9, k: 1000 };
const STONEFISH_V3_OPPONENT_VALUES = { p: 1, n: 3, b: 3.1, r: 5, q: 9, k: 1000 };
const STONEFISH_V3_MATE_SCORE = 1000000;
const STONEFISH_V3_CACHE = new Map();
const STONEFISH_V3_LEGAL_CACHE = new Map();
const STONEFISH_V3_CACHE_LIMIT = 100000;

function stonefishV3Signature(values) {
  return `p${values.p}|n${values.n}|b${values.b}|r${values.r}|q${values.q}`;
}

function stonefishV3PositionKey(game) {
  if (typeof game.fastPositionKey === 'function') return game.fastPositionKey();
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
  if (typeof game.fastApply === 'function') return game.fastApply(move);
  return game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function stonefishV3Undo(game) {
  if (typeof game.fastUndo === 'function') return game.fastUndo();
  return game.undo();
}

function stonefishV3Random(moves) {
  if (!moves || moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function stonefishV3Type(game, piece) {
  if (!piece) return null;
  return typeof piece === 'number' ? game._typeChar(piece) : piece;
}

function stonefishV3Value(game, piece, values) {
  const type = stonefishV3Type(game, piece);
  return type ? (values[type] || 0) : 0;
}

function stonefishV3Compact(game, move) {
  if (typeof move.from === 'string') {
    return {
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      captured: move.captured || null,
      _raw: move._raw || null
    };
  }
  return {
    from: game._alg(move.from),
    to: game._alg(move.to),
    promotion: move.promotion ? game._typeChar(move.promotion) : null,
    captured: move.captured ? game._typeChar(move.captured) : null,
    _raw: move
  };
}

function stonefishV3LegalSummaries(game) {
  const key = stonefishV3PositionKey(game);
  const cached = STONEFISH_V3_LEGAL_CACHE.get(key);
  if (cached) return cached;

  let summaries;
  if (typeof game.fastMoves === 'function') {
    summaries = game.fastMoves().map(raw => ({
      from: game._alg(raw.from),
      to: game._alg(raw.to),
      promotion: raw.promotion ? game._typeChar(raw.promotion) : null,
      captured: raw.captured ? game._typeChar(raw.captured) : null,
      _raw: raw
    }));
  } else {
    summaries = game.moves({ verbose: true }).map(move => ({
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      captured: move.captured || null,
      _raw: null
    }));
  }

  stonefishV3TrimCache(STONEFISH_V3_LEGAL_CACHE);
  STONEFISH_V3_LEGAL_CACHE.set(key, summaries);
  return summaries;
}

function stonefishV3IsCurrentPositionMate(game, legalMoves) {
  return legalMoves.length === 0 && game.in_check();
}

function stonefishV3OrderedMoves(game, moves, values, descending = true) {
  // Sorting a shallow copy changes search order only, never the evaluated score.
  return moves.slice().sort((a, b) => {
    const av = stonefishV3Value(game, a.captured, values);
    const bv = stonefishV3Value(game, b.captured, values);
    return descending ? bv - av : av - bv;
  });
}

function getStonefishV3MoveWithValues(game, ownValues, opponentValues) {
  const cacheKey = stonefishV3ProfileKey(game, ownValues, opponentValues);
  const cached = STONEFISH_V3_CACHE.get(cacheKey);
  if (cached) return stonefishV3Random(cached);

  const legalMoves = stonefishV3LegalSummaries(game);
  if (legalMoves.length === 0) return null;

  // Try captures first. Strong candidate scores discovered early make the
  // exact minimax pruning below much more effective.
  const orderedMoves = stonefishV3OrderedMoves(game, legalMoves, opponentValues, true);
  const scored = [];
  const matingMoves = [];
  let bestCompletedScore = -Infinity;

  for (const move of orderedMoves) {
    const immediateGain = stonefishV3Value(game, move.captured, opponentValues);
    stonefishV3Play(game, move);

    const replies = stonefishV3LegalSummaries(game);
    if (stonefishV3IsCurrentPositionMate(game, replies)) {
      stonefishV3Undo(game);
      matingMoves.push(move);
      continue;
    }

    // The opponent tries its largest captures first. If a move is bad, this
    // tends to prove it quickly and lets us skip the rest of the replies.
    const orderedReplies = stonefishV3OrderedMoves(game, replies, ownValues, true);
    let allowsMateInOne = false;
    let worstCaseScore = orderedReplies.length ? Infinity : immediateGain;

    for (const reply of orderedReplies) {
      const opponentGain = stonefishV3Value(game, reply.captured, ownValues);
      stonefishV3Play(game, reply);

      const ourResponses = stonefishV3LegalSummaries(game);
      if (stonefishV3IsCurrentPositionMate(game, ourResponses)) {
        allowsMateInOne = true;
        worstCaseScore = -STONEFISH_V3_MATE_SCORE;
        stonefishV3Undo(game);
        break;
      }

      // Our best material response is normally found quickly by trying the
      // largest available captures first.
      const orderedResponses = stonefishV3OrderedMoves(game, ourResponses, opponentValues, true);
      let ourBestResponseGain = 0;

      for (const response of orderedResponses) {
        const gain = stonefishV3Value(game, response.captured, opponentValues);
        if (gain > ourBestResponseGain) ourBestResponseGain = gain;

        // Mate on our third ply outranks material. Only checking moves require
        // one more legal-move generation to establish checkmate.
        stonefishV3Play(game, response);
        if (game.in_check()) {
          const afterResponse = stonefishV3LegalSummaries(game);
          if (afterResponse.length === 0) {
            ourBestResponseGain = STONEFISH_V3_MATE_SCORE;
            stonefishV3Undo(game);
            break;
          }
        }
        stonefishV3Undo(game);
      }

      stonefishV3Undo(game);

      const score = immediateGain - opponentGain + ourBestResponseGain;
      if (score < worstCaseScore) worstCaseScore = score;

      // Exact minimax pruning: the opponent can already force this score. More
      // replies can only lower it further, so a candidate already below the
      // best completed safe candidate cannot become a winner or a tie.
      if (!allowsMateInOne && bestCompletedScore > -Infinity && worstCaseScore < bestCompletedScore) {
        break;
      }
    }

    stonefishV3Undo(game);
    scored.push({ move, allowsMateInOne, score: worstCaseScore });

    if (!allowsMateInOne && worstCaseScore > bestCompletedScore) {
      bestCompletedScore = worstCaseScore;
    }
  }

  if (matingMoves.length) {
    const bestMates = matingMoves.map(move => stonefishV3Compact(game, move));
    stonefishV3TrimCache(STONEFISH_V3_CACHE);
    STONEFISH_V3_CACHE.set(cacheKey, bestMates);
    return stonefishV3Random(bestMates);
  }

  const safe = scored.filter(candidate => !candidate.allowsMateInOne);
  const candidates = safe.length ? safe : scored;
  let bestScore = -Infinity;
  for (const candidate of candidates) if (candidate.score > bestScore) bestScore = candidate.score;

  const bestMoves = candidates
    .filter(candidate => Math.abs(candidate.score - bestScore) < 1e-9)
    .map(candidate => stonefishV3Compact(game, candidate.move));

  stonefishV3TrimCache(STONEFISH_V3_CACHE);
  STONEFISH_V3_CACHE.set(cacheKey, bestMoves);
  return stonefishV3Random(bestMoves);
}

function getStonefishV3Move(game) {
  return getStonefishV3MoveWithValues(game, STONEFISH_V3_OWN_VALUES, STONEFISH_V3_OPPONENT_VALUES);
}
