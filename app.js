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

function resultFromFinishedGame(testGame, whiteModel, blackModel) {
  if (testGame.in_checkmate()) {
    return testGame.turn() === 'w' ? blackModel : whiteModel;
  }
  return 'draw';
}

function playTestGame(whiteModelKey, blackModelKey, maxPlies = 1000) {
  const testGame = new Chess();
  let plies = 0;

  while (!testGame.game_over() && plies < maxPlies) {
    const modelKey = testGame.turn() === 'w' ? whiteModelKey : blackModelKey;
    const move = models[modelKey].getMove(testGame);
    if (!move) break;
    playMoveOnGame(testGame, move);
    plies += 1;
  }

  if (plies >= maxPlies && !testGame.game_over()) return 'draw';
  return resultFromFinishedGame(testGame, whiteModelKey, blackModelKey);
}

async function runHeadToHeadTest() {
  if (testing) return;

  stopWatching();
  const requested = Number.parseInt(testCountInput.value, 10);
  const totalGames = Number.isFinite(requested) ? Math.max(1, Math.min(10000, requested)) : 20;
  testCountInput.value = totalGames;

  testing = true;
  runTestButton.disabled = true;
  modelSelect.disabled = true;
  watchButton.disabled = true;
  newGameButton.disabled = true;

  const results = { v1: 0, v2: 0, draw: 0 };
  testResults.textContent = `Running 0 / ${totalGames} games…`;

  for (let i = 0; i < totalGames; i += 1) {
    const v1IsWhite = i % 2 === 0;
    const white = v1IsWhite ? 'v1' : 'v2';
    const black = v1IsWhite ? 'v2' : 'v1';
    const result = playTestGame(white, black);
    results[result] += 1;

    if ((i + 1) % 10 === 0 || i === totalGames - 1) {
      testResults.textContent = `Running ${i + 1} / ${totalGames} games…`;
      await new Promise(resolve => window.setTimeout(resolve, 0));
    }
  }

  testResults.textContent = `Stonefish_v1: ${results.v1} wins · Stonefish_v2: ${results.v2} wins · Draws: ${results.draw} · ${totalGames} games total.`;
  testing = false;
  runTestButton.disabled = false;
  modelSelect.disabled = false;
  watchButton.disabled = false;
  newGameButton.disabled = false;
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
