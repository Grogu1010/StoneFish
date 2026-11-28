'use strict';

// Head-to-head v6.1 strength check. Scores use standard match points:
// win = 1, draw = 0.5, loss = 0. Search limits are identical for both engines.
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const files = [
  'StonefishChess.js', 'models/v1.js', 'models/v2.js', 'models/v3.js',
  'models/v4.js', 'models/v4_5.js', 'models/v5.js', 'models/v5_pro.js',
  'models/v5_5.js', 'models/v6.js', 'models/v6_1.js',
  'ARMX/ARMX-preview.js', 'ARMX/ARMX.js', 'ARMX/ARMX_1_1.js'
];
vm.runInThisContext(files.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v6_1-match-bundle.js'
});

const OPTIONS = Object.freeze({
  maxDepth: 7,
  maxTimeMs: 20000,
  softNodes: 5000000,
  hardNodes: 8000000,
  rootWidth: 12
});
const MAX_PLIES = 120;

// Established opening continuations provide varied, repeatable starting
// positions. Every line is played twice with v6.1 taking each colour.
const OPENINGS = [
  ['Ruy Lopez', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7'],
  ['Sicilian', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6'],
  ['Queen’s Gambit', 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8'],
  ['King’s Indian', 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8'],
  ['French', 'e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3'],
  ['English', 'c2c4 e7e5 b1c3 g8f6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6'],
  ['Italian', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6'],
  ['Scandinavian', 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 c7c6 g1f3 c8f5'],
  ['Caro-Kann', 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6'],
  ['Slav', 'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5']
];

function applyUci(game, uci) {
  const move = game.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] || 'q'
  });
  if (!move) throw new Error('Illegal opening move ' + uci + ' in ' + game.fen());
}
function openingPosition(line) {
  const game = new Chess();
  for (const uci of line.split(/\s+/).filter(Boolean)) applyUci(game, uci);
  return game;
}
function runGame(name, line, v61Side) {
  const game = openingPosition(line);
  const startFen = game.fen();
  const counts = { v6: 0, v61: 0 };
  const depthCounts = { v6: {}, v61: {} };
  let result = '1/2-1/2';
  let termination = 'move limit';
  const started = performance.now();

  for (let ply = 0; ply < MAX_PLIES && !game.game_over(); ply += 1) {
    const model = game.side === v61Side ? 'v61' : 'v6';
    const move = model === 'v61'
      ? getStonefishV61Move(game, OPTIONS)
      : getStonefishV6Move(game, OPTIONS);
    const info = model === 'v61' ? globalThis.SF61_LAST_SEARCH : globalThis.SF6_LAST_SEARCH;
    if (!move) {
      termination = 'no legal move returned';
      break;
    }
    counts[model] += 1;
    const depth = info && Number.isInteger(info.depth) ? info.depth : -1;
    depthCounts[model][depth] = (depthCounts[model][depth] || 0) + 1;

    const played = game.move(move);
    if (!played) {
      throw new Error(model + ' returned an illegal move ' + JSON.stringify(move) + ' at ' + game.fen());
    }
    if (game.in_checkmate()) {
      const winner = -game.side;
      result = winner === v61Side ? '1-0' : '0-1';
      termination = 'checkmate';
    } else if (game.in_draw()) {
      result = '1/2-1/2';
      termination = 'draw';
    }
  }

  let points = 0.5;
  if (result === '1-0') points = v61Side === 1 ? 1 : 0;
  else if (result === '0-1') points = v61Side === -1 ? 1 : 0;
  return {
    opening: name,
    v61Side: v61Side === 1 ? 'white' : 'black',
    result,
    points,
    plies: game.historyStack.length,
    termination,
    movesByEngine: counts,
    completedDepths: depthCounts,
    elapsedMs: Number((performance.now() - started).toFixed(1)),
    finalFen: game.fen(),
    startFen
  };
}

const games = [];
for (const [name, line] of OPENINGS) {
  games.push(runGame(name, line, 1));
  games.push(runGame(name, line, -1));
}
const points = games.reduce((sum, game) => sum + game.points, 0);
const wins = games.filter(game => game.points === 1).length;
const draws = games.filter(game => game.points === 0.5).length;
const losses = games.filter(game => game.points === 0).length;
const summary = {
  suite: 'StoneFish v6.1 vs v6 head-to-head',
  scoring: '1 point win, 0.5 point draw, 0 points loss',
  searchOptions: OPTIONS,
  games: games.length,
  v61: { wins, draws, losses, points, scorePercent: Number((100 * points / games.length).toFixed(1)) },
  completedDepthTotals: games.reduce((all, game) => {
    for (const model of ['v6', 'v61']) {
      for (const [depth, count] of Object.entries(game.completedDepths[model])) {
        all[model][depth] = (all[model][depth] || 0) + count;
      }
    }
    return all;
  }, { v6: {}, v61: {} }),
  elapsedMs: Number(games.reduce((sum, game) => sum + game.elapsedMs, 0).toFixed(1)),
  results: games
};
console.log(JSON.stringify(summary, null, 2));
