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

const models = {
  v1: {
    name: 'Stonefish_v1',
    trait: 'Random-move engine',
    subtitle: 'It sees every legal move and picks one completely at random.',
    logic: ['Find every legal move', 'Pick one at random', 'Play it'],
    getMove: getStonefishMove
  },
  v2: {
    name: 'Stonefish_v2',
    trait: 'One-ply defensive engine',
    subtitle: 'Takes mate in one, avoids giving mate in one, then minimises the biggest capture available to the opponent next move.',
    logic: ['Take mate in 1', 'Avoid allowing mate in 1', 'Minimise the opponent’s biggest next capture'],
    getMove: getStonefishV2Move
  },
  v3: {
    name: 'Stonefish_v3',
    trait: 'Three-ply material engine',
    subtitle: 'Scores material across its move, the opponent’s best reply, and its own best response. Bishops are worth 3.1.',
    logic: ['Take mate in 1', 'Avoid opponent mate in 1 whenever possible', 'Maximise the worst three-ply material trade'],
    getMove: getStonefishV3Move
  },
  v4: {
    name: 'Stonefish_v4',
    trait: 'Positional tie-break engine',
    subtitle: 'Stonefish_v3 decides tactical/material equality first; tied moves are then separated by checks, king safety, mobility, and centre control.',
    logic: [
      'Take mate in 1',
      'Avoid opponent mate in 1 whenever possible',
      'Maximise the worst three-ply material trade',
      'Prefer checks',
      'Avoid king suffocation and strongly prefer castling',
      'Keep protection around the king',
      'Prefer more legal movement options',
      'Prefer centre control'
    ],
    getMove: getStonefishV4Move
  },
  v4test1: { name: 'Stonefish_v4(testunit1)', getMove: getStonefishV4TestUnit1Move, testOnly: true },
  v4test2: { name: 'Stonefish_v4(testunit2)', getMove: getStonefishV4TestUnit2Move, testOnly: true },
  v4test3: { name: 'Stonefish_v4(testunit3)', getMove: getStonefishV4TestUnit3Move, testOnly: true },
  v4test4: { name: 'Stonefish_v4(testunit4)', getMove: getStonefishV4TestUnit4Move, testOnly: true }
};

let selectedSquare = null;
let legalTargets = [];
let botThinking = false;
let lastMoveSquares = [];
let selectedModel = 'v4';
let watchTimer = null;
let watchMode = false;
let testing = false;
let testWorker = null;

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

function handleSquareClick(square) {
  if (watchMode || testing || botThinking || game.game_over() || game.turn() !== 'w') return;
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

function selectSquare(square) {
  selectedSquare = square;
  legalTargets = game.moves({ square, verbose: true }).map(move => move.to);
  renderBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalTargets = [];
}

function playMoveOnGame(targetGame, move) {
  if (!move) return null;
  return targetGame.move({ from: move.from, to: move.to, promotion: move.promotion || 'q', _raw: move._raw });
}

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
  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? models[selectedModel].name : 'You';
    statusElement.textContent = `Checkmate. ${winner} won.`;
    return;
  }
  if (game.in_draw()) {
    statusElement.textContent = 'Draw.';
    return;
  }
  const checkText = game.in_check() ? ' Check!' : '';
  statusElement.textContent = game.turn() === 'w'
    ? `Your move. You are White.${checkText}`
    : `${models[selectedModel].name} to move.${checkText}`;
}

function updateModelUI() {
  const model = models[selectedModel];
  heroModel.textContent = model.name;
  heroSubtitle.textContent = model.subtitle;
  botTrait.innerHTML = `<span class="status-dot"></span> ${model.trait}`;
  logicLines.innerHTML = model.logic.map((line, index) => (
    `<div class="logic-line"><span>${index + 1}</span><p>${line}</p></div>`
  )).join('');
}

function stopWatching() {
  watchMode = false;
  if (watchTimer) window.clearTimeout(watchTimer);
  watchTimer = null;
  watchButton.textContent = 'Watch v3 vs v4';
}

