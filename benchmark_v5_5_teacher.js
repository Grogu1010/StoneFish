// Teacher-guided tuning for Stonefish v5.5 candidate selection.
// Uses v5 Pro as the teacher only to measure which cheap v5.5 ranking settings
// retain Pro's preferred move in the finalist set. This does not alter gameplay.

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
engineFiles.push('Stonefish_v5_5_search.js');

vm.runInThisContext(engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v5-5-teacher-bundle.js'
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

function cloneGame(source) {
  const game = new Chess();
  game.boardState = new Int8Array(source.boardState);
  game.side = source.side;
  game.castling = source.castling;
  game.ep = source.ep;
  game.halfmove = source.halfmove;
  game.fullmove = source.fullmove;
  game.kingSq = { 1: source.kingSq[1], '-1': source.kingSq[-1] };
  game.historyStack = [];
  game.positionCounts = new Map(source.positionCounts);
  return game;
}

function clearSharedEngineCaches() {
  if (typeof STONEFISH_V5_PRO_POSITION_CACHE !== 'undefined') STONEFISH_V5_PRO_POSITION_CACHE.clear();
  if (typeof STONEFISH_V5_PRO_CONTEXT_CACHE !== 'undefined') STONEFISH_V5_PRO_CONTEXT_CACHE.clear();
  if (typeof STONEFISH_V5_PRO_ADAPTIVE_CACHE !== 'undefined') STONEFISH_V5_PRO_ADAPTIVE_CACHE.clear();
}

function play(game, move) {
  return move ? game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }) : null;
}

function cleanMove(game, raw) {
  const move = stonefishV3PublicMove(game, raw);
  return move ? { from: move.from, to: move.to, promotion: move.promotion || undefined } : null;
}

function rawKey(move) {
  return move ? `${move.from}:${move.to}:${move.promotion || 0}:${move.flags || 0}` : 'null';
}

