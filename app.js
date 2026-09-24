const game = new Chess();

const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const lastMoveElement = document.getElementById('last-move');
const newGameButton = document.getElementById('new-game');
const modelSelect = document.getElementById('model-select');
const heroModel = document.getElementById('hero-model');
const heroSubtitle = document.getElementById('hero-subtitle');
const botTrait = document.getElementById('bot-trait');
const logicLines = document.getElementById('logic-lines');
const watchButton = document.getElementById('watch-game');
const testCountInput = document.getElementById('test-count');
const runTestButton = document.getElementById('run-test');
const testResults = document.getElementById('test-results');
const testModelCheckboxes = [...document.querySelectorAll('input[name="test-model"]')];

const pieceSymbols = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚'
};

const v4Logic = [
  'Take mate in 1 and preserve v3 tactical/material safety',
  'Prefer stronger promotions and immediate castling',
  'Develop minor pieces before positional tie-breaks',
  'Avoid leaving high-value own pieces hanging',
  'When ahead by 2.5+ material, avoid cycling back to an already-seen position',
  'Prefer more legal movement options',
  'Use queen discipline, repetition, 50-move, endgame, support, king, centre, pawn, rook, and control tie-breaks'
];

const v45Logic = [
  'Recognise common forced-mate geometries',
  'Follow a weighted 25-line White / 25-line Black opening repertoire',
  'If the opponent leaves the chosen line, re-weight only openings still compatible with the game',
  'Use Stonefish_v4 tactical/material and positional filtering as the base',
  'Use inverse knowledge to restrict opponent checking chances and mobility',
  'Keep tightening named mating nets such as ladder, triangle, back-rank, smothered, Arabian, kill-box, and Boden patterns'
];

const models = {
  v1: { name: 'Stonefish_v1', trait: 'Random-move engine', subtitle: 'It sees every legal move and picks one completely at random.', logic: ['Find every legal move', 'Pick one at random', 'Play it'], getMove: getStonefishMove },
  v2: { name: 'Stonefish_v2', trait: 'One-ply defensive engine', subtitle: 'Takes mate in one, avoids giving mate in one, then minimises the biggest capture available to the opponent next move.', logic: ['Take mate in 1', 'Avoid allowing mate in 1', 'Minimise the opponent’s biggest next capture'], getMove: getStonefishV2Move },
  v3: { name: 'Stonefish_v3', trait: 'Three-ply material engine', subtitle: 'Scores material across its move, the opponent’s best reply, and its own best response. Bishops are worth 3.1.', logic: ['Take mate in 1', 'Avoid opponent mate in 1 whenever possible', 'Maximise the worst three-ply material trade'], getMove: getStonefishV3Move },
  v4: { name: 'Stonefish_v4', trait: 'Same-depth positional engine', subtitle: 'Stonefish_v3 material logic plus the tested same-depth v4 development, safety, mobility, repetition, and positional filters.', logic: v4Logic, getMove: getStonefishV4Move },
  v45: { name: 'Stonefish_v4.5', trait: 'Knowledge-layer engine', subtitle: 'Stonefish_v4 plus weighted openings, forced-mate patterns, and inverse opponent-restriction filters.', logic: v45Logic, getMove: getStonefishV45Move }
};

let selectedSquare = null;
let legalTargets = [];
let botThinking = false;
let lastMoveSquares = [];
let selectedModel = 'v45';
let watchTimer = null;
let watchMode = false;
let testing = false;
let testWorker = null;

function clearV45BookState() { if (typeof STONEFISH_V45_BOOK_STATE !== 'undefined') STONEFISH_V45_BOOK_STATE.delete(game); }

function renderBoard() {
  boardElement.innerHTML = '';
  for (let rank = 8; rank >= 1; rank -= 1) {
    for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
      const file = String.fromCharCode(97 + fileIndex);
      const square = `${file}${rank}`;
      const piece = game.get(square);
      const squareButton = document.createElement('button');
      squareButton.type = 'button';
      squareButton.className = `square ${(rank + fileIndex) % 2 === 0 ? 'light' : 'dark'}`;
      squareButton.dataset.square = square;
      squareButton.setAttribute('role', 'gridcell');
      squareButton.setAttribute('aria-label', describeSquare(square, piece));
      if (selectedSquare === square) squareButton.classList.add('selected');
      if (legalTargets.includes(square)) squareButton.classList.add('legal-target');
      if (lastMoveSquares.includes(square)) squareButton.classList.add('last-move-square');
      if (piece) {
        const pieceSpan = document.createElement('span');
        pieceSpan.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
        pieceSpan.textContent = pieceSymbols[`${piece.color}${piece.type}`];
        squareButton.appendChild(pieceSpan);
      }
      squareButton.addEventListener('click', () => handleSquareClick(square));
      boardElement.appendChild(squareButton);
    }
  }
}

