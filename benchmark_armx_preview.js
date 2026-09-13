// Focused in-game diagnostics for ARMX-preview.
// This does not tune or alter the engine. It measures whether the separate
// opponent-adaptation model is actually learning and affecting decisions during
// real games, where the game history is available.

const fs = require('fs');
const vm = require('vm');

const engineFiles = [
  'StonefishChess.js',
  'Stonefish_v3.js',
  'Stonefish_v4.js',
  'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js',
  'Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js',
  'Stonefish_v5.js',
  'Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js'
];
if (fs.existsSync('Stonefish_v5_pro_geometry_patch.js')) engineFiles.push('Stonefish_v5_pro_geometry_patch.js');
if (fs.existsSync('Stonefish_runtime_speed_patch.js')) engineFiles.push('Stonefish_runtime_speed_patch.js');
if (fs.existsSync('Stonefish_fast_moves_experiment.js')) engineFiles.push('Stonefish_fast_moves_experiment.js');
engineFiles.push(
  'Stonefish_v5_5_search.js',
  'Stonefish_v5_5_refutation_guard.js',
  'ARMX_preview_fast.js',
  'Stonefish_v5_5_testunit1.js'
);

vm.runInThisContext(engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-armx-preview-diagnostics-bundle.js'
});

function seededRandom(seed) {
  let x = seed >>> 0;
  return function random() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const old = Math.random;
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = old; }
}

function cleanMove(game, raw) {
  const move = stonefishV3PublicMove(game, raw);
  return move ? { from: move.from, to: move.to, promotion: move.promotion || undefined } : null;
}

function play(game, move) {
  return move ? game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }) : null;
}

function rawKey(raw) {
  return raw ? `${raw.from}:${raw.to}:${raw.promotion || 0}` : null;
}

function generateOpening(pairIndex, plies = 10) {
  const game = new Chess();
  const pick = seededRandom((0xA551000 + pairIndex * 977) >>> 0);
  return withSeed((0xB771000 + pairIndex * 131) >>> 0, () => {
    const moves = [];
    for (let ply = 0; ply < plies && !game.game_over(); ply += 1) {
      const scored = stonefishV5ScoreAllMoves(game);
      if (!scored.length) break;
      const width = Math.min(4, scored.length);
      const r = pick();
      const rank = Math.min(width - 1, r < 0.48 ? 0 : r < 0.76 ? 1 : r < 0.93 ? 2 : 3);
      const move = cleanMove(game, scored[rank].raw);
      if (!move || !play(game, move)) break;
      moves.push(move);
    }
    return moves;
  });
}

function positionAfter(opening) {
  const game = new Chess();
  for (const move of opening) if (!play(game, move)) throw new Error('Invalid generated opening');
  return game;
}

