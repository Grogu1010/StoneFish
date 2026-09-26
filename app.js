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
newGameButton.addEventListener('click', () => resetGame());
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


// --- StoneFish core play UX ---
// Standard chess-site interaction layer: choose a side, flip/drag the board,
// choose promotions, inspect material and move history, resign, and load/copy FEN.
// Engine evaluation and search functions are left untouched.

const sfSideButtons = [...document.querySelectorAll('.side-button')];
const sfFlipBoardButton = document.getElementById('flip-board');
const sfWhiteCaptured = document.getElementById('white-captured');
const sfBlackCaptured = document.getElementById('black-captured');
const sfWhiteAdvantage = document.getElementById('white-advantage');
const sfBlackAdvantage = document.getElementById('black-advantage');
const sfMoveHistory = document.getElementById('move-history');
const sfMoveCount = document.getElementById('move-count');
const sfFenInput = document.getElementById('fen-input');
const sfFenMessage = document.getElementById('fen-message');
const sfCopyFenButton = document.getElementById('copy-fen');
const sfLoadFenButton = document.getElementById('load-fen');
const sfResignButton = document.getElementById('resign-game');
const sfPromotionDialog = document.getElementById('promotion-dialog');
const sfPromotionButtons = [...document.querySelectorAll('[data-promotion]')];
const sfCancelPromotion = document.getElementById('cancel-promotion');

let sfPlayerColor = 'w';
let sfBoardOrientation = 'w';
let sfMoveLog = [];
let sfResigned = false;
let sfPendingPromotion = null;
let sfDragFrom = null;
let sfBotTimer = null;

const sfStartingCounts = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const sfPieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const sfPromotionType = { q: 5, r: 4, b: 3, n: 2 };

function sfHumanName() {
  return sfPlayerColor === 'w' ? 'White' : 'Black';
}

function sfCanHumanMove() {
  return !watchMode && !testing && !botThinking && !sfResigned && !stonefishUiGameEnded && game.turn() === sfPlayerColor;
}

function sfRenderCapturedSet(missing, capturedColor) {
  const order = ['q', 'r', 'b', 'n', 'p'];
  const text = [];
  for (const type of order) {
    const count = missing[type] || 0;
    for (let i = 0; i < count; i += 1) text.push(pieceSymbols[`${capturedColor}${type}`]);
  }
  return text.length ? text.join(' ') : '—';
}

function sfMaterialSnapshot() {
  const counts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
  };
  for (let sq = 0; sq < 64; sq += 1) {
    const value = game.boardState[sq];
    if (!value) continue;
    const type = game._typeChar(Math.abs(value));
    if (!Object.prototype.hasOwnProperty.call(sfStartingCounts, type)) continue;
    counts[value > 0 ? 'w' : 'b'][type] += 1;
  }

  const whiteCaptured = {}, blackCaptured = {};
  let whitePoints = 0, blackPoints = 0;
  for (const type of Object.keys(sfStartingCounts)) {
    whiteCaptured[type] = Math.max(0, sfStartingCounts[type] - counts.b[type]);
    blackCaptured[type] = Math.max(0, sfStartingCounts[type] - counts.w[type]);
    whitePoints += whiteCaptured[type] * sfPieceValue[type];
    blackPoints += blackCaptured[type] * sfPieceValue[type];
  }
  return { whiteCaptured, blackCaptured, whitePoints, blackPoints };
}

function sfRenderMaterial() {
  const material = sfMaterialSnapshot();
  sfWhiteCaptured.textContent = sfRenderCapturedSet(material.whiteCaptured, 'b');
  sfBlackCaptured.textContent = sfRenderCapturedSet(material.blackCaptured, 'w');
  const difference = material.whitePoints - material.blackPoints;
  sfWhiteAdvantage.textContent = difference > 0 ? `+${difference}` : '';
  sfBlackAdvantage.textContent = difference < 0 ? `+${Math.abs(difference)}` : '';
}

