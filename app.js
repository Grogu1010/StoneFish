import { defaultModelId, stoneFishModels } from './StoneFish/index.js';

const game = new Chess();
const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const modelNameElement = document.getElementById('model-name');
const lastMoveElement = document.getElementById('last-move');
const moveListElement = document.getElementById('move-list');
const newGameButton = document.getElementById('new-game');

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
  history.forEach((move, index) => {
    const item = document.createElement('li');
    item.textContent = `${index + 1}. ${move}`;
    moveListElement.append(item);
  });
}

function updateStatus() {
  if (game.in_checkmate()) {
    gameOver = true;
    statusElement.textContent = game.turn() === 'w' ? 'Checkmate! StoneFish wins.' : 'Checkmate! You win.';
    return;
  }

  if (game.in_draw()) {
    gameOver = true;
    statusElement.textContent = 'Draw game.';
    return;
  }

  gameOver = false;
  const side = game.turn() === 'w' ? 'White' : activeModel.name;
  const checkText = game.in_check() ? ' (in check)' : '';
  statusElement.textContent = `${side} to move${checkText}.`;
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
  selectedSquare = null;
  renderBoard();
  updateMoveList();
  updateStatus();
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

    selectedSquare = square;
    renderBoard();
    return;
  }

  if (selectedSquare === square) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  const legalMove = game
    .moves({ verbose: true })
    .find((candidate) => candidate.from === selectedSquare && candidate.to === square);

  if (!legalMove) {
    const piece = game.get(square);
    if (piece?.color === 'w') {
      selectedSquare = square;
      renderBoard();
    }
    return;
  }

  game.move(legalMove);
  lastMoveElement.textContent = `Last move: You played ${legalMove.san}`;
  selectedSquare = null;

  renderBoard();
  updateMoveList();
  updateStatus();

  setTimeout(engineMove, 260);
}

newGameButton.addEventListener('click', () => {
  game.reset();
  selectedSquare = null;
  gameOver = false;
  lastMoveElement.textContent = 'Last move: -';
  renderBoard();
  updateMoveList();
  updateStatus();
});

renderBoard();
updateMoveList();
updateStatus();