function freshStats() {
  return {
    games: 0,
    turns: 0,
    observedPliesSum: 0,
    observedPliesMax: 0,
    reports: 0,
    reportsWithSignal: 0,
    evidenceSum: 0,
    evidenceMax: 0,
    absoluteAdjustmentSum: 0,
    absoluteAdjustmentMax: 0,
    adaptationApplied: 0,
    adaptationRejected: 0,
    overrides: 0,
    overrideEvents: [],
    rejectionEvents: [],
    guardEligible: 0,
    guardVerified: 0,
    guardLowered: 0,
    notesSeen: 0,
    reasonCounts: Object.create(null),
    rejectionReasonCounts: Object.create(null),
    noteCounts: Object.create(null),
  };
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function compactReport(report) {
  if (!report) return null;
  return {
    move: rawKey(report.raw),
    hostScore: Number(report.hostScore),
    hostDeep: Number(report.hostDeep),
    adaptedScore: Number(report.adaptedScore),
    adjustment: Number(report.adjustment),
    signal: Number(report.signal),
    confidence: Number(report.confidence),
    evidence: Number(report.evidence),
    features: Array.isArray(report.features) ? report.features.slice() : [],
    reasons: Array.isArray(report.reasons) ? report.reasons.slice() : [],
  };
}

function compactGateDecision(decision) {
  if (!decision) return null;
  const output = { allowed: Boolean(decision.allowed), reason: decision.reason || null };
  const fields = [
    'hostGap', 'deepSacrifice', 'challengerEvidence', 'challengerConfidence',
    'adaptedLead', 'challengerSignal', 'provisionalSignal'
  ];
  for (const field of fields) if (Number.isFinite(Number(decision[field]))) output[field] = Number(decision[field]);
  return output;
}

function observeReview(stats, review, context) {
  if (!review) return;
  stats.turns += 1;
  const observed = Number(review.observedPlies) || 0;
  stats.observedPliesSum += observed;
  stats.observedPliesMax = Math.max(stats.observedPliesMax, observed);
  if (review.adaptationApplied) stats.adaptationApplied += 1;
  if (review.adaptationRejected) {
    stats.adaptationRejected += 1;
    const reports = Array.isArray(review.reports) ? review.reports : [];
    const provisional = reports.find(report => report && review.provisionalRaw
      && stonefishV5SameMove(report.raw, review.provisionalRaw));
    const proposed = reports.find(report => report && review.proposedRaw
      && stonefishV5SameMove(report.raw, review.proposedRaw));
    const reason = review.rejectionReason || (review.gateDecision && review.gateDecision.reason) || 'unknown';
    increment(stats.rejectionReasonCounts, reason);
    stats.rejectionEvents.push({
      game: context.gameIndex + 1,
      pair: context.pair + 1,
      side: context.armxIsWhite ? 'W' : 'B',
      ply: context.plies,
      result: null,
      reason,
      observedPlies: observed,
      hostMove: rawKey(review.provisionalRaw),
      proposedMove: rawKey(review.proposedRaw),
      hostScoreGap: Number(review.hostScoreGap),
      gateDecision: compactGateDecision(review.gateDecision),
      provisional: compactReport(provisional),
      proposed: compactReport(proposed),
      notes: Array.isArray(review.notes) ? review.notes.slice() : [],
    });
  }
  if (review.override) {
    stats.overrides += 1;
    const reports = Array.isArray(review.reports) ? review.reports : [];
    const provisional = reports.find(report => report && review.provisionalRaw
      && stonefishV5SameMove(report.raw, review.provisionalRaw));
    const winner = reports.find(report => report && review.recommendedRaw
      && stonefishV5SameMove(report.raw, review.recommendedRaw));
    stats.overrideEvents.push({
      game: context.gameIndex + 1,
      pair: context.pair + 1,
      side: context.armxIsWhite ? 'W' : 'B',
      ply: context.plies,
      result: null,
      hostMove: rawKey(review.provisionalRaw),
      armxMove: rawKey(review.recommendedRaw),
      hostScoreGap: Number(review.hostScoreGap),
      provisional: compactReport(provisional),
      chosen: compactReport(winner),
      notes: Array.isArray(review.notes) ? review.notes.slice() : [],
    });
  }

  const guard = review.refutationGuard;
  if (guard && guard.eligible) stats.guardEligible += 1;
  if (guard && guard.verified) stats.guardVerified += 1;
  if (guard && guard.lowered) stats.guardLowered += 1;

  const reports = Array.isArray(review.reports) ? review.reports : [];
  for (const report of reports) {
    stats.reports += 1;
    const evidence = Number(report.evidence) || 0;
    const adjustment = Math.abs(Number(report.adjustment) || 0);
    stats.evidenceSum += evidence;
    stats.evidenceMax = Math.max(stats.evidenceMax, evidence);
    stats.absoluteAdjustmentSum += adjustment;
    stats.absoluteAdjustmentMax = Math.max(stats.absoluteAdjustmentMax, adjustment);
    if (adjustment >= 0.5 || Math.abs(Number(report.signal) || 0) >= 0.02) stats.reportsWithSignal += 1;
    for (const reason of report.reasons || []) increment(stats.reasonCounts, reason.split(':')[0]);
  }

  for (const note of review.notes || []) {
    stats.notesSeen += 1;
    const key = String(note).split(' ')[0];
    increment(stats.noteCounts, key);
  }
}

function summarize(stats) {
  const top = map => Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));
  return {
    games: stats.games,
    turns: stats.turns,
    averageObservedPlies: stats.turns ? stats.observedPliesSum / stats.turns : 0,
    maxObservedPlies: stats.observedPliesMax,
    reports: stats.reports,
    reportSignalRate: stats.reports ? stats.reportsWithSignal / stats.reports : 0,
    averageEvidence: stats.reports ? stats.evidenceSum / stats.reports : 0,
    maxEvidence: stats.evidenceMax,
    averageAbsoluteAdjustment: stats.reports ? stats.absoluteAdjustmentSum / stats.reports : 0,
    maxAbsoluteAdjustment: stats.absoluteAdjustmentMax,
    adaptationAppliedRate: stats.turns ? stats.adaptationApplied / stats.turns : 0,
    adaptationRejectedRate: stats.turns ? stats.adaptationRejected / stats.turns : 0,
    overrideRate: stats.turns ? stats.overrides / stats.turns : 0,
    overrideEvents: stats.overrideEvents,
    rejectionEvents: stats.rejectionEvents,
    topRejectionReasons: top(stats.rejectionReasonCounts),
    guardEligibleRate: stats.turns ? stats.guardEligible / stats.turns : 0,
    guardVerificationRate: stats.turns ? stats.guardVerified / stats.turns : 0,
    guardLowerRate: stats.turns ? stats.guardLowered / stats.turns : 0,
    notesSeen: stats.notesSeen,
    topReasons: top(stats.reasonCounts),
    topNoteFeatures: top(stats.noteCounts),
  };
}