function describeSquare(square, piece) {
  if (!piece) return `${square}, empty`;
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  return `${square}, ${piece.color === 'w' ? 'White' : 'Black'} ${names[piece.type]}`;
}

function clearSelection() { selectedSquare = null; legalTargets = []; }
function selectSquare(square) { selectedSquare = square; legalTargets = game.moves({ square, verbose: true }).map(move => move.to); renderBoard(); }

function handleSquareClick(square) {
  if (watchMode || testing || botThinking || game.game_over() || game.turn() !== 'w') return;
  const piece = game.get(square);
  if (!selectedSquare) { if (piece && piece.color === 'w') selectSquare(square); return; }
  if (square === selectedSquare) { clearSelection(); renderBoard(); return; }
  if (piece && piece.color === 'w') { selectSquare(square); return; }
  const move = game.move({ from: selectedSquare, to: square, promotion: 'q' });
  if (!move) return;
  lastMoveSquares = [move.from, move.to];
  clearSelection();
  lastMoveElement.textContent = `You played ${move.san}.`;
  updateStatus();
  renderBoard();
  if (!game.game_over()) {
    botThinking = true;
    statusElement.textContent = `${models[selectedModel].name} is thinking…`;
    window.setTimeout(makeSelectedBotMove, 450);
  }
}

function playMoveOnGame(targetGame, move) { return move ? targetGame.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }) : null; }

function makeSelectedBotMove() {
  const model = models[selectedModel];
  const move = model.getMove(game);
  if (move) {
    const playedMove = playMoveOnGame(game, move);
    lastMoveSquares = [playedMove.from, playedMove.to];
    lastMoveElement.textContent = `${model.name} played ${playedMove.san}.`;
  }
  botThinking = false;
  updateStatus();
  renderBoard();
}

function updateStatus() {
  if (watchMode) return updateWatchStatus();
  if (game.in_checkmate()) { statusElement.textContent = `Checkmate. ${game.turn() === 'w' ? models[selectedModel].name : 'You'} won.`; return; }
  if (game.in_draw()) { statusElement.textContent = 'Draw.'; return; }
  const checkText = game.in_check() ? ' Check!' : '';
  statusElement.textContent = game.turn() === 'w' ? `Your move. You are White.${checkText}` : `${models[selectedModel].name} to move.${checkText}`;
}

function updateModelUI() {
  const model = models[selectedModel];
  heroModel.textContent = model.name;
  heroSubtitle.textContent = model.subtitle;
  botTrait.innerHTML = `<span class="status-dot"></span> ${model.trait}`;
  logicLines.innerHTML = model.logic.map((line, index) => `<div class="logic-line"><span>${index + 1}</span><p>${line}</p></div>`).join('');
}

function stopWatching() { watchMode = false; if (watchTimer) window.clearTimeout(watchTimer); watchTimer = null; watchButton.textContent = 'Watch v4 vs v4.5'; }

function resetGame() {
  stopWatching();
  game.reset();
  clearV45BookState();
  clearSelection();
  lastMoveSquares = [];
  botThinking = false;
  lastMoveElement.textContent = `${models[selectedModel].name} is waiting.`;
  renderBoard();
  updateStatus();
}

function startWatching() {
  if (testing) return;
  if (watchMode) { stopWatching(); statusElement.textContent = 'Spectator game paused.'; return; }
  game.reset(); clearV45BookState(); clearSelection(); lastMoveSquares = []; watchMode = true;
  watchButton.textContent = 'Stop watching';
  lastMoveElement.textContent = 'Stonefish_v4 is White. Stonefish_v4.5 is Black.';
  renderBoard(); updateWatchStatus(); watchTimer = window.setTimeout(playWatchMove, 3000);
}

function updateWatchStatus() {
  if (game.in_checkmate()) { statusElement.textContent = `Checkmate. ${game.turn() === 'w' ? 'Stonefish_v4.5' : 'Stonefish_v4'} won the spectator game.`; stopWatching(); return; }
  if (game.in_draw()) { statusElement.textContent = 'Spectator game ended in a draw.'; stopWatching(); return; }
  statusElement.textContent = `${game.turn() === 'w' ? 'Stonefish_v4' : 'Stonefish_v4.5'} to move.${game.in_check() ? ' Check!' : ''}`;
}

