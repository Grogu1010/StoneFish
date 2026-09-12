// Strength-first v5 Pro optimization layer.
//
// Preserve the strongest tested root-fusion model exactly, but stop analyzing
// every legal root move twice. The recovery tactical scorer and Pro root
// knowledge both apply the same root move, generate the same opponent replies,
// and identify checking replies. Fuse those traversals and reuse the results.
// No beam width, evaluation weight, search depth, candidate count, or final
// score formula is changed here.

const stonefishV5ProStrengthReferenceScoreAllMoves = stonefishV5ProScoreAllMoves;

function stonefishV5ProStrengthAnalyzeRoot(game, raw, heritageMove, bookMove, perspective) {
  let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
  if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

  let baseKnowledge = 0;
  const heritageMatch = !!heritageMove && stonefishV5SameMove(raw, heritageMove);
  if (bookMove && stonefishV5SameMove(raw, bookMove)) baseKnowledge += STONEFISH_V5_WEIGHTS.book;
  if (raw.flags & (4 | 8)) baseKnowledge += STONEFISH_V5_WEIGHTS.castle;
  if (raw.promotion) baseKnowledge += STONEFISH_V5_WEIGHTS.promotion;

  game.fastApply(raw);
  const ownSide = -game.side;
  const enemySide = game.side;
  const givesCheck = game.in_check();
  const rootVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
  const replies = game.fastMoves();

  // Released tactical semantics: a root mate is doubled, and root knowledge is
  // skipped for this mate-band score by the existing Pro root contract.
  if (!replies.length && givesCheck) {
    game.fastUndo();
    return {
      tactical: STONEFISH_V5_MATE * 2,
      knowledge: 0,
      heritageMatch
    };
  }

  let worst = replies.length ? Infinity : 0;
  let replyRepetition = false;
  let forcedLoss = false;
  let checks = 0;

  for (let i = 0; i < replies.length; i += 1) {
    const reply = replies[i];
    let opponentGain = STONEFISH_V5_PIECE[reply.captured] || 0;
    if (reply.promotion) opponentGain += (STONEFISH_V5_PIECE[reply.promotion] || 0) - 100;

    game.fastApply(reply);
    const replyGivesCheck = game.in_check();
    if (replyGivesCheck) checks += 1;

    // Once any opponent reply is mate, tactical score is fixed at -MATE. We
    // still visit the remaining replies just enough to count checks because
    // root knowledge uses that exact counterplay statistic.
    if (!forcedLoss) {
      if (replyGivesCheck) opponentGain += 14;
      const priorVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
      if (priorVisits >= 2) replyRepetition = true;
      const responses = game.fastMoves();

      if (!responses.length && replyGivesCheck) {
        forcedLoss = true;
      } else {
        const ourGain = stonefishV5ProBestResponseGainExactFast(game, responses);
        const branch = immediate - opponentGain + ourGain;
        if (branch < worst) worst = branch;
      }
    }
    game.fastUndo();
  }

  let tactical;
  if (forcedLoss) {
    tactical = -STONEFISH_V5_MATE;
  } else {
    tactical = worst;
    if (tactical >= STONEFISH_V5_MATE) tactical = STONEFISH_V5_MATE * 0.5;
    if (tactical <= -STONEFISH_V5_MATE) tactical = -STONEFISH_V5_MATE;
    if (rootVisits > 0) {
      tactical -= rootVisits * 1200000;
      tactical = Math.max(tactical, STONEFISH_V5_DRAW_FLOOR);
    }
    if (replyRepetition) tactical = Math.min(tactical, STONEFISH_V5_DRAW_FLOOR);
  }

  let points = baseKnowledge;
  if (givesCheck) points += STONEFISH_V5_WEIGHTS.check;
  points += (-checks) * STONEFISH_V5_WEIGHTS.oppCheckRisk;
  points += (-replies.length) * STONEFISH_V5_WEIGHTS.oppMobility;
  points += stonefishV5ProRootFusionStrictPatternAfterApplied(
    game, raw, ownSide, enemySide
  ) * STONEFISH_V5_WEIGHTS.matePattern;

  const c = stonefishV5ProContexts(game, perspective);
  if (rootVisits > 0) {
    points -= rootVisits * STONEFISH_V5_WEIGHTS.repetition;
    if (c.lead >= 200) points -= STONEFISH_V5_WEIGHTS.repetitionAhead;
  }
  if (game.halfmove >= 60 && (raw.piece === 1 || raw.captured)) {
    points += STONEFISH_V5_WEIGHTS.fiftyReset;
  }

  const adaptive = stonefishV5ProAdaptivePosition(game, perspective);
  const baseScore = stonefishV5ProRootFusionBasePositionScore(game, perspective);
  const counterplay = stonefishV5ProRootFusionCounterplay(replies, checks, c);
  const enemyThreat = stonefishV5ProRecoveryPasserDanger(c.theirPassers);

  points += baseScore * STONEFISH_V5_WEIGHTS.positional;
  points += adaptive * 0.72;
  points -= counterplay * (0.72 + c.defence * 0.65 + c.conversion * 0.45);

  if (heritageMatch) {
    const threatScale = enemyThreat >= 300 ? 0.04 : enemyThreat >= 120 ? 0.18 : enemyThreat >= 35 ? 0.48 : 1;
    const noveltyScale = 0.32 + c.phase * 0.68;
    points += STONEFISH_V5_WEIGHTS.heritage * threatScale * noveltyScale;
  }

  let agreement = 0;
  if (tactical > 25) agreement += 1;
  if (adaptive > 80) agreement += 1;
  if (heritageMatch) agreement += 1;
  if (givesCheck || raw.captured || raw.promotion) agreement += 1;
  if (agreement >= 3) points += 120 + agreement * 25;
  else if (tactical < -120 && adaptive > 120) points -= 160;

  if (rootVisits > 0 && c.lead > 100) points -= 220000;
  if (c.conversion > 0 && raw.captured) {
    points += (STONEFISH_V5_PIECE[raw.captured] || 0) * (0.35 + 0.45 * c.conversion);
  }

  game.fastUndo();
  return { tactical, knowledge: points, heritageMatch };
}

stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];

  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  for (let i = 0; i < legal.length; i += 1) {
    const raw = legal[i];
    const analyzed = stonefishV5ProStrengthAnalyzeRoot(
      game, raw, heritageMove, bookMove, perspective
    );
    const preliminary = analyzed.tactical + analyzed.knowledge;
    scored.push({
      raw,
      tactical: analyzed.tactical,
      knowledge: analyzed.knowledge,
      scout: analyzed.knowledge,
      heritageMatch: analyzed.heritageMatch,
      preliminary,
      deep: null,
      score: -Infinity
    });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.preliminary - a.preliminary) > 1e-9) return b.preliminary - a.preliminary;
    const au = stonefishV45RawUci(game, a.raw);
    const bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  STONEFISH_V5_PRO_ACTIVE_TT = new Map();
  STONEFISH_V5_PRO_LAST_SEARCH_STATS = { nodes: 0, leaves: 0, ttHits: 0 };
  try {
    const finalistCount = Math.min(STONEFISH_V5_PRO_RECOVERY_ROOT_CANDIDATES, scored.length);
    for (let i = 0; i < finalistCount; i += 1) {
      const entry = scored[i];
      entry.deep = stonefishV5ProFivePlyScore(game, entry.raw, perspective);
      entry.score = Math.abs(entry.deep) >= STONEFISH_V5_PRO_MATE * 0.9
        ? entry.deep
        : entry.deep * 1.35 + entry.preliminary * 0.38;
    }
  } finally {
    STONEFISH_V5_PRO_ACTIVE_TT = null;
  }

  for (let i = Math.min(STONEFISH_V5_PRO_RECOVERY_ROOT_CANDIDATES, scored.length); i < scored.length; i += 1) {
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