function resetGame() {
  stopWatching();
  game.reset();
  selectedSquare = null;
  legalTargets = [];
  lastMoveSquares = [];
  botThinking = false;
  lastMoveElement.textContent = `${models[selectedModel].name} is waiting.`;
  renderBoard();
  updateStatus();
}

function startWatching() {
  if (testing) return;
  if (watchMode) {
    stopWatching();
    statusElement.textContent = 'Spectator game paused.';
    return;
  }

  game.reset();
  clearSelection();
  lastMoveSquares = [];
  watchMode = true;
  watchButton.textContent = 'Stop watching';
  lastMoveElement.textContent = 'Stonefish_v3 is White. Stonefish_v4 is Black.';
  renderBoard();
  updateWatchStatus();
  watchTimer = window.setTimeout(playWatchMove, 3000);
}

function updateWatchStatus() {
  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? 'Stonefish_v4' : 'Stonefish_v3';
    statusElement.textContent = `Checkmate. ${winner} won the spectator game.`;
    stopWatching();
    return;
  }
  if (game.in_draw()) {
    statusElement.textContent = 'Spectator game ended in a draw.';
    stopWatching();
    return;
  }
  const side = game.turn() === 'w' ? 'Stonefish_v3' : 'Stonefish_v4';
  statusElement.textContent = `${side} to move.${game.in_check() ? ' Check!' : ''}`;
}

function playWatchMove() {
  if (!watchMode || game.game_over()) return updateWatchStatus();
  const modelKey = game.turn() === 'w' ? 'v3' : 'v4';
  const model = models[modelKey];
  const move = model.getMove(game);
  const playedMove = playMoveOnGame(game, move);

  if (playedMove) {
    lastMoveSquares = [playedMove.from, playedMove.to];
    lastMoveElement.textContent = `${model.name} played ${playedMove.san}.`;
  }

  renderBoard();
  updateWatchStatus();
  if (watchMode && !game.game_over()) watchTimer = window.setTimeout(playWatchMove, 3000);
}

function percent(value, total) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';
}

function pairKey(a, b) {
  return [a, b].sort().join('::');
}

function getSelectedTestModels() {
  return testModelCheckboxes.filter(box => box.checked).map(box => box.value);
}

function createStats(selectedKeys) {
  const overall = {};
  const matchups = {};
  for (const key of selectedKeys) overall[key] = { wins: 0, losses: 0, draws: 0, games: 0 };
  for (let i = 0; i < selectedKeys.length; i += 1) {
    for (let j = i + 1; j < selectedKeys.length; j += 1) {
      const a = selectedKeys[i], b = selectedKeys[j];
      matchups[pairKey(a, b)] = { a, b, aWins: 0, bWins: 0, draws: 0, games: 0, targetGames: 0 };
    }
  }
  return { overall, matchups };
}

function buildSchedule(selectedKeys, totalGames, stats) {
  const pairs = [];
  for (let i = 0; i < selectedKeys.length; i += 1) {
    for (let j = i + 1; j < selectedKeys.length; j += 1) pairs.push([selectedKeys[i], selectedKeys[j]]);
  }

  const baseGames = Math.floor(totalGames / pairs.length);
  const remainder = totalGames % pairs.length;
  const pairTargets = pairs.map((pair, index) => ({ pair, count: baseGames + (index < remainder ? 1 : 0) }));

  for (const entry of pairTargets) {
    const [a, b] = entry.pair;
    stats.matchups[pairKey(a, b)].targetGames = entry.count;
  }

  const jobs = [];
  const maxRounds = Math.max(...pairTargets.map(entry => entry.count));
  for (let round = 0; round < maxRounds; round += 1) {
    pairTargets.forEach((entry, pairIndex) => {
      if (round >= entry.count) return;
      const [a, b] = entry.pair;
      const aIsWhite = (round + pairIndex) % 2 === 0;
      jobs.push({ a, b, whiteModelKey: aIsWhite ? a : b, blackModelKey: aIsWhite ? b : a });
    });
  }
  return jobs;
}

