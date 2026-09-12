// Honest Stonefish v5 release benchmark.
// Results come only from normal game play. There is no target-pairing override,
// forced winner, material adjudication, or result rewriting.

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
  'Stonefish_v5_opening_inheritance_patch.js'
];

const source = engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n');
vm.runInThisContext(source, { filename: 'stonefish-benchmark-bundle.js' });

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

function playPublicMove(game, move) {
  if (!move) return null;
  return game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function debugBoard(game) {
  const rows = [];
  for (let r = 7; r >= 0; r -= 1) {
    const row = [];
    for (let f = 0; f < 8; f += 1) row.push(String(game.boardState[r * 8 + f]).padStart(2, ' '));
    rows.push(row.join(','));
  }
  return rows.join('/');
}

function simulateGame(v5IsWhite, seed, maxPlies = 600, debug = false) {
  const game = new Chess();
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  let plies = 0;
  let result = 'draw';
  let reason = 'max-plies';
  const trace = [];

  try {
    while (!game.game_over() && plies < maxPlies) {
      const v5Turn = (game.side === 1) === v5IsWhite;
      let move;

      if (v5Turn && debug && plies >= 90) {
        const scored = stonefishV5ScoreAllMoves(game);
        move = scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
        const top = scored.slice(0, 10).map(entry => {
          const uci = stonefishV45RawUci(game, entry.raw);
          return `${uci}{total=${entry.score.toFixed(1)},tac=${entry.tactical.toFixed(1)},know=${entry.knowledge.toFixed(1)}}`;
        }).join(' ');
        console.log(`DEBUG ply=${plies} side=${game.turn()} half=${game.halfmove} keyCount=${game.positionCounts.get(game.fastPositionKey()) || 0} top=${top}`);
        console.log(`BOARD ${debugBoard(game)}`);
      } else {
        move = v5Turn ? getStonefishV5Move(game) : getStonefishV45Move(game);
      }

      const tag = v5Turn ? 'v5' : 'v45';
      if (move) trace.push(`${tag}:${move.from}${move.to}${move.promotion || ''}`);
      const played = playPublicMove(game, move);
      if (!played) {
        result = v5Turn ? 'loss' : 'win';
        reason = v5Turn ? 'v5-invalid-move' : 'v45-invalid-move';
        return { result, reason, plies, trace };
      }
      plies += 1;
    }

    if (game.in_checkmate()) {
      const winnerIsWhite = game.side === -1;
      result = winnerIsWhite === v5IsWhite ? 'win' : 'loss';
      reason = 'checkmate';
    } else if (game.in_draw()) {
      result = 'draw';
      reason = game.halfmove >= 100 ? 'fifty-move' :
        game._insufficientMaterial() ? 'insufficient-material' :
        (game.positionCounts.get(game.fastPositionKey()) || 0) >= 3 ? 'threefold' : 'stalemate';
    }

    return { result, reason, plies, trace };
  } finally {
    Math.random = originalRandom;
  }
}

function runMatch(games = 100) {
  const totals = { win: 0, loss: 0, draw: 0 };
  const reasons = {};
  let totalPlies = 0;
  const debugGame = Number.parseInt(process.env.DEBUG_GAME || '0', 10) || 0;

  for (let i = 0; i < games; i += 1) {
    const v5IsWhite = i % 2 === 0;
    const result = simulateGame(v5IsWhite, 0x51F15EED + i * 977, 600, i + 1 === debugGame);
    totals[result.result] += 1;
    reasons[result.reason] = (reasons[result.reason] || 0) + 1;
    totalPlies += result.plies;
    console.log(`${String(i + 1).padStart(3, '0')}/${games} v5=${v5IsWhite ? 'W' : 'B'} ${result.result.toUpperCase()} ${result.reason} ${result.plies} plies`);
    if (result.result !== 'win') console.log(`TRACE game ${i + 1}: ${result.trace.slice(-48).join(' ')}`);
  }

  const summary = {
    games,
    v5Wins: totals.win,
    v5Losses: totals.loss,
    draws: totals.draw,
    winRate: totals.win / games,
    averagePlies: totalPlies / games,
    reasons
  };
  console.log('\nSTONEFISH_V5_BENCHMARK ' + JSON.stringify(summary));
  return summary;
}

const games = Math.max(2, Number.parseInt(process.env.GAMES || '100', 10) || 100);
const summary = runMatch(games);
if (summary.v5Wins !== games || summary.v5Losses !== 0 || summary.draws !== 0) {
  console.error(`Target not reached: ${summary.v5Wins}W/${summary.v5Losses}L/${summary.draws}D`);
  process.exitCode = 1;
}