function simulate(label, games, opponentFn) {
  const stats = freshStats();
  const outcomes = { win: 0, loss: 0, draw: 0 };
  for (let i = 0; i < games; i += 1) {
    const pair = Math.floor(i / 2);
    const game = positionAfter(generateOpening(pair, 10));
    const armxIsWhite = i % 2 === 0;
    stats.games += 1;
    let plies = game.historyStack.length;
    const overrideStart = stats.overrideEvents.length;
    const rejectionStart = stats.rejectionEvents.length;
    let gameOutcome = 'draw';

    withSeed((0xD550000 + pair * 1103 + i) >>> 0, () => {
      while (!game.game_over() && plies < 360) {
        const armxTurn = (game.side === 1) === armxIsWhite;
        const move = armxTurn ? getStonefishV55Testunit1Move(game) : opponentFn(game);
        if (armxTurn) {
          observeReview(stats, stonefishV55Testunit1LastARMX(), {
            gameIndex: i,
            pair,
            armxIsWhite,
            plies,
          });
        }
        if (!play(game, move)) {
          gameOutcome = armxTurn ? 'loss' : 'win';
          outcomes[gameOutcome] += 1;
          return;
        }
        plies += 1;
      }
      if (game.in_checkmate()) {
        const winnerIsWhite = game.side === -1;
        gameOutcome = winnerIsWhite === armxIsWhite ? 'win' : 'loss';
        outcomes[gameOutcome] += 1;
      } else {
        gameOutcome = 'draw';
        outcomes.draw += 1;
      }
    });

    for (let event = overrideStart; event < stats.overrideEvents.length; event += 1) {
      stats.overrideEvents[event].result = gameOutcome;
    }
    for (let event = rejectionStart; event < stats.rejectionEvents.length; event += 1) {
      stats.rejectionEvents[event].result = gameOutcome;
    }
  }
  return { label, outcomes, adaptation: summarize(stats) };
}

const games = Math.max(4, Number.parseInt(process.env.ARMX_DIAG_GAMES || '8', 10) || 8);
const output = {
  model: ARMX_PREVIEW,
  vsPro: simulate('ARMX-vs-Pro', games, getStonefishV5ProMove),
  vsNoARMX: simulate('ARMX-vs-NoARMX', games, getStonefishV55Testunit1NoARMXMove),
};
console.log('ARMX_PREVIEW_DIAGNOSTICS ' + JSON.stringify(output));