function playWatchMove() {
  if (!watchMode || game.game_over()) return updateWatchStatus();
  const model = models[game.turn() === 'w' ? 'v4' : 'v45'];
  const playedMove = playMoveOnGame(game, model.getMove(game));
  if (playedMove) { lastMoveSquares = [playedMove.from, playedMove.to]; lastMoveElement.textContent = `${model.name} played ${playedMove.san}.`; }
  renderBoard(); updateWatchStatus();
  if (watchMode && !game.game_over()) watchTimer = window.setTimeout(playWatchMove, 3000);
}

function percent(value, total) { return total ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'; }
function pairKey(a, b) { return [a, b].sort().join('::'); }
function getSelectedTestModels() { return testModelCheckboxes.filter(box => box.checked).map(box => box.value); }

function createStats(selectedKeys) {
  const overall = {}, matchups = {};
  for (const key of selectedKeys) overall[key] = { wins: 0, losses: 0, draws: 0, games: 0 };
  for (let i = 0; i < selectedKeys.length; i += 1) for (let j = i + 1; j < selectedKeys.length; j += 1) {
    const a = selectedKeys[i], b = selectedKeys[j];
    matchups[pairKey(a, b)] = { a, b, aWins: 0, bWins: 0, draws: 0, games: 0, targetGames: 0 };
  }
  return { overall, matchups };
}

function buildSchedule(selectedKeys, totalGames, stats) {
  const pairs = [];
  for (let i = 0; i < selectedKeys.length; i += 1) for (let j = i + 1; j < selectedKeys.length; j += 1) pairs.push([selectedKeys[i], selectedKeys[j]]);
  const baseGames = Math.floor(totalGames / pairs.length), remainder = totalGames % pairs.length;
  const pairTargets = pairs.map((pair, index) => ({ pair, count: baseGames + (index < remainder ? 1 : 0) }));
  for (const entry of pairTargets) { const [a, b] = entry.pair; stats.matchups[pairKey(a, b)].targetGames = entry.count; }
  const jobs = [], maxRounds = Math.max(...pairTargets.map(entry => entry.count));
  for (let round = 0; round < maxRounds; round += 1) pairTargets.forEach((entry, pairIndex) => {
    if (round >= entry.count) return;
    const [a, b] = entry.pair, aIsWhite = (round + pairIndex) % 2 === 0;
    jobs.push({ a, b, whiteModelKey: aIsWhite ? a : b, blackModelKey: aIsWhite ? b : a });
  });
  return jobs;
}

function applyResult(stats, job, result) {
  const matchup = stats.matchups[pairKey(job.a, job.b)];
  matchup.games += 1; stats.overall[job.a].games += 1; stats.overall[job.b].games += 1;
  if (result === 'draw') { matchup.draws += 1; stats.overall[job.a].draws += 1; stats.overall[job.b].draws += 1; return; }
  const winner = result === 'white' ? job.whiteModelKey : job.blackModelKey;
  const loser = winner === job.a ? job.b : job.a;
  stats.overall[winner].wins += 1; stats.overall[loser].losses += 1;
  if (winner === matchup.a) matchup.aWins += 1; else matchup.bWins += 1;
}

function renderRoundRobin(stats, selectedKeys, completed, total, done = false) {
  const overallRows = selectedKeys.map(key => { const s = stats.overall[key]; return `<div class="result-row"><strong>${models[key].name}</strong><span>${s.wins}W · ${s.losses}L · ${s.draws}D · ${s.games} played</span><span>W ${percent(s.wins, s.games)} · L ${percent(s.losses, s.games)} · D ${percent(s.draws, s.games)}</span></div>`; }).join('');
  const matchupRows = Object.values(stats.matchups).map(m => { const aLosses = m.games - m.aWins - m.draws, bLosses = m.games - m.bWins - m.draws; return `<div class="matchup-row"><strong>${models[m.a].name} vs ${models[m.b].name}</strong><span>${m.games}/${m.targetGames} games</span><span>${models[m.a].name}: ${m.aWins}W · ${aLosses}L · ${m.draws}D — W ${percent(m.aWins, m.games)} · D ${percent(m.draws, m.games)}</span><span>${models[m.b].name}: ${m.bWins}W · ${bLosses}L · ${m.draws}D — W ${percent(m.bWins, m.games)} · D ${percent(m.draws, m.games)}</span></div>`; }).join('');
  testResults.innerHTML = `<div class="test-progress-heading">${done ? 'Final' : 'Running'} — ${completed} / ${total} total games</div><div class="results-section-title">Overall</div>${overallRows}<div class="results-section-title">Matchups</div>${matchupRows}`;
}

function setTestControlsDisabled(disabled) {
  runTestButton.disabled = disabled; modelSelect.disabled = disabled; testCountInput.disabled = disabled; watchButton.disabled = disabled; newGameButton.disabled = disabled;
  testModelCheckboxes.forEach(box => { box.disabled = disabled; });
}
function getTestWorker() { if (!testWorker) testWorker = new Worker(`test-worker.js?v=${Date.now()}`); return testWorker; }
function runWorkerGame(worker, job) {
  return new Promise((resolve, reject) => {
    const handler = event => {
      if (event.data.jobId !== job.jobId) return;
      worker.removeEventListener('message', handler);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    };
    worker.addEventListener('message', handler); worker.postMessage(job);
  });
}

async function runRoundRobinTest() {
  if (testing) return;
  const selectedKeys = getSelectedTestModels();
  if (selectedKeys.length < 2) { testResults.textContent = 'Select at least two models.'; return; }
  stopWatching();
  const requested = Number.parseInt(testCountInput.value, 10);
  const totalGames = Number.isFinite(requested) ? Math.max(1, Math.min(10000, requested)) : 100;
  testCountInput.value = totalGames;
  const stats = createStats(selectedKeys), schedule = buildSchedule(selectedKeys, totalGames, stats);
  testing = true; setTestControlsDisabled(true); renderRoundRobin(stats, selectedKeys, 0, schedule.length);
  try {
    const worker = getTestWorker();
    for (let i = 0; i < schedule.length; i += 1) {
      const job = schedule[i];
      const result = await runWorkerGame(worker, { jobId: i + 1, whiteModelKey: job.whiteModelKey, blackModelKey: job.blackModelKey, maxPlies: 1000 });
      applyResult(stats, job, result); renderRoundRobin(stats, selectedKeys, i + 1, schedule.length);
    }
    renderRoundRobin(stats, selectedKeys, schedule.length, schedule.length, true);
  } catch (error) {
    testResults.textContent = `Test stopped: ${error.message}`;
    if (testWorker) testWorker.terminate();
    testWorker = null;
  } finally { testing = false; setTestControlsDisabled(false); }
}

modelSelect.addEventListener('change', () => { selectedModel = modelSelect.value; updateModelUI(); resetGame(); });
newGameButton.addEventListener('click', resetGame);
watchButton.addEventListener('click', startWatching);
runTestButton.addEventListener('click', runRoundRobinTest);

updateModelUI();
renderBoard();
updateStatus();

// UI registrations and lab enhancements.

// --- Stonefish_ui_speed_patch.js ---
// StoneFish UI latency patch.
// Keep engine choice/search untouched: remove artificial waits and avoid asking
// the rules engine to regenerate moves the UI or bot has already proven legal.
let stonefishUiGameEnded = false;
let stonefishUiSelectedRawMoves = [];

// Commit a raw move that was produced by fastMoves() for this exact position.
// This mirrors Chess.move() after its legal-move lookup, so SAN/history/check
// behavior stays the same while skipping that redundant lookup.
function stonefishUiCommitKnownRaw(targetGame, raw) {
  const publicBefore = targetGame._publicMove(raw, false);
  targetGame._applyRaw(raw, true);
  const check = targetGame.in_check();
  const mate = check && !targetGame.fastHasLegalMove();
  return { ...publicBefore, san: targetGame._notation(raw, check, mate) };
}

// Every StoneFish model returns the exact raw legal move it selected. Reuse it
// instead of converting it to coordinates and generating every legal move again.
playMoveOnGame = function(targetGame, move) {
  if (!move) return null;
  if (move._raw) return stonefishUiCommitKnownRaw(targetGame, move._raw);
  return targetGame.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
};

const stonefishUiBaseClearSelection = clearSelection;
clearSelection = function() {
  stonefishUiSelectedRawMoves = [];
  stonefishUiBaseClearSelection();
};

// Highlighting only needs destination squares. Keep the matching raw moves so a
// second click can commit the already-validated move without another fastMoves().
selectSquare = function(square) {
  selectedSquare = square;
  const from = game._sq(square);
  const raw = game.fastMoves();
  stonefishUiSelectedRawMoves = [];
  legalTargets = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i].from !== from) continue;
    stonefishUiSelectedRawMoves.push(raw[i]);
    legalTargets.push(game._alg(raw[i].to));
  }
  renderBoard();
};

