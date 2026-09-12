// Temporary v5 Pro search-performance tuning while the architecture is validated.
// Depth stays at five plies; only branch width and leaf cost are reduced.

stonefishV5ProLeaf = function(game, perspective) {
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;

  let score = stonefishV5Material(game, perspective) - stonefishV5Material(game, -perspective);
  score += (game.fastMobility(perspective) - game.fastMobility(-perspective)) * 2;
  score += (stonefishV5PassedPawns(game, perspective) - stonefishV5PassedPawns(game, -perspective)) * 18;
  // Passed-pawn danger must remain loud at the cheap search leaf. This is what
  // lets the five-ply tree understand a quiet h6-h7 push before h8=Q appears.
  score += stonefishV5PasserStatus(game, perspective, perspective) * 0.50;
  score += stonefishV5PasserStatus(game, -perspective, perspective) * 0.50;
  return score;
};

stonefishV5ProMoveOrder = function(game, move) {
  const us = game.side;
  let score = (STONEFISH_V5_PIECE[move.captured] || 0) * 16 - (STONEFISH_V5_PIECE[move.piece] || 0);
  if (move.promotion) score += (STONEFISH_V5_PIECE[move.promotion] || 0) * 12;
  if (game.fastGivesCheck(move)) score += 1800;
  if (move.flags & (4 | 8)) score += 80;

  if (move.piece === 1) {
    const rank = move.to >> 3;
    const progress = us === 1 ? rank : 7 - rank;
    if (progress >= 5) score += (progress - 4) * 1000;
  }

  // Keep quiet blockade/capture moves in the selective tree when an enemy passer
  // is close. Without this, ordinary capture/check ordering can prune the only
  // move that stops a pawn race even though the search still reaches five plies.
  for (const passer of stonefishV5PassedPawnInfo(game, -us)) {
    if (move.to === passer.sq) score += 2800;
    const nextSq = passer.sq + (-us) * 8;
    if (move.to === nextSq) score += passer.distance <= 2 ? 2400 : 900;
    if (passer.distance <= 2 && (move.to & 7) === passer.file) score += 450;
  }
  return score;
};

stonefishV5ProMinimax = function(game, depth, perspective, alpha, beta, plyFromRoot) {
  const legal = game.fastMoves();
  if (!legal.length) {
    if (!game.in_check()) return 0;
    return game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return 0;
  if (depth <= 0) return stonefishV5ProLeaf(game, perspective);

  const widths = [0, 5, 6, 7, 8];
  const width = widths[depth] || 5;
  const ordered = legal
    .map(move => ({ move, order: stonefishV5ProMoveOrder(game, move) }))
    .sort((a, b) => b.order - a.order)
    .slice(0, width);

  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;

  for (const entry of ordered) {
    game.fastApply(entry.move);
    const value = stonefishV5ProMinimax(game, depth - 1, perspective, alpha, beta, plyFromRoot + 1);
    game.fastUndo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
};

stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  for (const raw of legal) {
    const tactical = stonefishV5TacticalScore(game, raw);
    const knowledge = Math.abs(tactical) >= STONEFISH_V5_MATE * 1.5 ? 0 : stonefishV5ProRootKnowledge(game, raw, heritageMove, bookMove, perspective, tactical);
    const preliminary = tactical + knowledge;
    scored.push({ raw, tactical, knowledge, preliminary, deep: null, score: preliminary });
  }

  scored.sort((a, b) => b.preliminary - a.preliminary || stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw)));
  const candidateCount = Math.min(8, scored.length);

  for (let i = 0; i < candidateCount; i += 1) {
    const entry = scored[i];
    entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
    if (Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9) entry.score = entry.deep;
    else entry.score = entry.deep * 1.35 + entry.preliminary * 0.38;
  }

  for (let i = candidateCount; i < scored.length; i += 1) scored[i].score = -Infinity;

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw), bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
};