function sfRenderMoveHistory() {
  sfMoveCount.textContent = `${sfMoveLog.length} move${sfMoveLog.length === 1 ? '' : 's'}`;
  if (!sfMoveLog.length) {
    sfMoveHistory.innerHTML = '<p class="history-empty">Moves will appear here.</p>';
    return;
  }

  const rows = new Map();
  for (const entry of sfMoveLog) {
    if (!rows.has(entry.number)) rows.set(entry.number, { white: '', black: '' });
    rows.get(entry.number)[entry.color === 'w' ? 'white' : 'black'] = entry.san;
  }

  sfMoveHistory.innerHTML = [...rows.entries()].map(([number, row]) =>
    `<div class="move-row"><span class="move-number">${number}.</span><span class="move-san">${row.white || '…'}</span><span class="move-san">${row.black || ''}</span></div>`
  ).join('');
  sfMoveHistory.scrollTop = sfMoveHistory.scrollHeight;
}

function sfRefreshPositionUi() {
  sfFenInput.value = game.fen();
  sfRenderMaterial();
  sfRenderMoveHistory();
  sfResignButton.disabled = sfResigned || stonefishUiGameEnded || watchMode || testing;
}

function sfRecordMove(playedMove, color, moveNumber) {
  if (!playedMove) return;
  sfMoveLog.push({ color, number: moveNumber, san: playedMove.san || `${playedMove.from}${playedMove.to}` });
}

function sfBoardFiles() {
  return sfBoardOrientation === 'w'
    ? ['a','b','c','d','e','f','g','h']
    : ['h','g','f','e','d','c','b','a'];
}

function sfBoardRanks() {
  return sfBoardOrientation === 'w'
    ? [8,7,6,5,4,3,2,1]
    : [1,2,3,4,5,6,7,8];
}

renderBoard = function() {
  boardElement.innerHTML = '';
  const files = sfBoardFiles();
  const ranks = sfBoardRanks();
  const bottomRank = sfBoardOrientation === 'w' ? 1 : 8;
  const leftFile = sfBoardOrientation === 'w' ? 'a' : 'h';

  for (const rank of ranks) {
    for (const file of files) {
      const fileIndex = file.charCodeAt(0) - 97;
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

      if (rank === bottomRank) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord-file';
        fileLabel.textContent = file;
        squareButton.appendChild(fileLabel);
      }
      if (file === leftFile) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord-rank';
        rankLabel.textContent = String(rank);
        squareButton.appendChild(rankLabel);
      }

      if (piece) {
        const pieceSpan = document.createElement('span');
        pieceSpan.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
        pieceSpan.textContent = pieceSymbols[`${piece.color}${piece.type}`];
        pieceSpan.draggable = piece.color === sfPlayerColor;
        pieceSpan.addEventListener('dragstart', event => {
          if (!sfCanHumanMove() || piece.color !== sfPlayerColor) {
            event.preventDefault();
            return;
          }
          sfDragFrom = square;
          squareButton.classList.add('drag-source');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', square);
        });
        pieceSpan.addEventListener('dragend', () => {
          sfDragFrom = null;
          boardElement.querySelectorAll('.drag-source, .drag-target').forEach(node => node.classList.remove('drag-source', 'drag-target'));
        });
        squareButton.appendChild(pieceSpan);
      }

      squareButton.addEventListener('dragover', event => {
        if (!sfDragFrom || !sfCanHumanMove()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        squareButton.classList.add('drag-target');
      });
      squareButton.addEventListener('dragleave', () => squareButton.classList.remove('drag-target'));
      squareButton.addEventListener('drop', event => {
        if (!sfDragFrom || !sfCanHumanMove()) return;
        event.preventDefault();
        const from = sfDragFrom;
        sfDragFrom = null;
        boardElement.querySelectorAll('.drag-source, .drag-target').forEach(node => node.classList.remove('drag-source', 'drag-target'));
        sfAttemptHumanMove(from, square);
      });
      squareButton.addEventListener('click', () => handleSquareClick(square));
      boardElement.appendChild(squareButton);
    }
  }
};

selectSquare = function(square) {
  if (!sfCanHumanMove()) return;
  const piece = game.get(square);
  if (!piece || piece.color !== sfPlayerColor) return;
  selectedSquare = square;
  const from = game._sq(square);
  const raw = game.fastMoves();
  stonefishUiSelectedRawMoves = raw.filter(move => move.from === from);
  legalTargets = [...new Set(stonefishUiSelectedRawMoves.map(move => game._alg(move.to)))];
  renderBoard();
};

