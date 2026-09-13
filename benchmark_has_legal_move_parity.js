// Same-run parity/performance gate for fastHasLegalMove().
// Candidate must agree with released main and with complete legal move generation
// at every deterministic position. Timing alternates candidate/reference order.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');

function makeRuntime(dir) {
  const ctx = vm.createContext({ console, Int8Array, Uint8Array, Map, Math });
  const source = ['StonefishChess.js', 'Stonefish_runtime_speed_patch.js']
    .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n\n');
  vm.runInContext(source + '\nthis.__Chess = Chess;', ctx, {
    filename: path.join(dir, 'stonefish-has-legal-bundle.js')
  });
  return ctx;
}

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

function moveKey(move) {
  return `${move.from}:${move.to}:${move.promotion || 0}:${move.flags || 0}:${move.piece || 0}:${move.captured || 0}`;
}

function compareMoves(position, a, b) {
  if (a.length !== b.length) {
    throw new Error(`move-count mismatch position=${position} candidate=${a.length} reference=${b.length}`);
  }
  for (let i = 0; i < a.length; i += 1) {
    if (moveKey(a[i]) !== moveKey(b[i])) {
      throw new Error(`move mismatch position=${position} index=${i} candidate=${moveKey(a[i])} reference=${moveKey(b[i])}`);
    }
  }
}

function timedHasLegal(game, repeats) {
  let value = false;
  const start = process.hrtime.bigint();
  for (let i = 0; i < repeats; i += 1) value = game.fastHasLegalMove();
  return { value, elapsed: process.hrtime.bigint() - start };
}

const candidateRuntime = makeRuntime(process.cwd());
const referenceRuntime = makeRuntime(referenceDir);
const candidateGame = new candidateRuntime.__Chess();
const referenceGame = new referenceRuntime.__Chess();
const random = seededRandom(0x7a11e9a1);
const targetPositions = Math.max(200, Number.parseInt(process.env.HAS_LEGAL_POSITIONS || '5000', 10) || 5000);
const timingRepeats = Math.max(1, Number.parseInt(process.env.HAS_LEGAL_REPEATS || '20', 10) || 20);
const maxGamePlies = 260;

let positions = 0;
let positionsInCheck = 0;
let terminalPositions = 0;
let legalMovesCompared = 0;
let candidateNs = 0n;
let referenceNs = 0n;
let gamePly = 0;

while (positions < targetPositions) {
  const candidateMoves = candidateGame.fastMoves();
  const referenceMoves = referenceGame.fastMoves();
  compareMoves(positions, candidateMoves, referenceMoves);
  legalMovesCompared += candidateMoves.length;

  const expected = candidateMoves.length > 0;
  const candidateOnce = candidateGame.fastHasLegalMove();
  const referenceOnce = referenceGame.fastHasLegalMove();
  if (candidateOnce !== expected || referenceOnce !== expected) {
    throw new Error(
      `has-legal mismatch position=${positions} expected=${expected} candidate=${candidateOnce} reference=${referenceOnce}`
    );
  }

  if (candidateGame.in_check()) positionsInCheck += 1;
  if (!expected) terminalPositions += 1;

  let candidateTimed;
  let referenceTimed;
  if ((positions & 1) === 0) {
    candidateTimed = timedHasLegal(candidateGame, timingRepeats);
    referenceTimed = timedHasLegal(referenceGame, timingRepeats);
  } else {
    referenceTimed = timedHasLegal(referenceGame, timingRepeats);
    candidateTimed = timedHasLegal(candidateGame, timingRepeats);
  }
  if (candidateTimed.value !== expected || referenceTimed.value !== expected) {
    throw new Error(`timed has-legal mismatch position=${positions}`);
  }
  candidateNs += candidateTimed.elapsed;
  referenceNs += referenceTimed.elapsed;

  positions += 1;
  if (!candidateMoves.length || gamePly >= maxGamePlies) {
    candidateGame.reset();
    referenceGame.reset();
    gamePly = 0;
    continue;
  }

  const index = Math.floor(random() * candidateMoves.length);
  candidateGame.fastApply(candidateMoves[index]);
  referenceGame.fastApply(referenceMoves[index]);
  gamePly += 1;

  if (candidateGame.fen() !== referenceGame.fen()) {
    throw new Error(`state mismatch after position=${positions - 1}`);
  }
}

const candidateMs = Number(candidateNs) / 1e6;
const referenceMs = Number(referenceNs) / 1e6;
const speedup = candidateMs > 0 ? referenceMs / candidateMs : Infinity;
console.log(JSON.stringify({
  type: 'STONEFISH_HAS_LEGAL_MOVE_PARITY',
  positions,
  positionsInCheck,
  terminalPositions,
  legalMovesCompared,
  timingRepeats,
  referenceMs: Number(referenceMs.toFixed(3)),
  candidateMs: Number(candidateMs.toFixed(3)),
  speedup: Number(speedup.toFixed(3)),
  status: 'PASS'
}));
