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

function sameMove(game, publicMove, raw) {
  if (!publicMove || !raw) return false;
  const uci = publicMove.from + publicMove.to + (publicMove.promotion || '');
  return uci === stonefishV45RawUci(game, raw);
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

const originalRandom = Math.random;
Math.random = seededRandom(0x5100B00C);
const game = new Chess();
let checkedPlies = 0;
const line = [];

try {
  while (checkedPlies < 18) {
    const expected = stonefishV45BookMove(game, 0);
    if (!expected) break;

    const v5Move = getStonefishV5Move(game);
    const proMove = getStonefishV5ProMove(game);
    if (!sameMove(game, v5Move, expected)) {
      throw new Error(`v5 left inherited book at ply ${checkedPlies + 1}: expected ${stonefishV45RawUci(game, expected)}, got ${v5Move ? v5Move.from + v5Move.to + (v5Move.promotion || '') : 'null'}`);
    }
    if (!sameMove(game, proMove, expected)) {
      throw new Error(`v5 Pro left inherited book at ply ${checkedPlies + 1}: expected ${stonefishV45RawUci(game, expected)}, got ${proMove ? proMove.from + proMove.to + (proMove.promotion || '') : 'null'}`);
    }

    const publicMove = stonefishV3PublicMove(game, expected);
    line.push(publicMove.from + publicMove.to + (publicMove.promotion || ''));
    const played = game.move({ from: publicMove.from, to: publicMove.to, promotion: publicMove.promotion || 'q' });
    if (!played) throw new Error(`Could not play inherited book move at ply ${checkedPlies + 1}`);
    checkedPlies += 1;
  }
} finally {
  Math.random = originalRandom;
}

if (checkedPlies < 8) {
  throw new Error(`Opening inheritance test exercised only ${checkedPlies} plies; expected at least 8.`);
}

// Ensure the wrappers do not replace the post-book engines: once no profile-0
// continuation exists, each public function must still return a normal legal move.
while (stonefishV45BookMove(game, 0)) {
  const raw = stonefishV45BookMove(game, 0);
  const move = stonefishV3PublicMove(game, raw);
  if (!game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' })) break;
}
const v5AfterBook = getStonefishV5Move(game);
const proAfterBook = getStonefishV5ProMove(game);
if (!v5AfterBook || !proAfterBook) {
  throw new Error('v5 or v5 Pro failed to fall back to normal engine logic after book.');
}

console.log('STONEFISH_V5_OPENING_INHERITANCE ' + JSON.stringify({
  profile: STONEFISH_V5_INHERITED_OPENING_PROFILE,
  checkedPlies,
  line,
  browserStack: true,
  workerStack: true,
  postBookFallback: true
}));