function sfOpenPromotion(from, to, candidates) {
  sfPendingPromotion = { from, to, candidates };
  if (typeof sfPromotionDialog.showModal === 'function') sfPromotionDialog.showModal();
  else {
    const queen = candidates.find(move => move.promotion === 5) || candidates[0];
    sfCommitHumanRaw(queen);
  }
}

function sfAttemptHumanMove(from, to, promotion = null) {
  if (!sfCanHumanMove()) return false;
  const fromSq = game._sq(from);
  const toSq = game._sq(to);
  const candidates = game.fastMoves().filter(move => move.from === fromSq && move.to === toSq);
  if (!candidates.length) return false;

  if (candidates.some(move => move.promotion)) {
    if (!promotion) {
      sfOpenPromotion(from, to, candidates);
      return true;
    }
    const desired = sfPromotionType[promotion];
    const chosen = candidates.find(move => move.promotion === desired);
    if (!chosen) return false;
    sfCommitHumanRaw(chosen);
    return true;
  }

  sfCommitHumanRaw(candidates[0]);
  return true;
}

function sfCommitHumanRaw(raw) {
  if (!raw || !sfCanHumanMove()) return;
  const moveNumber = game.fullmove;
  const playedMove = stonefishUiCommitKnownRaw(game, raw);
  lastMoveSquares = [playedMove.from, playedMove.to];
  sfRecordMove(playedMove, sfPlayerColor, moveNumber);
  clearSelection();
  lastMoveElement.textContent = `You played ${playedMove.san}.`;
  const ended = updateStatus();
  renderBoard();
  sfRefreshPositionUi();
  if (!ended) sfScheduleBotMove();
}

handleSquareClick = function(square) {
  if (!sfCanHumanMove()) return;
  const piece = game.get(square);

  if (!selectedSquare) {
    if (piece && piece.color === sfPlayerColor) selectSquare(square);
    return;
  }
  if (square === selectedSquare) {
    clearSelection();
    renderBoard();
    return;
  }
  if (piece && piece.color === sfPlayerColor) {
    selectSquare(square);
    return;
  }

  if (!sfAttemptHumanMove(selectedSquare, square)) {
    clearSelection();
    renderBoard();
  }
};

function sfScheduleBotMove() {
  if (sfBotTimer) window.clearTimeout(sfBotTimer);
  if (sfResigned || stonefishUiGameEnded || watchMode || testing || game.turn() === sfPlayerColor) return;
  botThinking = true;
  statusElement.textContent = `${models[selectedModel].name} is thinking…`;
  sfBotTimer = window.setTimeout(() => {
    sfBotTimer = null;
    makeSelectedBotMove();
  }, 60);
}

makeSelectedBotMove = function() {
  if (sfResigned || stonefishUiGameEnded || watchMode || testing || game.turn() === sfPlayerColor) {
    botThinking = false;
    return;
  }
  const model = models[selectedModel];
  const color = game.turn();
  const moveNumber = game.fullmove;
  const move = model.getMove(game);
  if (move) {
    const playedMove = playMoveOnGame(game, move);
    lastMoveSquares = [playedMove.from, playedMove.to];
    sfRecordMove(playedMove, color, moveNumber);
    lastMoveElement.textContent = `${model.name} played ${playedMove.san}.`;
  }
  botThinking = false;
  updateStatus();
  renderBoard();
  sfRefreshPositionUi();
};

updateStatus = function() {
  if (watchMode) return updateWatchStatus();
  if (sfResigned) {
    stonefishUiGameEnded = true;
    statusElement.textContent = `You resigned. ${models[selectedModel].name} won.`;
    return true;
  }

  const inCheck = game.in_check();
  const hasLegalMove = game.fastHasLegalMove();
  if (!hasLegalMove) {
    stonefishUiGameEnded = true;
    if (inCheck) {
      const winner = game.turn() === sfPlayerColor ? models[selectedModel].name : 'You';
      statusElement.textContent = `Checkmate. ${winner} won.`;
    } else {
      statusElement.textContent = 'Draw by stalemate.';
    }
    return true;
  }

  if (game.halfmove >= 100) {
    stonefishUiGameEnded = true;
    statusElement.textContent = 'Draw by the 50-move rule.';
    return true;
  }
  if (game._insufficientMaterial()) {
    stonefishUiGameEnded = true;
    statusElement.textContent = 'Draw by insufficient material.';
    return true;
  }
  if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) {
    stonefishUiGameEnded = true;
    statusElement.textContent = 'Draw by threefold repetition.';
    return true;
  }

  stonefishUiGameEnded = false;
  const checkText = inCheck ? ' Check!' : '';
  statusElement.textContent = game.turn() === sfPlayerColor
    ? `Your move. You are ${sfHumanName()}.${checkText}`
    : `${models[selectedModel].name} to move.${checkText}`;
  return false;
};

