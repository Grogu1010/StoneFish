// Stonefish v5 Pro recovery layer.
//
// Recovery goals:
// - keep the proven narrow five-ply search that can run at v5 speed,
// - restore released-Pro root coverage and adaptive leaf quality,
// - preserve final-v5 tactical/repetition semantics exactly,
// - fuse repeated board scans and move-order work instead of buying strength
//   with more unconditional nodes.

const STONEFISH_V5_PRO_RECOVERY_ROOT_CANDIDATES = 4;
const STONEFISH_V5_PRO_RECOVERY_CONTEXT_CACHE = new Map();
const STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE = new Map();
const stonefishV5ProRecoveryReferenceAdaptive = stonefishV5ProAdaptivePosition;
const stonefishV5ProRecoveryReferenceTactical = stonefishV5TacticalScore;
const stonefishV5ProRecoveryBaseAttackCount = stonefishV5ProAttackCount;
let STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO = null;

function stonefishV5ProRecoveryCacheSet(cache, key, value) {
  if (cache.size >= STONEFISH_V5_PRO_SPEED_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

// Attack geometry is one of Pro's hottest leaf costs. During one position
// evaluation the same square/side attack count is requested repeatedly by king
// pressure and loose-piece coordination. Memoize only while Pro is evaluating;
// normal v5 is untouched, so the speed comparison stays fair.
stonefishV5ProAttackCount = function(game, sq, side) {
  const memo = STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO;
  if (!memo) return stonefishV5ProRecoveryBaseAttackCount(game, sq, side);
  const index = sq + (side === 1 ? 0 : 64);
  const cached = memo[index];
  if (cached !== undefined) return cached;
  const value = stonefishV5ProRecoveryBaseAttackCount(game, sq, side);
  memo[index] = value;
  return value;
};

function stonefishV5ProRecoveryPassedScore(passers) {
  let score = 0;
  for (let i = 0; i < passers.length; i += 1) {
    score += Math.max(0, passers[i].progress - 1);
  }
  return score;
}

function stonefishV5ProRecoveryNearestPasser(passers) {
  let best = 8;
  for (let i = 0; i < passers.length; i += 1) {
    if (passers[i].distance < best) best = passers[i].distance;
  }
  return best;
}

function stonefishV5ProRecoveryPasserStatus(game, passers, pawnSide, perspective) {
  let score = 0;
  const ours = pawnSide === perspective;
  const blockerSide = -pawnSide;

  for (let i = 0; i < passers.length; i += 1) {
    const passer = passers[i];
    const danger = stonefishV5PasserDanger(passer.distance);
    let effective = danger;
    const nextSq = passer.sq + pawnSide * 8;

    if (nextSq >= 0 && nextSq < 64) {
      const nextPiece = game.boardState[nextSq];
      if (nextPiece && (nextPiece > 0 ? 1 : -1) === blockerSide) effective *= 0.18;
      else if (game._isAttacked(nextSq, blockerSide)) effective *= 0.58;
    }

    for (let r = passer.rank + pawnSide; r >= 0 && r < 8; r += pawnSide) {
      const p = game.boardState[r * 8 + passer.file];
      if (!p) continue;
      if ((p > 0 ? 1 : -1) === blockerSide) {
        const type = Math.abs(p);
        if (type === 4 || type === 5 || type === 6) effective *= 0.42;
      }
      break;
    }

    if (game._isAttacked(passer.sq, blockerSide)) effective *= 0.72;
    if (stonefishV5CoversPromotionAfterAdvance(game, passer, blockerSide)) effective *= 0.20;
    score += ours ? effective : -effective * 1.35;
  }
  return score;
}

// Exact context math from released Pro, with material/non-pawn/bishop scans
// fused and the passed-pawn lists retained for the adaptive evaluator.
stonefishV5ProContexts = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_RECOVERY_CONTEXT_CACHE.get(key);
  if (cached !== undefined) return cached;

  const enemy = -perspective;
  let nonPawnMaterial = 0;
  let ourMaterial = 0;
  let enemyMaterial = 0;
  let ourBishops = 0;
  let enemyBishops = 0;

  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (!p) continue;
    const side = p > 0 ? 1 : -1;
    const type = Math.abs(p);
    const value = STONEFISH_V5_PIECE[type] || 0;
    if (type >= 2 && type <= 5) nonPawnMaterial += value;
    if (side === perspective) {
      ourMaterial += value;
      if (type === 3) ourBishops += 1;
    } else {
      enemyMaterial += value;
      if (type === 3) enemyBishops += 1;
    }
  }

  const ourPassers = stonefishV5PassedPawnInfo(game, perspective);
  const theirPassers = stonefishV5PassedPawnInfo(game, enemy);
  const attackMemo = new Array(128);
  const previousMemo = STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO;
  STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO = attackMemo;
  const attackPressure = stonefishV5ProKingZonePressure(game, perspective);
  const defencePressure = stonefishV5ProKingZonePressure(game, enemy);
  STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO = previousMemo;

  const phase = stonefishV5ProClamp(nonPawnMaterial / STONEFISH_V5_PRO_START_NONPAWN);
  const endgame = 1 - phase;
  const opening = phase * stonefishV5ProClamp((18 - game.fullmove) / 18);
  const lead = ourMaterial - enemyMaterial;
  const attack = stonefishV5ProClamp(attackPressure / 9);
  const defence = stonefishV5ProClamp(defencePressure / 9);
  const conversion = stonefishV5ProClamp((lead - 120) / 650);
  const ourNearest = stonefishV5ProRecoveryNearestPasser(ourPassers);
  const theirNearest = stonefishV5ProRecoveryNearestPasser(theirPassers);
  const pawnRace = ourNearest <= 3 && theirNearest <= 3
    ? 1
    : (ourNearest <= 2 || theirNearest <= 2 ? 0.65 : 0);

  return stonefishV5ProRecoveryCacheSet(STONEFISH_V5_PRO_RECOVERY_CONTEXT_CACHE, key, {
    phase,
    endgame,
    opening,
    attack,
    defence,
    conversion,
    pawnRace,
    lead,
    attackPressure,
    defencePressure,
    ourPassers,
    theirPassers,
    bishopPairDiff: (ourBishops >= 2 ? 1 : 0) - (enemyBishops >= 2 ? 1 : 0),
    attackMemo
  });
};

