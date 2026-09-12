// Honest Stonefish v5 Pro vs v5 benchmark with hard strength and speed gates.
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
  'Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js'
];
if (fs.existsSync('Stonefish_v5_pro_geometry_patch.js')) {
  engineFiles.push('Stonefish_v5_pro_geometry_patch.js');
}
if (fs.existsSync('Stonefish_v5_opening_inheritance_patch.js')) {
  engineFiles.push('Stonefish_v5_opening_inheritance_patch.js');
}

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

function timedMove(fn, game) {
  const start = process.hrtime.bigint();
  const move = fn(game);
  const elapsed = process.hrtime.bigint() - start;
  return { move, elapsed };
}

function simulateGame(proIsWhite, seed, maxPlies = 600, debug = false) {
  const game = new Chess();
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  let plies = 0;
  let result = 'draw';
  let reason = 'max-plies';
  let proNanos = 0n, v5Nanos = 0n;
  let proMoves = 0, v5Moves = 0;
  const trace = [];

  try {
    while (!game.game_over() && plies < maxPlies) {
      const proTurn = (game.side === 1) === proIsWhite;
      let move, elapsed;
      if (proTurn && debug) {
        const timed = timedMove(() => {
          const scored = stonefishV5ProScoreAllMoves(game);
          const top = scored.slice(0, 8).map(entry => {
            const uci = stonefishV45RawUci(game, entry.raw);
            const deep = entry.deep === null ? 'na' : entry.deep.toFixed(1);
            const tactical = entry.tactical === null || entry.tactical === undefined ? 'na' : entry.tactical.toFixed(1);
            const scout = entry.scout === undefined ? 'na' : entry.scout.toFixed(1);
            const heritage = entry.heritageMatch ? 'H' : '-';
            return `${uci}{total=${entry.score.toFixed(1)},deep=${deep},tac=${tactical},scout=${scout},heritage=${heritage},pre=${entry.preliminary.toFixed(1)}}`;
          }).join(' ');
          console.log(`DEBUG ply=${plies} side=${game.turn()} top=${top}`);
          return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
        }, game);
        move = timed.move; elapsed = timed.elapsed;
      } else {
        const timed = proTurn
          ? timedMove(getStonefishV5ProMove, game)
          : timedMove(getStonefishV5Move, game);
        move = timed.move; elapsed = timed.elapsed;
      }

      if (proTurn) { proNanos += elapsed; proMoves += 1; }
      else { v5Nanos += elapsed; v5Moves += 1; }

      if (move) trace.push(`${proTurn ? 'pro' : 'v5'}:${move.from}${move.to}${move.promotion || ''}`);
      const played = playPublicMove(game, move);
      if (!played) {
        result = proTurn ? 'loss' : 'win';
        reason = proTurn ? 'pro-invalid-move' : 'v5-invalid-move';
        return { result, reason, plies, trace, proNanos, v5Nanos, proMoves, v5Moves };
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
    return { result, reason, plies, trace, proNanos, v5Nanos, proMoves, v5Moves };
  } finally {
    Math.random = originalRandom;
  }
}

function runMatch(games = 100, startIndex = 0) {
  const totals = { win: 0, loss: 0, draw: 0 };
  const reasons = {};
  let totalPlies = 0;
  let proNanos = 0n, v5Nanos = 0n;
  let proMoves = 0, v5Moves = 0;
  const debugGame = Number.parseInt(process.env.DEBUG_GAME || '0', 10) || 0;

  for (let i = 0; i < games; i += 1) {
    const globalIndex = startIndex + i;
    const gameNumber = globalIndex + 1;
    const proIsWhite = globalIndex % 2 === 0;
    const result = simulateGame(proIsWhite, 0x5F50A11 + globalIndex * 977, 600, gameNumber === debugGame);
    totals[result.result] += 1;
    reasons[result.reason] = (reasons[result.reason] || 0) + 1;
    totalPlies += result.plies;
    proNanos += result.proNanos; v5Nanos += result.v5Nanos;
    proMoves += result.proMoves; v5Moves += result.v5Moves;
    console.log(`${String(gameNumber).padStart(3, '0')} pro=${proIsWhite ? 'W' : 'B'} ${result.result.toUpperCase()} ${result.reason} ${result.plies} plies`);
    if (result.result !== 'win') console.log(`TRACE game ${gameNumber}: ${result.trace.slice(-48).join(' ')}`);
  }

  const proAvgMs = proMoves ? Number(proNanos) / 1e6 / proMoves : 0;
  const v5AvgMs = v5Moves ? Number(v5Nanos) / 1e6 / v5Moves : 0;
  const summary = {
    games,
    startIndex,
    endIndex: startIndex + games - 1,
    proWins: totals.win,
    proLosses: totals.loss,
    draws: totals.draw,
    winRate: totals.win / games,
    averagePlies: totalPlies / games,
    proMoves,
    v5Moves,
    proAvgMs,
    v5AvgMs,
    speedRatio: v5AvgMs > 0 ? proAvgMs / v5AvgMs : null,
    reasons
  };
  console.log('\nSTONEFISH_V5_PRO_BENCHMARK ' + JSON.stringify(summary));
  return summary;
}

const games = Math.max(2, Number.parseInt(process.env.GAMES || '100', 10) || 100);
const startIndex = Math.max(0, Number.parseInt(process.env.START_INDEX || '0', 10) || 0);
const summary = runMatch(games, startIndex);
if (summary.proWins !== games || summary.proLosses !== 0 || summary.draws !== 0) {
  console.error(`Pro 100% strength target not reached: ${summary.proWins}W/${summary.proLosses}L/${summary.draws}D.`);
  process.exitCode = 1;
}
if (!(summary.proAvgMs <= summary.v5AvgMs)) {
  console.error(`Pro speed target not reached: ${summary.proAvgMs.toFixed(3)} ms/move vs v5 ${summary.v5AvgMs.toFixed(3)} ms/move.`);
  process.exitCode = 1;
}