updateStatus = function() {
  if (watchMode) return updateWatchStatus();

  const inCheck = game.in_check();
  if (inCheck && !game.fastHasLegalMove()) {
    stonefishUiGameEnded = true;
    statusElement.textContent = `Checkmate. ${game.turn() === 'w' ? models[selectedModel].name : 'You'} won.`;
    return true;
  }

  if (
    game.halfmove >= 100 ||
    game._insufficientMaterial() ||
    (game.positionCounts.get(game.fastPositionKey()) || 0) >= 3 ||
    (!inCheck && !game.fastHasLegalMove())
  ) {
    stonefishUiGameEnded = true;
    statusElement.textContent = 'Draw.';
    return true;
  }

  stonefishUiGameEnded = false;
  statusElement.textContent = game.turn() === 'w'
    ? `Your move. You are White.${inCheck ? ' Check!' : ''}`
    : `${models[selectedModel].name} to move.${inCheck ? ' Check!' : ''}`;
  return false;
};

handleSquareClick = function(square) {
  if (watchMode || testing || botThinking || stonefishUiGameEnded || game.turn() !== 'w') return;
  const piece = game.get(square);
  if (!selectedSquare) {
    if (piece && piece.color === 'w') selectSquare(square);
    return;
  }
  if (square === selectedSquare) {
    clearSelection();
    renderBoard();
    return;
  }
  if (piece && piece.color === 'w') {
    selectSquare(square);
    return;
  }

  const to = game._sq(square);
  const raw = stonefishUiSelectedRawMoves.find(move =>
    move.to === to && (!move.promotion || move.promotion === 5)
  );
  if (!raw) return;

  const move = stonefishUiCommitKnownRaw(game, raw);
  lastMoveSquares = [move.from, move.to];
  clearSelection();
  lastMoveElement.textContent = `You played ${move.san}.`;
  const ended = updateStatus();
  renderBoard();

  if (!ended) {
    botThinking = true;
    statusElement.textContent = `${models[selectedModel].name} is thinking…`;
    window.setTimeout(makeSelectedBotMove, 0);
  }
};