// Fused form of released Pro's adaptive position score. This includes final
// v5's passed-pawn status wrapper, which the first recovery attempt omitted.
stonefishV5ProAdaptivePosition = function(game, perspective) {
  const key = perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE.get(key);
  if (cached !== undefined) return cached;

  const enemy = -perspective;
  const c = stonefishV5ProContexts(game, perspective);
  const previousMemo = STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO;
  STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO = c.attackMemo;

  const ourMobility = game.fastMobility(perspective);
  const enemyMobility = game.fastMobility(enemy);
  const mobility = ourMobility - enemyMobility;
  const development = stonefishV4Development(game, perspective) - stonefishV4Development(game, enemy);
  const center = stonefishV4CenterControl(game, perspective) - stonefishV4CenterControl(game, enemy);
  const minorCentral = stonefishV4MinorCentralization(game, perspective) - stonefishV4MinorCentralization(game, enemy);
  const kingProtection = stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, enemy);
  const kingFreedom = stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, enemy);
  const pawnStructure = stonefishV4PawnStructure(game, perspective) - stonefishV4PawnStructure(game, enemy);
  const rookActivity = stonefishV4RookActivity(game, perspective) - stonefishV4RookActivity(game, enemy);
  const kingPlacement = stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, enemy);
  const boardControl = stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, enemy);
  const hanging = stonefishV4HangingMax(game, perspective) - stonefishV4HangingMax(game, enemy);
  const passers = stonefishV5ProRecoveryPassedScore(c.ourPassers)
    - stonefishV5ProRecoveryPassedScore(c.theirPassers);

  let score = c.lead;
  score += mobility * STONEFISH_V5_WEIGHTS.mobility;
  score += development * STONEFISH_V5_WEIGHTS.development;
  score += center * STONEFISH_V5_WEIGHTS.center;
  score += minorCentral * STONEFISH_V5_WEIGHTS.minorCentral;
  score += kingProtection * STONEFISH_V5_WEIGHTS.kingProtection;
  score += kingFreedom * STONEFISH_V5_WEIGHTS.kingFreedom;
  score += pawnStructure * STONEFISH_V5_WEIGHTS.pawnStructure;
  score += rookActivity * STONEFISH_V5_WEIGHTS.rookActivity;
  score += kingPlacement * STONEFISH_V5_WEIGHTS.kingPlacement;
  score += boardControl * STONEFISH_V5_WEIGHTS.boardControl;
  score += hanging * STONEFISH_V5_WEIGHTS.hanging;
  score += c.bishopPairDiff * STONEFISH_V5_WEIGHTS.bishopPair;
  score += passers * STONEFISH_V5_WEIGHTS.passedPawn;
  score += stonefishV5ProRecoveryPasserStatus(game, c.ourPassers, perspective, perspective);
  score += stonefishV5ProRecoveryPasserStatus(game, c.theirPassers, enemy, perspective);

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
    score -= enemyMobility * 2.5 * c.conversion;
    score += c.lead * 0.18 * c.conversion;
  }

  STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO = previousMemo;
  return stonefishV5ProRecoveryCacheSet(STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE, key, score);
};

