// Regression check for the inherited v4.5/v5-testunit1 opening capability.
// v5 and v5 Pro must follow the profile-0 weighted repertoire while a
// compatible book line exists, then retain their normal engines after book.

const fs = require('fs');
const vm = require('vm');

const files = [
  'StonefishChess.js',
  'Stonefish_v3.js',
  'Stonefish_v4.js',
  'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js',
  'Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js',
  'Stonefish_v5.js',
  'Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js',
  'Stonefish_v5_pro_geometry_patch.js',
  'Stonefish_v5_opening_inheritance_patch.js'
];

vm.runInThisContext(files.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v5-opening-inheritance-bundle.js'
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

function publicUci(move) {
  return move ? move.from + move.to + (move.promotion || '') : 'null';
}

function sameMove(game, publicMove, raw) {
  return !!publicMove && !!raw && publicUci(publicMove) === stonefishV45RawUci(game, raw);
}

function playUci(game, uci) {
  const played = game.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : 'q'
  });
  if (!played) throw new Error(`Could not construct opening prefix at ${uci}`);
}

if (STONEFISH_V5_INHERITED_OPENING_PROFILE !== 0) {
  throw new Error(`Expected inherited opening profile 0, got ${STONEFISH_V5_INHERITED_OPENING_PROFILE}`);
}

const indexSource = fs.readFileSync('index.html', 'utf8');
const workerSource = fs.readFileSync('test-worker.js', 'utf8');
if (!indexSource.includes('Stonefish_v5_opening_inheritance_patch.js')) {
  throw new Error('Browser does not load the v5 opening inheritance patch.');
}
if (!workerSource.includes('Stonefish_v5_pro_geometry_patch.js') || !workerSource.includes('Stonefish_v5_opening_inheritance_patch.js')) {
  throw new Error('Worker does not load the shipped Pro geometry + opening stack.');
}

const probes = [
  { id: 'w_berlin', lengths: [0, 2, 4, 6, 8, 10] },
  { id: 'b_berlin', lengths: [1, 3, 5] },
  { id: 'w_najdorf', lengths: [4, 6, 8, 10] },
  { id: 'b_najdorf', lengths: [1, 3, 5, 7, 9] },
  { id: 'w_catalan_open', lengths: [2, 4, 6, 8] },
  { id: 'b_nimzo', lengths: [1, 3, 5, 7] }
];

const originalRandom = Math.random;
Math.random = seededRandom(0x5100B00C);
let checkedPositions = 0;
const samples = [];

try {
  for (const probe of probes) {
    const line = STONEFISH_V45_OPENINGS.find(entry => entry.id === probe.id);
    if (!line) throw new Error(`Missing opening line ${probe.id}`);

    for (const prefixLength of probe.lengths) {
      if (prefixLength >= line.moves.length) continue;
      const game = new Chess();
      for (const uci of line.moves.slice(0, prefixLength)) playUci(game, uci);

      const expected = stonefishV45BookMove(game, 0);
      if (!expected) {
        throw new Error(`Profile-0 book unexpectedly missing for ${probe.id} prefix ${prefixLength}`);
      }

      const v5Move = getStonefishV5Move(game);
      const proMove = getStonefishV5ProMove(game);
      const expectedUci = stonefishV45RawUci(game, expected);
      if (!sameMove(game, v5Move, expected)) {
        throw new Error(`v5 left inherited book at ${probe.id}/${prefixLength}: expected ${expectedUci}, got ${publicUci(v5Move)}`);
      }
      if (!sameMove(game, proMove, expected)) {
        throw new Error(`v5 Pro left inherited book at ${probe.id}/${prefixLength}: expected ${expectedUci}, got ${publicUci(proMove)}`);
      }

      checkedPositions += 1;
      if (samples.length < 8) samples.push(`${probe.id}@${prefixLength}:${expectedUci}`);
    }
  }
} finally {
  Math.random = originalRandom;
}

if (checkedPositions < 16) {
  throw new Error(`Opening inheritance test exercised only ${checkedPositions} compatible positions.`);
}

// Force a position outside every stored repertoire first move. With no book
// continuation, both wrappers must hand control back to the existing engines.
const offBook = new Chess();
for (const uci of ['a2a3', 'a7a6', 'h2h3', 'h7h6']) playUci(offBook, uci);
if (stonefishV45BookMove(offBook, 0)) {
  throw new Error('Expected deliberately constructed position to be out of book.');
}
const v5AfterBook = getStonefishV5Move(offBook);
const proAfterBook = getStonefishV5ProMove(offBook);
if (!v5AfterBook || !proAfterBook) {
  throw new Error('v5 or v5 Pro failed to fall back to normal engine logic after book.');
}

console.log('STONEFISH_V5_OPENING_INHERITANCE ' + JSON.stringify({
  profile: STONEFISH_V5_INHERITED_OPENING_PROFILE,
  checkedPositions,
  samples,
  browserStack: true,
  workerStack: true,
  postBookFallback: true
}));