function generateOpening(index, plies) {
  const game = new Chess();
  const pick = seededRandom((0xD551000 + index * 1597) >>> 0);
  return withSeed((0xE771000 + index * 211) >>> 0, () => {
    const moves = [];
    for (let ply = 0; ply < plies && !game.game_over(); ply += 1) {
      const scored = stonefishV5ScoreAllMoves(game);
      if (!scored.length) break;
      const width = Math.min(5, scored.length);
      const r = pick();
      const rank = Math.min(width - 1, r < 0.40 ? 0 : r < 0.67 ? 1 : r < 0.84 ? 2 : r < 0.95 ? 3 : 4);
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

function collectFeatureRow(position, index) {
  // Both halves of the teacher comparison must be deterministic. Pro was already
  // seeded, but the cheap v5.5 feature pass calls stonefishV5HeritageMove(), whose
  // final tie-break can use Math.random. Seed the whole feature collection per row
  // so identical code/positions produce identical teacher metrics across CI runs.
  clearSharedEngineCaches();
  const proGame = cloneGame(position);
  const proScored = withSeed((0x55110000 + index * 977) >>> 0, () => stonefishV5ProScoreAllMoves(proGame));
  if (!proScored.length) return null;
  const teacherKey = rawKey(proScored[0].raw);

  clearSharedEngineCaches();
  return withSeed((0xA55C0000 + index * 1597) >>> 0, () => {
    const game = cloneGame(position);
    const legal = game.fastMoves();
    if (!legal.length) return null;
    const perspective = game.side;
    const bookMove = stonefishV45BookMove(game, 1, legal);
    const heritageMove = stonefishV5HeritageMove(game);

    const entries = legal.map(raw => ({
      raw,
      key: rawKey(raw),
      heritage: Boolean(heritageMove && stonefishV5SameMove(raw, heritageMove)),
      scout: stonefishV5ProFastScoutScore(game, raw, bookMove, heritageMove, perspective),
      tactical: 0,
      conversion: 0,
      forcing: false,
    }));

    entries.sort((a, b) => {
      if (Math.abs(b.scout - a.scout) > 1e-9) return b.scout - a.scout;
      return stonefishV45RawUci(game, a.raw).localeCompare(stonefishV45RawUci(game, b.raw));
    });

    const featureCap = Math.min(8, entries.length);
    for (let i = 0; i < featureCap; i += 1) {
      entries[i].tactical = stonefishV5TacticalScore(game, entries[i].raw);
      entries[i].conversion = stonefishV5ProConversionUrgency(game, entries[i].raw, perspective);
      entries[i].forcing = Boolean(entries[i].raw.captured || entries[i].raw.promotion || game.fastGivesCheck(entries[i].raw));
    }

    return { teacherKey, entries: entries.slice(0, featureCap) };
  });
}

function scoreConfig(row, cfg) {
  const pool = row.entries.slice(0, Math.min(cfg.semifinalists, row.entries.length));
  const ranked = pool.map(entry => ({
    key: entry.key,
    forcing: entry.forcing,
    score: entry.tactical * cfg.tacticalWeight
      + entry.scout * cfg.scoutWeight
      + (entry.heritage ? STONEFISH_V5_WEIGHTS.heritage * cfg.heritageMultiplier : 0)
      + entry.conversion * cfg.conversionWeight,
  }));
  ranked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return ranked;
}

const count = Math.max(20, Number.parseInt(process.env.TEACHER_POSITIONS || '80', 10) || 80);
const rows = [];
for (let i = 0; i < count; i += 1) {
  const plies = 4 + (i % 13);
  const row = collectFeatureRow(positionAfter(generateOpening(i, plies)), i);
  if (row) rows.push(row);
}

const configs = [];
for (const semifinalists of [5, 6, 7, 8]) {
  for (const tacticalWeight of [0.90, 1.00, 1.10]) {
    for (const scoutWeight of [0.20, 0.28, 0.34, 0.42, 0.50, 0.60]) {
      for (const heritageMultiplier of [0.75, 1.00, 1.25, 1.50, 2.00]) {
        for (const conversionWeight of [0.50, 1.00, 1.50]) {
          configs.push({ semifinalists, tacticalWeight, scoutWeight, heritageMultiplier, conversionWeight });
        }
      }
    }
  }
}

function evaluate(cfg) {
  let top1 = 0, top2 = 0, top3 = 0, top4 = 0, poolCoverage = 0;
  for (const row of rows) {
    const pool = row.entries.slice(0, Math.min(cfg.semifinalists, row.entries.length));
    if (pool.some(entry => entry.key === row.teacherKey)) poolCoverage += 1;
    const ranked = scoreConfig(row, cfg);
    if (ranked[0] && ranked[0].key === row.teacherKey) top1 += 1;
    if (ranked.slice(0, 2).some(entry => entry.key === row.teacherKey)) top2 += 1;
    if (ranked.slice(0, 3).some(entry => entry.key === row.teacherKey)) top3 += 1;
    if (ranked.slice(0, 4).some(entry => entry.key === row.teacherKey)) top4 += 1;
  }
  return Object.assign({}, cfg, {
    positions: rows.length,
    poolCoverage: rows.length ? poolCoverage / rows.length : 0,
    top1: rows.length ? top1 / rows.length : 0,
    top2: rows.length ? top2 / rows.length : 0,
    top3: rows.length ? top3 / rows.length : 0,
    top4: rows.length ? top4 / rows.length : 0,
  });
}

function adaptiveThirdDiagnostics(cfg) {
  const margins = [100, 200, 300, 450, 650, 900, 1200, 1800, 2600];
  return margins.map(margin => {
    let triggered = 0;
    let retained = 0;
    for (const row of rows) {
      const ranked = scoreConfig(row, cfg);
      const baseHit = ranked.slice(0, 2).some(entry => entry.key === row.teacherKey);
      const third = ranked[2];
      const gap = third && ranked[1] ? ranked[1].score - third.score : Infinity;
      const useThird = Boolean(third && (third.forcing || gap <= margin));
      if (useThird) triggered += 1;
      if (baseHit || (useThird && third.key === row.teacherKey)) retained += 1;
    }
    return {
      margin,
      triggerRate: rows.length ? triggered / rows.length : 0,
      teacherCoverage: rows.length ? retained / rows.length : 0,
    };
  });
}

const currentConfig = {
  semifinalists: STONEFISH_V5_5_SEARCH.semifinalists,
  tacticalWeight: STONEFISH_V5_5_SEARCH.tacticalWeight,
  scoutWeight: STONEFISH_V5_5_SEARCH.scoutWeight,
  heritageMultiplier: STONEFISH_V5_5_SEARCH.heritageMultiplier,
  conversionWeight: STONEFISH_V5_5_SEARCH.conversionWeight,
};
const current = evaluate(currentConfig);

const rankedConfigs = configs.map(evaluate).sort((a, b) =>
  (b.top4 - a.top4)
  || (b.top3 - a.top3)
  || (b.top2 - a.top2)
  || (b.top1 - a.top1)
  || (b.poolCoverage - a.poolCoverage)
  || (a.semifinalists - b.semifinalists)
);

const output = {
  positions: rows.length,
  finalistCutoff: STONEFISH_V5_5_SEARCH.rootCandidates,
  current,
  adaptiveThird: adaptiveThirdDiagnostics(currentConfig),
  best: rankedConfigs[0],
  topConfigs: rankedConfigs.slice(0, 10),
};
console.log('STONEFISH_V5_5_TEACHER ' + JSON.stringify(output));