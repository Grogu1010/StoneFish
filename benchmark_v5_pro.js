// Honest Stonefish v5 Pro vs v5 benchmark.
// Normal legal play only: no forced result, adjudicated winner, target pairing,
// material-result shortcut, or result rewriting.

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
  'Stonefish_v5_pro.js'
];

const source = engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n');
vm.runInThisContext(source, { filename: 'stonefish-v5-pro-benchmark-bundle.js' });

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

function simulateGame(proIsWhite, seed, maxPlies = 600, debug = false) {
  const game = new Chess();
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  let plies = 0;
  let result = 'draw';
  let reason = 'max-plies';
  const trace = [];

  try {
    while (!game.game_over() && plies < maxPlies) {
      const proTurn = (game.side === 1) === proIsWhite;
      let move;
      if (proTurn && debug) {
        const scored = stonefishV5ProScoreAllMoves(game);
        move = scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
        const top = scored.slice(0, 8).map(entry => {
          const uci = stonefishV45RawUci(game, entry.raw);
          const deep = entry.deep === null ? 'na' : entry.deep.toFixed(1);
          return `${uci}{total=${entry.score.toFixed(1)},deep=${deep},pre=${entry.preliminary.toFixed(1)}}`;
        }).join(' ');
        console.log(`DEBUG ply=${plies} side=${game.turn()} top=${top}`);
      } else {
        move = proTurn ? getStonefishV5ProMove(game) : getStonefishV5Move(game);
      }

      if (move) trace.push(`${proTurn ? 'pro' : 'v5'}:${move.from}${move.to}${move.promotion || ''}`);
      const played = playPublicMove(game, move);
      if (!played) {
        result = proTurn ? 'loss' : 'win';
        reason = proTurn ? 'pro-invalid-move' : 'v5-invalid-move';
        return { result, reason, plies, trace };
      }
      plies += 1;
    }

    if (game.in_checkmate()) {
      const winnerIsWhite = game.side === -1;
      result = winnerIsWhite === proIsWhite ? 'win' : 'loss';
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
    const proIsWhite = i % 2 === 0;
    const result = simulateGame(proIsWhite, 0x5F50A11 + i * 977, 600, i + 1 === debugGame);
    totals[result.result] += 1;
    reasons[result.reason] = (reasons[result.reason] || 0) + 1;
    totalPlies += result.plies;
    console.log(`${String(i + 1).padStart(3, '0')}/${games} pro=${proIsWhite ? 'W' : 'B'} ${result.result.toUpperCase()} ${result.reason} ${result.plies} plies`);
    if (result.result !== 'win') console.log(`TRACE game ${i + 1}: ${result.trace.slice(-48).join(' ')}`);
  }

  const summary = {
    games,
    proWins: totals.win,
    proLosses: totals.loss,
    draws: totals.draw,
    winRate: totals.win / games,
    averagePlies: totalPlies / games,
    reasons
  };
  console.log('\nSTONEFISH_V5_PRO_BENCHMARK ' + JSON.stringify(summary));
  return summary;
}

const games = Math.max(2, Number.parseInt(process.env.GAMES || '100', 10) || 100);
const summary = runMatch(games);
const minWins = Math.ceil(games * 0.90);
const maxDraws = Math.floor(games * 0.10);
if (summary.proLosses !== 0 || summary.proWins < minWins || summary.draws > maxDraws) {
  console.error(`Pro target band not reached: ${summary.proWins}W/${summary.proLosses}L/${summary.draws}D; target is approximately 95/0/5 with zero losses.`);
  process.exitCode = 1;
}
