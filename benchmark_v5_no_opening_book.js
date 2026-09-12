// Prove that v5 and v5 Pro do not consult the shared v4.5 opening book,
// while v4.5 keeps its existing opening capability.

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
  'Stonefish_v5_no_opening_book_patch.js'
];

vm.runInThisContext(files.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v5-no-opening-book-bundle.js'
});

if (STONEFISH_V5_WEIGHTS.book !== 0) {
  throw new Error(`Expected v5 opening-book weight 0, got ${STONEFISH_V5_WEIGHTS.book}`);
}

const realBookMove = stonefishV45BookMove;
let bookCalls = 0;
stonefishV45BookMove = function(...args) {
  bookCalls += 1;
  return realBookMove(...args);
};

const v5Game = new Chess();
stonefishV5ScoreAllMoves(v5Game);
if (bookCalls !== 0) {
  throw new Error(`v5 consulted the opening book ${bookCalls} time(s)`);
}

const proGame = new Chess();
stonefishV5ProScoreAllMoves(proGame);
if (bookCalls !== 0) {
  throw new Error(`v5 Pro consulted the opening book ${bookCalls} time(s)`);
}

const v45Game = new Chess();
getStonefishV45Move(v45Game);
if (bookCalls === 0) {
  throw new Error('v4.5 no longer consulted its opening book');
}

for (const path of ['index.html', 'test-worker.js', 'benchmark_v5.js', 'benchmark_v5_pro.js']) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes('Stonefish_v5_no_opening_book_patch.js')) {
    throw new Error(`${path} does not load the no-book layer`);
  }
}

console.log('STONEFISH_V5_NO_OPENING_BOOK ' + JSON.stringify({
  v5BookCalls: 0,
  proBookCalls: 0,
  v45BookCalls: bookCalls,
  v5BookWeight: STONEFISH_V5_WEIGHTS.book,
  loadersVerified: true
}));
