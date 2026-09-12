// Temporary v5 Pro performance tuning while the architecture is validated.
// This preserves the original five-ply tree, leaf evaluation, root shortlist,
// and move-order scores exactly. It only avoids recomputing the same ordering
// score many times inside Array.sort.

stonefishV5ProMinimax = function(game, depth, perspective, alpha, beta, plyFromRoot) {
  const legal = game.fastMoves();
  if (!legal.length) {
    if (!game.in_check()) return 0;
    return game.side === perspective ? -STONEFISH_V5_PRO_MATE + plyFromRoot : STONEFISH_V5_PRO_MATE - plyFromRoot;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) return 0;
  if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return 0;
  if (depth <= 0) return stonefishV5ProLeaf(game, perspective);

  const width = STONEFISH_V5_PRO_BRANCH[depth] || 8;
  const ordered = legal
    .map((move, index) => ({ move, index, order: stonefishV5ProMoveOrder(game, move) }))
    .sort((a, b) => (b.order - a.order) || (a.index - b.index))
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