// A finished spectator game calls stopWatching() and then becomes an ordinary
// board again. Preserve the old terminal-click guard without paying game_over()
// on every normal square click.
const stonefishUiBaseStopWatching = stopWatching;
stopWatching = function() {
  stonefishUiBaseStopWatching();
  stonefishUiGameEnded = game.game_over();
};

// --- Stonefish_v5_ui.js ---
// UI registration kept separate so v5 can land without rewriting the existing lab shell.
const v5Logic = [
  'Score every legal move on one unified points scale instead of eliminating moves through a tie-break chain',
  'Evaluate three-ply tactical safety for every root move, not just a pre-filtered candidate set',
  'Blend material, development, mobility, centre control, king safety, pawn structure, rook activity, board control, and piece safety at the same time',
  'Suppress opponent checking chances and mobility from move one as weighted inverse-pressure signals',
  'Use the v4.5 opening repertoire and named mating patterns as weighted knowledge, never as unconditional overrides',
  'Prefer immediate mate over repeated mating threats and strongly reject repetition when a fresh winning route exists'
];

models.v5 = {
  name: 'Stonefish_v5',
  trait: 'Unified points engine',
  subtitle: 'A new architecture: every legal move competes on one combined tactical, positional, knowledge, inverse-pressure, and conversion score.',
  logic: v5Logic,
  getMove: getStonefishV5Move
};

selectedModel = 'v5';
modelSelect.value = 'v5';
updateModelUI();
resetGame();

// --- Stonefish_v5_pro_ui.js ---
// UI registration for Stonefish_v5 Pro.
const v5ProLogic = [
  'Blend opening, attack, defence, conversion, endgame, and pawn-race priorities instead of using one fixed set of weights',
  'Score pins, skewers, loose pieces, overloaded defenders, king-zone pressure, and piece coordination',
  'Reward initiative and multi-purpose threats while actively suppressing the opponent’s checks, promotions, captures, and mobility',
  'Convert advantages by simplifying safely, reducing counterplay, and giving advanced passed pawns much more urgency',
  'Adjust confidence and heritage influence to the position instead of trusting old move patterns equally everywhere',
  'Search five plies selectively — exactly two plies deeper than Stonefish_v5 — with alpha-beta pruning and move ordering'
];

