import { defaultModelId, stoneFishModels } from './StoneFish/index.js';

const game = new Chess();
const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const modelNameElement = document.getElementById('model-name');
const lastMoveElement = document.getElementById('last-move');
const moveListElement = document.getElementById('move-list');
const newGameButton = document.getElementById('new-game');
const undoMoveButton = document.getElementById('undo-move');
const turnIndicatorElement = document.getElementById('turn-indicator');
const plyCountElement = document.getElementById('ply-count');
const whiteCapturesElement = document.getElementById('white-captures');
const blackCapturesElement = document.getElementById('black-captures');

const pieceSymbols = {
  p: '♟',
  r: '♜',
  n: '♞',
  b: '♝',
  q: '♛',
  k: '♚',
  P: '♙',
  R: '♖',
  N: '♘',
  B: '♗',
  Q: '♕',
  K: '♔',
};

const activeModel = stoneFishModels[defaultModelId];
modelNameElement.textContent = activeModel.name;

let selectedSquare = null;
let legalTargets = new Set();
let gameOver = false;

function renderBoard() {
  boardElement.innerHTML = '';

  for (let rank = 8; rank >= 1; rank -= 1) {
    for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
      const file = String.fromCharCode(97 + fileIndex);
      const squareName = `${file}${rank}`;
      const piece = game.get(squareName);
      const isLight = (rank + fileIndex) % 2 === 0;

      const squareButton = document.createElement('button');
      squareButton.className = `square ${isLight ? 'light' : 'dark'}`;
      squareButton.dataset.square = squareName;
      squareButton.type = 'button';

      if (selectedSquare === squareName) {
        squareButton.classList.add('selected');
      }

      if (legalTargets.has(squareName)) {
        squareButton.classList.add('legal');
      }

      if (piece) {
        const key = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        squareButton.textContent = pieceSymbols[key];
      }

      squareButton.addEventListener('click', onSquareClick);
      boardElement.append(squareButton);
    }
  }
}

function updateMoveList() {
  moveListElement.innerHTML = '';
  const history = game.history();

  for (let index = 0; index < history.length; index += 2) {
    const item = document.createElement('li');
    const turn = index / 2 + 1;
    const whiteMove = history[index] ?? '';
    const blackMove = history[index + 1] ?? '…';
    item.textContent = `${turn}. ${whiteMove} ${blackMove}`;
    moveListElement.append(item);
  }

  plyCountElement.textContent = String(history.length);
}

function updateCaptures() {
  const historyVerbose = game.history({ verbose: true });
  const whiteCaptures = [];
  const blackCaptures = [];

  historyVerbose.forEach((move) => {
    if (!move.captured) {
      return;
    }

    const symbol = pieceSymbols[move.color === 'w' ? move.captured.toUpperCase() : move.captured];
    if (move.color === 'w') {
      whiteCaptures.push(symbol);
    } else {
      blackCaptures.push(symbol);
    }
  });

  whiteCapturesElement.textContent = whiteCaptures.length ? whiteCaptures.join(' ') : '-';
  blackCapturesElement.textContent = blackCaptures.length ? blackCaptures.join(' ') : '-';
}

function updateStatus() {
  if (game.in_checkmate()) {
    gameOver = true;
    statusElement.textContent = game.turn() === 'w' ? 'Checkmate! StoneFish wins.' : 'Checkmate! You win.';
    turnIndicatorElement.textContent = 'Game over';
    return;
  }

  if (game.in_draw()) {
    gameOver = true;
    statusElement.textContent = 'Draw game.';
    turnIndicatorElement.textContent = 'Draw';
    return;
  }

  gameOver = false;
  const side = game.turn() === 'w' ? 'White' : activeModel.name;
  const checkText = game.in_check() ? ' (in check)' : '';
  statusElement.textContent = `${side} to move${checkText}.`;
  turnIndicatorElement.textContent = side;
}

function setSelection(square) {
  selectedSquare = square;
  legalTargets = new Set(
    game
      .moves({ verbose: true })
      .filter((candidate) => candidate.from === square)
      .map((candidate) => candidate.to),
  );
}

function clearSelection() {
  selectedSquare = null;
  legalTargets.clear();
}

function syncDashboard() {
  updateMoveList();
  updateStatus();
  updateCaptures();
}

function engineMove() {
  if (gameOver || game.turn() !== 'b') {
    return;
  }

  const move = activeModel.chooseMove(game);
  if (!move) {
    updateStatus();
    return;
  }

  game.move(move);
  lastMoveElement.textContent = `Last move: ${activeModel.name} played ${move.san}`;
  clearSelection();
  renderBoard();
  syncDashboard();
}

function onSquareClick(event) {
  if (gameOver || game.turn() !== 'w') {
    return;
  }

  const square = event.currentTarget.dataset.square;

  if (!selectedSquare) {
    const piece = game.get(square);
    if (!piece || piece.color !== 'w') {
      return;
    }

    setSelection(square);
    renderBoard();
    return;
  }

  if (selectedSquare === square) {
    clearSelection();
    renderBoard();
    return;
  }

  const legalMove = game
    .moves({ verbose: true })
    .find((candidate) => candidate.from === selectedSquare && candidate.to === square);

  if (!legalMove) {
    const piece = game.get(square);
    if (piece?.color === 'w') {
      setSelection(square);
      renderBoard();
    }
    return;
  }

  game.move(legalMove);
  lastMoveElement.textContent = `Last move: You played ${legalMove.san}`;
  clearSelection();

  renderBoard();
  syncDashboard();

  setTimeout(engineMove, 260);
}

undoMoveButton.addEventListener('click', () => {
  if (game.history().length === 0) {
    return;
  }

  game.undo();
  if (game.turn() === 'b') {
    game.undo();
  }

  clearSelection();
  gameOver = false;
  lastMoveElement.textContent = 'Last move: (undone)';
  renderBoard();
  syncDashboard();
});

newGameButton.addEventListener('click', () => {
  game.reset();
  clearSelection();
  gameOver = false;
  lastMoveElement.textContent = 'Last move: -';
  renderBoard();
  syncDashboard();
});

renderBoard();
syncDashboard();
