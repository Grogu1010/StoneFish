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
const testModelASelect = document.getElementById('test-model-a');
const testModelBSelect = document.getElementById('test-model-b');
const testCountInput = document.getElementById('test-count');
const runTestButton = document.getElementById('run-test');
const testResults = document.getElementById('test-results');

const pieceSymbols = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚'
};

const models = {
  v1: {
    name: 'Stonefish_v1',
    trait: 'Random-move engine',
    subtitle: 'The least calculating chess engine on the internet. It sees every legal move. Then it picks one at random.',
    logic: ['Find every legal move', 'Pick one completely at random', 'Play it with zero regrets'],
    getMove: getStonefishMove
  },
  v2: {
    name: 'Stonefish_v2',
    trait: 'One-ply defensive engine',
    subtitle: 'A one-ply survivalist: takes mate in one, avoids giving mate in one, then minimises the biggest capture you can make next.',
    logic: ['Take mate in 1 whenever possible', 'Avoid allowing mate in 1 when possible', 'Minimise the opponent’s biggest next capture'],
    getMove: getStonefishV2Move
  },
  v2test1: {
    name: 'Stonefish_v2(testunit1)',
    getMove: getStonefishV2TestUnit1Move,
    testOnly: true
  },
  v2test2: {
    name: 'Stonefish_v2(testunit2)',
    getMove: getStonefishV2TestUnit2Move,
    testOnly: true
  }
};

let selectedSquare = null;
let legalTargets = [];
let botThinking = false;
let lastMoveSquares = [];
let selectedModel = 'v2';
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
  return targetGame.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
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
  if (watchMode) {
    updateWatchStatus();
    return;
  }

  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? models[selectedModel].name : 'You';
    statusElement.textContent = `Checkmate. ${winner} won.`;
    return;
  }

  if (game.in_draw()) {
    statusElement.textContent = 'Draw.';
    return;
  }

  if (game.game_over()) {
    statusElement.textContent = 'Game over.';
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
  if (watchTimer) {
    window.clearTimeout(watchTimer);
    watchTimer = null;
  }
  watchButton.textContent = 'Watch v1 vs v2';
}

function resetGame() {
  stopWatching();
  game.reset();
  selectedSquare = null;
  legalTargets = [];
  lastMoveSquares = [];
  botThinking = false;
  statusElement.textContent = 'Your move. You are White.';
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
  botThinking = false;
  watchMode = true;
  watchButton.textContent = 'Stop watching';
  lastMoveElement.textContent = 'Stonefish_v1 is White. Stonefish_v2 is Black.';
  renderBoard();
  updateWatchStatus();
  watchTimer = window.setTimeout(playWatchMove, 3000);
}

function updateWatchStatus() {
  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? 'Stonefish_v2' : 'Stonefish_v1';
    statusElement.textContent = `Checkmate. ${winner} won the spectator game.`;
    stopWatching();
    return;
  }

  if (game.in_draw() || game.game_over()) {
    statusElement.textContent = 'Spectator game ended in a draw.';
    stopWatching();
    return;
  }

  const side = game.turn() === 'w' ? 'Stonefish_v1' : 'Stonefish_v2';
  statusElement.textContent = `${side} to move.${game.in_check() ? ' Check!' : ''}`;
}

function playWatchMove() {
  if (!watchMode || game.game_over()) {
    updateWatchStatus();
    return;
  }

  const modelKey = game.turn() === 'w' ? 'v1' : 'v2';
  const model = models[modelKey];
  const move = model.getMove(game);
  const playedMove = playMoveOnGame(game, move);

  if (playedMove) {
    lastMoveSquares = [playedMove.from, playedMove.to];
    lastMoveElement.textContent = `${model.name} played ${playedMove.san}.`;
  }

  renderBoard();
  updateWatchStatus();

  if (watchMode && !game.game_over()) {
    watchTimer = window.setTimeout(playWatchMove, 3000);
  }
}

function formatWinRate(wins, completedGames) {
  if (completedGames === 0) return '0.0%';
  return `${((wins / completedGames) * 100).toFixed(1)}%`;
}

function renderTestProgress(modelAKey, modelBKey, results, completed, total, done = false) {
  const modelAName = models[modelAKey].name;
  const modelBName = models[modelBKey].name;
  const heading = done ? `Final — ${completed} games` : `Running ${completed} / ${total}`;
  const drawRate = completed === 0 ? '0.0%' : `${((results.draw / completed) * 100).toFixed(1)}%`;

  testResults.innerHTML = `
    <div class="test-progress-heading">${heading}</div>
    <div>${modelAName}: <strong>${results.a} wins</strong> · ${formatWinRate(results.a, completed)}</div>
    <div>${modelBName}: <strong>${results.b} wins</strong> · ${formatWinRate(results.b, completed)}</div>
    <div>Draws: <strong>${results.draw}</strong> · ${drawRate}</div>
  `;
}

function setTestControlsDisabled(disabled) {
  runTestButton.disabled = disabled;
  modelSelect.disabled = disabled;
  testModelASelect.disabled = disabled;
  testModelBSelect.disabled = disabled;
  testCountInput.disabled = disabled;
  watchButton.disabled = disabled;
  newGameButton.disabled = disabled;
}

function getTestWorker() {
  if (!testWorker) {
    testWorker = new Worker('test-worker.js');
  }
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

async function runHeadToHeadTest() {
  if (testing) return;

  stopWatching();
  const modelAKey = testModelASelect.value;
  const modelBKey = testModelBSelect.value;
  const requested = Number.parseInt(testCountInput.value, 10);
  const totalGames = Number.isFinite(requested) ? Math.max(1, Math.min(10000, requested)) : 20;
  testCountInput.value = totalGames;

  testing = true;
  setTestControlsDisabled(true);

  const results = { a: 0, b: 0, draw: 0 };
  renderTestProgress(modelAKey, modelBKey, results, 0, totalGames);

  try {
    const worker = getTestWorker();

    // Deliberately run one background worker at a time. v2 is CPU-heavy and
    // spawning one worker per core makes laptops much hotter for only a modest
    // real-world speed gain.
    for (let i = 0; i < totalGames; i += 1) {
      const modelAIsWhite = i % 2 === 0;
      const whiteModelKey = modelAIsWhite ? modelAKey : modelBKey;
      const blackModelKey = modelAIsWhite ? modelBKey : modelAKey;
      const result = await runWorkerGame(worker, {
        jobId: i + 1,
        whiteModelKey,
        blackModelKey,
        maxPlies: 1000
      });

      if (result === 'draw') {
        results.draw += 1;
      } else {
        const winnerIsModelA = (result === 'white' && modelAIsWhite) || (result === 'black' && !modelAIsWhite);
        if (winnerIsModelA) results.a += 1;
        else results.b += 1;
      }

      renderTestProgress(modelAKey, modelBKey, results, i + 1, totalGames);
    }

    renderTestProgress(modelAKey, modelBKey, results, totalGames, totalGames, true);
  } catch (error) {
    testResults.textContent = `Test stopped: ${error.message}`;

    if (testWorker) {
      testWorker.terminate();
      testWorker = null;
    }
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
runTestButton.addEventListener('click', runHeadToHeadTest);

updateModelUI();
renderBoard();
updateStatus();
