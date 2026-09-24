// Stonefish_v2.js
// Stonefish_v2
// Priorities:
// 1. Always play mate in 1 when available.
// 2. Avoid any move that allows the opponent to mate in 1, whenever possible.
// 3. Otherwise minimise the highest-value piece the opponent can capture next.

const STONEFISH_PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 1000 };
const STONEFISH_V2_CACHE = new Map();
const STONEFISH_V2_CACHE_LIMIT = 100000;

function stonefishV2Signature(values) {
  return `p${values.p}|n${values.n}|b${values.b}|r${values.r}|q${values.q}`;
}

function stonefishV2Key(game, values) {
  const pos = typeof game.fastPositionKey === 'function'
    ? game.fastPositionKey()
    : game.fen().split(' ').slice(0, 4).join(' ');
  return `${pos}|${stonefishV2Signature(values)}`;
}

function stonefishV2Trim() {
  if (STONEFISH_V2_CACHE.size >= STONEFISH_V2_CACHE_LIMIT) {
    STONEFISH_V2_CACHE.delete(STONEFISH_V2_CACHE.keys().next().value);
  }
}

function stonefishV2Public(game, move) {
  if (typeof move.from === 'string') return move;
  return {
    from: game._alg(move.from),
    to: game._alg(move.to),
    promotion: move.promotion ? game._typeChar(move.promotion) : undefined,
    captured: move.captured ? game._typeChar(move.captured) : undefined,
    _raw: move
  };
}

function stonefishV2Random(moves) {
  return moves[Math.floor(Math.random() * moves.length)];
}

function stonefishV2CaptureValue(game, move, values) {
  if (!move.captured) return 0;
  const type = typeof move.captured === 'number' ? game._typeChar(move.captured) : move.captured;
  return values[type] || 0;
}

function getStonefishV2MoveWithValues(game, values) {
  const key = stonefishV2Key(game, values);
  const cached = STONEFISH_V2_CACHE.get(key);
  if (cached) return stonefishV2Random(cached);

  const fast = typeof game.fastMoves === 'function';
  const moves = fast ? game.fastMoves() : game.moves({ verbose: true });
  if (!moves.length) return null;

  const mates = [];
  for (const move of moves) {
    const mate = fast ? game.fastIsMateMove(move) : Boolean(move.san && move.san.endsWith('#'));
    if (mate) mates.push(stonefishV2Public(game, move));
  }
  if (mates.length) {
    stonefishV2Trim();
    STONEFISH_V2_CACHE.set(key, mates);
    return stonefishV2Random(mates);
  }

  const scored = [];
  for (const move of moves) {
    if (fast) game.fastApply(move);
    else game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });

    const replies = fast ? game.fastMoves() : game.moves({ verbose: true });
    let allowsMateInOne = false;
    let maxCaptureValue = 0;

    for (const reply of replies) {
      const mate = fast ? game.fastIsMateMove(reply) : Boolean(reply.san && reply.san.endsWith('#'));
      if (mate) allowsMateInOne = true;
      const value = stonefishV2CaptureValue(game, reply, values);
      if (value > maxCaptureValue) maxCaptureValue = value;
    }

    if (fast) game.fastUndo(); else game.undo();
    scored.push({ move, allowsMateInOne, maxCaptureValue });
  }

  const safe = scored.filter(s => !s.allowsMateInOne);
  const candidates = safe.length ? safe : scored;
  let bestRisk = Infinity;
  for (const s of candidates) if (s.maxCaptureValue < bestRisk) bestRisk = s.maxCaptureValue;

  const best = candidates
    .filter(s => s.maxCaptureValue === bestRisk)
    .map(s => stonefishV2Public(game, s.move));

  stonefishV2Trim();
  STONEFISH_V2_CACHE.set(key, best);
  return stonefishV2Random(best);
}

function getStonefishV2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_PIECE_VALUES);
}