resetGame = function() {
  if (sfBotTimer) window.clearTimeout(sfBotTimer);
  sfBotTimer = null;
  stopWatching();
  game.reset();
  clearV45BookState();
  clearSelection();
  sfMoveLog = [];
  sfResigned = false;
  sfPendingPromotion = null;
  lastMoveSquares = [];
  botThinking = false;
  stonefishUiGameEnded = false;
  lastMoveElement.textContent = `${models[selectedModel].name} is waiting.`;
  sfBoardOrientation = sfPlayerColor;
  renderBoard();
  updateStatus();
  sfRefreshPositionUi();
  sfScheduleBotMove();
};

function sfSetPlayerColor(color) {
  if (color !== 'w' && color !== 'b') return;
  sfPlayerColor = color;
  sfBoardOrientation = color;
  sfSideButtons.forEach(button => {
    const active = button.dataset.side === color;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  resetGame();
}

function sfLoadFen() {
  const fen = sfFenInput.value.trim();
  if (!fen) {
    sfFenMessage.textContent = 'Paste a FEN first.';
    return;
  }
  try {
    if (sfBotTimer) window.clearTimeout(sfBotTimer);
    sfBotTimer = null;
    stopWatching();
    game.load(fen);
    clearV45BookState();
    clearSelection();
    sfMoveLog = [];
    sfResigned = false;
    sfPendingPromotion = null;
    lastMoveSquares = [];
    botThinking = false;
    stonefishUiGameEnded = false;
    lastMoveElement.textContent = 'Position loaded from FEN.';
    sfFenMessage.textContent = 'Position loaded.';
    renderBoard();
    updateStatus();
    sfRefreshPositionUi();
    sfScheduleBotMove();
  } catch (error) {
    sfFenMessage.textContent = `Could not load FEN: ${error.message}`;
  }
}

async function sfCopyFen() {
  const fen = game.fen();
  try {
    await navigator.clipboard.writeText(fen);
    sfFenMessage.textContent = 'FEN copied to clipboard.';
  } catch (_) {
    sfFenInput.value = fen;
    sfFenInput.focus();
    sfFenInput.select();
    document.execCommand('copy');
    sfFenMessage.textContent = 'FEN copied to clipboard.';
  }
}

sfSideButtons.forEach(button => button.addEventListener('click', () => sfSetPlayerColor(button.dataset.side)));
sfFlipBoardButton.addEventListener('click', () => {
  sfBoardOrientation = sfBoardOrientation === 'w' ? 'b' : 'w';
  renderBoard();
});
sfCopyFenButton.addEventListener('click', sfCopyFen);
sfLoadFenButton.addEventListener('click', sfLoadFen);
sfFenInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sfLoadFen();
  }
});
sfResignButton.addEventListener('click', () => {
  if (stonefishUiGameEnded || sfResigned || watchMode || testing) return;
  if (sfBotTimer) window.clearTimeout(sfBotTimer);
  sfBotTimer = null;
  sfResigned = true;
  botThinking = false;
  clearSelection();
  updateStatus();
  renderBoard();
  sfRefreshPositionUi();
});
sfPromotionButtons.forEach(button => button.addEventListener('click', () => {
  if (!sfPendingPromotion) return;
  const { from, to } = sfPendingPromotion;
  const promotion = button.dataset.promotion;
  sfPendingPromotion = null;
  if (sfPromotionDialog.open) sfPromotionDialog.close();
  sfAttemptHumanMove(from, to, promotion);
}));
sfCancelPromotion.addEventListener('click', () => {
  sfPendingPromotion = null;
  if (sfPromotionDialog.open) sfPromotionDialog.close();
});
sfPromotionDialog.addEventListener('cancel', () => { sfPendingPromotion = null; });

// Re-render once after the feature layer replaces the original board functions.
renderBoard();
updateStatus();
sfRefreshPositionUi();