stonefishV5ProLeaf = function(game, perspective) {
  return stonefishV5ProAdaptivePosition(game, perspective);
};

function stonefishV5ProFastMateAfterApplied(game) {
  return game.in_check() && !game.fastHasLegalMove();
}

function stonefishV5ProBestResponseGainExactFast(game, responses) {
  let best = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const response = responses[i];
    const givesCheck = game.fastGivesCheck(response);
    if (givesCheck) {
      game.fastApply(response);
      const mates = stonefishV5ProFastMateAfterApplied(game);
      game.fastUndo();
      if (mates) return STONEFISH_V5_MATE;
    }

    let gain = STONEFISH_V5_PIECE[response.captured] || 0;
    if (response.promotion) gain += (STONEFISH_V5_PIECE[response.promotion] || 0) - 100;
    if (givesCheck) gain += 18;
    if (gain > best) best = gain;
  }
  return best;
}

// Exact final-v5 tactical semantics in one traversal. In particular, this
// preserves root mate doubling and both repetition draw floors, while avoiding
// a separate fastGivesCheck mutation for every opponent reply.
function stonefishV5ProTacticalScoreExactFast(game, raw) {
  let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
  if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

  game.fastApply(raw);
  const rootVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
  const replies = game.fastMoves();
  const rootCheck = game.in_check();

  if (!replies.length && rootCheck) {
    game.fastUndo();
    return STONEFISH_V5_MATE * 2;
  }

  let worst = replies.length ? Infinity : 0;
  let replyRepetition = false;

  for (let i = 0; i < replies.length; i += 1) {
    const reply = replies[i];
    let opponentGain = STONEFISH_V5_PIECE[reply.captured] || 0;
    if (reply.promotion) opponentGain += (STONEFISH_V5_PIECE[reply.promotion] || 0) - 100;

    game.fastApply(reply);
    const givesCheck = game.in_check();
    if (givesCheck) opponentGain += 14;
    const priorVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
    if (priorVisits >= 2) replyRepetition = true;
    const responses = game.fastMoves();

    if (!responses.length && givesCheck) {
      game.fastUndo();
      game.fastUndo();
      return -STONEFISH_V5_MATE;
    }

    const ourGain = stonefishV5ProBestResponseGainExactFast(game, responses);
    game.fastUndo();

    const branch = immediate - opponentGain + ourGain;
    if (branch < worst) worst = branch;
  }

  let score = worst;
  if (score >= STONEFISH_V5_MATE) score = STONEFISH_V5_MATE * 0.5;
  if (score <= -STONEFISH_V5_MATE) {
    game.fastUndo();
    return -STONEFISH_V5_MATE;
  }

  if (rootVisits > 0) {
    score -= rootVisits * 1200000;
    score = Math.max(score, STONEFISH_V5_DRAW_FLOOR);
  }
  if (replyRepetition) score = Math.min(score, STONEFISH_V5_DRAW_FLOOR);

  game.fastUndo();
  return score;
}

function stonefishV5ProRecoveryPasserDanger(passers) {
  let danger = 0;
  for (let i = 0; i < passers.length; i += 1) {
    const value = stonefishV5PasserDanger(passers[i].distance);
    if (value > danger) danger = value;
  }
  return danger;
}

function stonefishV5ProRecoveryMoveOrder(game, move, passers, enemy) {
  let score = stonefishV5ProMoveOrder(game, move);
  for (let i = 0; i < passers.length; i += 1) {
    const passer = passers[i];
    if (passer.distance > 3) continue;
    const danger = stonefishV5PasserDanger(passer.distance);
    const nextSq = passer.sq + enemy * 8;
    const promotionSq = (enemy === 1 ? 7 : 0) * 8 + passer.file;
    if (move.to === passer.sq && move.captured === 1) score += danger * 8;
    if (move.to === nextSq) score += danger * 4;
    if (move.to === promotionSq) score += danger * 6;
  }
  return score;
}

// Exact top-k of the speed layer's stable ordering, without sorting/allocating
// entries for moves that cannot survive the beam.
function stonefishV5ProRecoveryTopOrdered(game, legal, width, passers, enemy) {
  const top = [];
  for (let index = 0; index < legal.length; index += 1) {
    const move = legal[index];
    const order = stonefishV5ProRecoveryMoveOrder(game, move, passers, enemy);
    let at = 0;
    while (at < top.length) {
      const other = top[at];
      if (order > other.order || (order === other.order && index < other.index)) break;
      at += 1;
    }
    if (at < width) {
      top.splice(at, 0, { move, index, order });
      if (top.length > width) top.pop();
    } else if (top.length < width) {
      top.push({ move, index, order });
    }
  }
  return top;
}