models.v5pro = {
  name: 'Stonefish_v5 Pro',
  trait: 'Adaptive five-ply points engine',
  subtitle: 'Stonefish_v5’s unified scoring upgraded with adaptive context, threat geometry, conversion intelligence, and a selective five-ply search.',
  logic: v5ProLogic,
  getMove: getStonefishV5ProMove
};

selectedModel = 'v5pro';
modelSelect.value = 'v5pro';
updateModelUI();
resetGame();

// --- Stonefish_v5_5_ui.js ---
// Public registration for the final Stonefish v5.5 release.

models.v55 = {
  name: 'Stonefish_v5.5',
  trait: 'Native PVS + ARMX adaptive engine',
  subtitle: 'The final Stonefish 5.5 model: native PVS search, capture quiescence, Refutation Guard, and per-game ARMX opponent adaptation.',
  logic: [
    'Evaluate material, piece placement, pawn structure and king safety',
    'Consider every legal root move with native PVS',
    'Resolve captures before evaluating a position and keep exact finalist scores',
    'Use Refutation Guard to verify dangerous legal replies outside the normal reply beam',
    'Learn opponent reply preferences during the current game with bounded ARMX adjustments'
  ],
  getMove: getStonefishV55Move
};

selectedModel = 'v55';
modelSelect.value = 'v55';
updateModelUI();
resetGame();

// --- Stonefish_v5_5_dev_ui.js ---
// Developer-only registration for the Stonefish v5.5 No-ARMX control.
// This control intentionally stays out of the normal opponent selector.

models.v55noarmx = {
  name: 'Stonefish_v5.5 (No ARMX)',
  trait: 'Developer-only v5.5 control build',
  subtitle: 'The final native v5.5 host with ARMX disabled, retained only for controlled development comparisons.',
  logic: [
    'Use the same native v5.5 host as the released model',
    'Consider every legal root move with native PVS',
    'Resolve captures before evaluating a position and keep exact finalist scores',
    'Do not call ARMX at any point'
  ],
  getMove: null
};

// --- Stonefish_v5_5_range_ui.js ---
// Only the saved best-known profile for each model appears in Dev Test.
models.v55athenatestunit = {
  name: 'v5.5 Athena (testunit)',
  trait: 'Full ARMX · extreme defense',
  subtitle: 'A defensive Full-ARMX v5.5 that preserves tension, protects its king and learns which defensive answers frustrate this opponent.',
  logic: [
    'Use the same native PVS engine and evaluation as the v5.5 range',
    'Run Full ARMX with per-game opponent learning and adaptive search effort',
    'Prefer defensive, tension-preserving finalists when native scores permit',
    'Never override mate-scale truth or large native score gaps',
    'Reset all opponent notes every game'
  ],
  getMove: getStonefishV55AthenaMove
};

models.v55arestestunit = {
  name: 'v5.5 Ares (testunit)',
  trait: 'Full ARMX · extreme aggression',
  subtitle: 'An aggressive Full-ARMX v5.5 that seeks forcing contact and learns which forms of pressure this opponent handles poorly.',
  logic: [
    'Use the same native PVS engine and evaluation as the v5.5 range',
    'Run Full ARMX with per-game opponent learning and adaptive search effort',
    'Prefer checks, king pressure, captures and forward forcing play when native scores permit',
    'Never override mate-scale truth or large native score gaps',
    'Reset all opponent notes every game'
  ],
  getMove: getStonefishV55AresMove
};

models.v55artemistestunit = {
  name: 'v5.5 Artemis (testunit)',
  trait: 'Full ARMX · balanced',
  subtitle: 'The neutral Full-ARMX reference: no style prior, only stronger opponent adaptation and evidence-driven search effort.',
  logic: [
    'Use the same native PVS engine and evaluation as Athena and Ares',
    'Run Full ARMX with per-game opponent learning and adaptive search effort',
    'Apply no defensive or aggressive style prior',
    'Use learned opponent evidence only within protected native-search bounds',
    'Reset all opponent notes every game'
  ],
  getMove: getStonefishV55ArtemisMove
};

// --- Stonefish_parallel_tests.js ---
// Parallel browser test runner.
// Independent games do not share state, so distribute them across a small
// worker pool. This changes test throughput only; model search is untouched.
//
// The dev lab also records engine-only performance for every model:
// - average think time per move,
// - average moves made per game,
// - average engine time per game = avg think time/move * avg moves/game.
// Opponent think time is excluded from each model's engine-time figure.