function applyResult(stats, job, result) {
  const matchup = stats.matchups[pairKey(job.a, job.b)];
  matchup.games += 1;
  stats.overall[job.a].games += 1;
  stats.overall[job.b].games += 1;

  if (result === 'draw') {
    matchup.draws += 1;
    stats.overall[job.a].draws += 1;
    stats.overall[job.b].draws += 1;
    return;
  }

  const winner = result === 'white' ? job.whiteModelKey : job.blackModelKey;
  const loser = winner === job.a ? job.b : job.a;
  stats.overall[winner].wins += 1;
  stats.overall[loser].losses += 1;
  if (winner === matchup.a) matchup.aWins += 1;
  else matchup.bWins += 1;
}

function renderRoundRobin(stats, selectedKeys, completed, total, done = false) {
  const overallRows = selectedKeys.map(key => {
    const s = stats.overall[key];
    return `<div class="result-row"><strong>${models[key].name}</strong><span>${s.wins}W · ${s.losses}L · ${s.draws}D · ${s.games} played</span><span>W ${percent(s.wins, s.games)} · L ${percent(s.losses, s.games)} · D ${percent(s.draws, s.games)}</span></div>`;
  }).join('');

  const matchupRows = Object.values(stats.matchups).map(m => {
    const aLosses = m.games - m.aWins - m.draws;
    const bLosses = m.games - m.bWins - m.draws;
    return `<div class="matchup-row"><strong>${models[m.a].name} vs ${models[m.b].name}</strong><span>${m.games}/${m.targetGames} games</span><span>${models[m.a].name}: ${m.aWins}W · ${aLosses}L · ${m.draws}D — W ${percent(m.aWins, m.games)} · D ${percent(m.draws, m.games)}</span><span>${models[m.b].name}: ${m.bWins}W · ${bLosses}L · ${m.draws}D — W ${percent(m.bWins, m.games)} · D ${percent(m.draws, m.games)}</span></div>`;
  }).join('');

  testResults.innerHTML = `
    <div class="test-progress-heading">${done ? 'Final' : 'Running'} — ${completed} / ${total} total games</div>
    <div class="results-section-title">Overall</div>
    ${overallRows}
    <div class="results-section-title">Matchups</div>
    ${matchupRows}
  `;
}

function setTestControlsDisabled(disabled) {
  runTestButton.disabled = disabled;
  modelSelect.disabled = disabled;
  testCountInput.disabled = disabled;
  watchButton.disabled = disabled;
  newGameButton.disabled = disabled;
  testModelCheckboxes.forEach(box => { box.disabled = disabled; });
}

function getTestWorker() {
  if (!testWorker) testWorker = new Worker('test-worker.js');
  return testWorker;
}

function runWorkerGame(worker, job) {
  return new Promise((resolve, reject) => {
    const handler = event => {
      if (event.data.jobId !== job.jobId) return;
      worker.removeEventListener('message', handler);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.addEventListener('message', handler);
    worker.postMessage(job);
  });
}

async function runRoundRobinTest() {
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
  const schedule = buildSchedule(selectedKeys, totalGames, stats);

  testing = true;
  setTestControlsDisabled(true);
  renderRoundRobin(stats, selectedKeys, 0, schedule.length);

  try {
    const worker = getTestWorker();
    for (let i = 0; i < schedule.length; i += 1) {
      const job = schedule[i];
      const result = await runWorkerGame(worker, {
        jobId: i + 1,
        whiteModelKey: job.whiteModelKey,
        blackModelKey: job.blackModelKey,
        maxPlies: 1000
      });
      applyResult(stats, job, result);
      renderRoundRobin(stats, selectedKeys, i + 1, schedule.length);
    }
    renderRoundRobin(stats, selectedKeys, schedule.length, schedule.length, true);
  } catch (error) {
    testResults.textContent = `Test stopped: ${error.message}`;
    if (testWorker) testWorker.terminate();
    testWorker = null;
  } finally {
    testing = false;
    setTestControlsDisabled(false);
  }
}

modelSelect.addEventListener('change', () => {
  selectedModel = modelSelect.value;
  updateModelUI();
  resetGame();
});
newGameButton.addEventListener('click', resetGame);
watchButton.addEventListener('click', startWatching);
runTestButton.addEventListener('click', runRoundRobinTest);

updateModelUI();
renderBoard();
updateStatus();