stonefishV5ProCheckedLeaf = function(game, perspective, alpha, beta, legal, plyFromRoot) {
  const maximizing = game.side === perspective;
  const enemy = -game.side;
  const passers = stonefishV5PassedPawnInfo(game, enemy);
  const ordered = stonefishV5ProRecoveryTopOrdered(
    game, legal, Math.min(6, legal.length), passers, enemy
  );
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i];
    game.fastApply(entry.move);
    let value;
    if (!game.fastHasLegalMove()) {
      value = game.in_check()
        ? (game.side === perspective
            ? -STONEFISH_V5_PRO_MATE + plyFromRoot + 1
            : STONEFISH_V5_PRO_MATE - plyFromRoot - 1)
        : 0;
    } else {
      value = stonefishV5ProLeaf(game, perspective);
    }
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

stonefishV5ProMinimax = function(game, depth, perspective, alpha, beta, plyFromRoot) {
  const tt = STONEFISH_V5_PRO_ACTIVE_TT;
  const key = tt ? stonefishV5ProTTKey(game, depth, perspective, plyFromRoot) : null;
  if (tt) {
    const hit = tt.get(key);
    if (hit !== undefined) {
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.ttHits += 1;
      return hit;
    }
  }
  if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.nodes += 1;

  if (depth <= 0) {
    if (game.in_check()) {
      const legal = game.fastMoves();
      if (!legal.length) {
        const terminal = game.side === perspective
          ? -STONEFISH_V5_PRO_MATE + plyFromRoot
          : STONEFISH_V5_PRO_MATE - plyFromRoot;
        if (tt) tt.set(key, terminal);
        return terminal;
      }
      const extended = stonefishV5ProCheckedLeaf(game, perspective, alpha, beta, legal, plyFromRoot);
      if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
      return extended;
    }
    if (!game.fastHasLegalMove()) {
      if (tt) tt.set(key, 0);
      return 0;
    }
    if (game.halfmove >= 100 || game._insufficientMaterial()) {
      if (tt) tt.set(key, 0);
      return 0;
    }
    const leaf = stonefishV5ProLeaf(game, perspective);
    if (STONEFISH_V5_PRO_LAST_SEARCH_STATS) STONEFISH_V5_PRO_LAST_SEARCH_STATS.leaves += 1;
    if (tt) tt.set(key, leaf);
    return leaf;
  }

  const legal = game.fastMoves();
  if (!legal.length) {
    const terminal = !game.in_check()
      ? 0
      : (game.side === perspective
          ? -STONEFISH_V5_PRO_MATE + plyFromRoot
          : STONEFISH_V5_PRO_MATE - plyFromRoot);
    if (tt) tt.set(key, terminal);
    return terminal;
  }
  if (game.halfmove >= 100 || game._insufficientMaterial()) {
    if (tt) tt.set(key, 0);
    return 0;
  }

  const enemy = -game.side;
  const passers = stonefishV5PassedPawnInfo(game, enemy);
  const danger = stonefishV5ProRecoveryPasserDanger(passers);
  const inCheck = game.in_check();
  let width = STONEFISH_V5_PRO_SPEED_BRANCH[depth] || 2;
  if (inCheck) width = Math.max(width, 6);
  else if (danger >= 2200) width += 2;
  else if (danger >= 900) width += 1;
  width = Math.min(width, legal.length);

  const ordered = stonefishV5ProRecoveryTopOrdered(game, legal, width, passers, enemy);
  const maximizing = game.side === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;

  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i];
    game.fastApply(entry.move);
    const value = stonefishV5ProMinimax(
      game, depth - 1, perspective, alpha, beta, plyFromRoot + 1
    );
    game.fastUndo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) {
      cutoff = true;
      break;
    }
  }

  if (tt && !cutoff) tt.set(key, best);
  return best;
};

// Released-Pro root semantics across every legal move, followed by the proven
// four-candidate selective five-ply tree.
stonefishV5ProScoreAllMoves = function(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];

  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = [];

  for (let i = 0; i < legal.length; i += 1) {
    const raw = legal[i];
    const tactical = stonefishV5ProTacticalScoreExactFast(game, raw);
    const knowledge = Math.abs(tactical) >= STONEFISH_V5_MATE * 1.5
      ? 0
      : stonefishV5ProRootKnowledge(game, raw, heritageMove, bookMove, perspective, tactical);
    const preliminary = tactical + knowledge;
    scored.push({
      raw,
      tactical,
      knowledge,
      scout: knowledge,
      heritageMatch: !!heritageMove && stonefishV5SameMove(raw, heritageMove),
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
