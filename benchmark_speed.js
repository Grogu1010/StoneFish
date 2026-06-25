const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.window = global;
global.addEventListener = function () {};
global.document = {};
global.performance = { now: () => Date.now() };
for (const file of [
  'chess.js', 'stonefishv1.js', 'stonefishv2.js', 'stonefishv3.js', 'stonefishv3.1.js',
  'stonefishv4.js', 'openings.js', 'stonefishv4.5flash.js', 'stonefishv4.5.js',
  'stonefishv5flash.js', 'stonefishv5.js', 'stonefishv6flash.js', 'stonefishv6.js'
]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

function legal(sim, m) {
  return sim.getAllLegalMoves(sim.state.turn).some(x => x.from.r === m.from.r && x.from.c === m.from.c && x.to.r === m.to.r && x.to.c === m.to.c);
}
function timeEngine(engine, sim, side) {
  const start = Date.now();
  engine.chooseMove(sim, side);
  return Date.now() - start;
}
const sim = new ChessGame();
const samples = [];
for (let ply = 0; ply < 40; ply++) {
  const side = sim.state.turn;
  const ms5 = timeEngine(StonefishV5, sim, side);
  const ms6f = timeEngine(StonefishV6Flash, sim, side);
  const ms6 = timeEngine(StonefishV6, sim, side);
  const chosen = StonefishV6Flash.chooseMove(sim, side);
  samples.push({ ply: ply + 1, side, ms5, ms6f, ms6 });
  const move = chosen && legal(sim, chosen) ? chosen : sim.getAllLegalMoves(side)[0];
  const from = sim.squareName(move.from.r, move.from.c), to = sim.squareName(move.to.r, move.to.c);
  sim.applyMoveToState(sim.state, move);
  sim.moveHistory.push({ from, to, color: side, label: 'benchmark' });
  const status = sim.getStatus(sim.state);
  if (status.over) break;
}
function sum(key) { return samples.reduce((a, s) => a + s[key], 0); }
const total5 = sum('ms5'), total6f = sum('ms6f'), total6 = sum('ms6');
console.log(JSON.stringify({
  samples: samples.length,
  totalMsV5: total5,
  totalMsV6Flash: total6f,
  totalMsV6: total6,
  avgMsV5: total5 / samples.length,
  avgMsV6Flash: total6f / samples.length,
  avgMsV6: total6 / samples.length,
  v6FlashSpeedupVsV5Pct: (1 - total6f / total5) * 100,
  v6SlowdownVsV5Pct: (total6 / total5 - 1) * 100
}, null, 2));