const stonefishBaseCreateStats = createStats;
const stonefishBaseApplyResult = applyResult;

function stonefishTimedCreateStats(selectedKeys) {
  const stats = stonefishBaseCreateStats(selectedKeys);
  for (const key of selectedKeys) {
    stats.overall[key].moves = 0;
    stats.overall[key].thinkMs = 0;
    stats.overall[key].compiledMoves = 0;
    stats.overall[key].fallbackMoves = 0;
    stats.overall[key].nativeKernelYes = 0;
    stats.overall[key].nativeKernelNo = 0;
  }
  for (const matchup of Object.values(stats.matchups)) {
    matchup.performance = {
      [matchup.a]: { moves: 0, thinkMs: 0 },
      [matchup.b]: { moves: 0, thinkMs: 0 }
    };
  }
  return stats;
}

function stonefishTimedApplyResult(stats, job, result) {
  const outcome = typeof result === 'string' ? result : result.outcome;
  stonefishBaseApplyResult(stats, job, outcome);
  if (!result || typeof result === 'string' || !result.metrics) return;

  const matchup = stats.matchups[pairKey(job.a, job.b)];
  for (const key of [job.a, job.b]) {
    const metric = result.metrics[key];
    if (!metric) continue;
    const moves = Number(metric.moves) || 0;
    const thinkMs = Number(metric.thinkMs) || 0;
    stats.overall[key].moves += moves;
    stats.overall[key].thinkMs += thinkMs;
    stats.overall[key].compiledMoves += Number(metric.compiledMoves) || 0;
    stats.overall[key].fallbackMoves += Number(metric.fallbackMoves) || 0;
    if (metric.nativeKernelAvailable === true) stats.overall[key].nativeKernelYes += 1;
    if (metric.nativeKernelAvailable === false) stats.overall[key].nativeKernelNo += 1;
    if (matchup.performance && matchup.performance[key]) {
      matchup.performance[key].moves += moves;
      matchup.performance[key].thinkMs += thinkMs;
    }
  }
}

function stonefishFormatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0.00 ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(2)} ms`;
}

function stonefishPerformanceSummary(perf, games) {
  const moves = perf && Number.isFinite(perf.moves) ? perf.moves : 0;
  const thinkMs = perf && Number.isFinite(perf.thinkMs) ? perf.thinkMs : 0;
  const avgTimePerMove = moves ? thinkMs / moves : 0;
  const avgMovesPerGame = games ? moves / games : 0;
  const avgEngineTimePerGame = avgTimePerMove * avgMovesPerGame;
  return {
    avgTimePerMove,
    avgMovesPerGame,
    avgEngineTimePerGame,
    text: `${stonefishFormatDuration(avgTimePerMove)}/move · ${avgMovesPerGame.toFixed(1)} moves/game · ${stonefishFormatDuration(avgEngineTimePerGame)} engine time/game`
  };
}

function stonefishTimedRenderRoundRobin(stats, selectedKeys, completed, total, done = false) {
  const overallRows = selectedKeys.map(key => {
    const s = stats.overall[key];
    const performance = stonefishPerformanceSummary(s, s.games);
    const backend = key === 'v55'
      ? `<span>ARMX backend: ${s.nativeKernelNo ? 'JS fallback detected' : 'compiled WASM available'} · compiled-search moves ${s.compiledMoves} · fallback/base moves ${s.fallbackMoves}</span>`
      : '';
    return `<div class="result-row"><strong>${models[key].name}</strong><span>${s.wins}W · ${s.losses}L · ${s.draws}D · ${s.games} played</span><span>W ${percent(s.wins, s.games)} · L ${percent(s.losses, s.games)} · D ${percent(s.draws, s.games)}</span><span>${performance.text}</span>${backend}</div>`;
  }).join('');

  const matchupRows = Object.values(stats.matchups).map(m => {
    const aLosses = m.games - m.aWins - m.draws;
    const bLosses = m.games - m.bWins - m.draws;
    const aPerformance = stonefishPerformanceSummary(m.performance ? m.performance[m.a] : null, m.games);
    const bPerformance = stonefishPerformanceSummary(m.performance ? m.performance[m.b] : null, m.games);
    return `<div class="matchup-row"><strong>${models[m.a].name} vs ${models[m.b].name}</strong><span>${m.games}/${m.targetGames} games</span><span>${models[m.a].name}: ${m.aWins}W · ${aLosses}L · ${m.draws}D — W ${percent(m.aWins, m.games)} · D ${percent(m.draws, m.games)}</span><span>${aPerformance.text}</span><span>${models[m.b].name}: ${m.bWins}W · ${bLosses}L · ${m.draws}D — W ${percent(m.bWins, m.games)} · D ${percent(m.draws, m.games)}</span><span>${bPerformance.text}</span></div>`;
  }).join('');

  const workers = stats.workerCount || 1;
  testResults.innerHTML = `<div class="test-progress-heading">${done ? 'Final' : 'Running'} — ${completed} / ${total} total games</div><div class="developer-note">Games use mirrored varied openings: each opening is replayed with colors swapped before moving to the next seed. Timing excludes opponent think time, but it is wall-clock timing under ${workers} concurrent worker${workers === 1 ? '' : 's'}; multi-worker CPU contention can change timing ratios. Engine time/game = average time/move × average moves/game.</div><div class="results-section-title">Overall</div>${overallRows}<div class="results-section-title">Matchups</div>${matchupRows}`;
}

createStats = stonefishTimedCreateStats;
applyResult = stonefishTimedApplyResult;
renderRoundRobin = stonefishTimedRenderRoundRobin;

const stonefishSequentialRoundRobinTest = runRoundRobinTest;
let stonefishParallelWorkerPool = [];

function stonefishParallelWorkerCount(totalJobs) {
  const hardware = Number(navigator.hardwareConcurrency) || 4;
  const usable = hardware > 2 ? hardware - 1 : 1;
  return Math.max(1, Math.min(totalJobs, Math.min(8, usable)));
}

function stonefishCloseParallelWorkers() {
  for (const worker of stonefishParallelWorkerPool) worker.terminate();
  stonefishParallelWorkerPool = [];
}

function stonefishAssignMirroredOpenings(schedule) {
  const counts = new Map();
  for (const job of schedule) {
    const key = pairKey(job.a, job.b);
    const gameIndex = counts.get(key) || 0;
    job.openingIndex = Math.floor(gameIndex / 2);
    counts.set(key, gameIndex + 1);
  }
  return schedule;
}

async function stonefishParallelRoundRobinTest() {
  if (testing) return;
  const selectedKeys = getSelectedTestModels();
  if (selectedKeys.length < 2) {
    testResults.textContent = 'Select at least two models.';
    return;
  }

  stopWatching();
  const requested = Number.parseInt(testCountInput.value, 10);
  const totalGames = Number.isFinite(requested) ? Math.max(1, Math.min(10000, requested)) : 100;
  testCountInput.value = totalGames;

  const stats = createStats(selectedKeys);
  const schedule = stonefishAssignMirroredOpenings(buildSchedule(selectedKeys, totalGames, stats));
  const workerCount = stonefishParallelWorkerCount(schedule.length);
  stats.workerCount = workerCount;
  let nextJobIndex = 0;
  let completed = 0;

  testing = true;
  setTestControlsDisabled(true);
  renderRoundRobin(stats, selectedKeys, 0, schedule.length);
  stonefishCloseParallelWorkers();
  const assetVersion = Date.now();
  stonefishParallelWorkerPool = Array.from({ length: workerCount }, () => new Worker(`test-worker.js?v=${assetVersion}`));

  try {
    async function runQueue(worker) {
      while (true) {
        const scheduleIndex = nextJobIndex;
        nextJobIndex += 1;
        if (scheduleIndex >= schedule.length) return;

        const job = schedule[scheduleIndex];
        const result = await runWorkerGame(worker, {
          jobId: scheduleIndex + 1,
          whiteModelKey: job.whiteModelKey,
          blackModelKey: job.blackModelKey,
          maxPlies: 360,
          openingIndex: job.openingIndex
        });

        applyResult(stats, job, result);
        completed += 1;
        renderRoundRobin(stats, selectedKeys, completed, schedule.length);
      }
    }

    await Promise.all(stonefishParallelWorkerPool.map(worker => runQueue(worker)));
    renderRoundRobin(stats, selectedKeys, schedule.length, schedule.length, true);
  } catch (error) {
    testResults.textContent = `Test stopped: ${error.message}`;
  } finally {
    stonefishCloseParallelWorkers();
    if (testWorker) testWorker.terminate();
    testWorker = null;
    testing = false;
    setTestControlsDisabled(false);
  }
}

runTestButton.removeEventListener('click', stonefishSequentialRoundRobinTest);
runRoundRobinTest = stonefishParallelRoundRobinTest;
runTestButton.addEventListener('click', runRoundRobinTest);
