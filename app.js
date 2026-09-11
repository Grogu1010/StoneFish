const game = new Chess();

const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const lastMoveElement = document.getElementById('last-move');
const newGameButton = document.getElementById('new-game');

const pieceSymbols = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚'
};

let selectedSquare = null;
let legalTargets = [];
let botThinking = false;
let lastMoveSquares = [];

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

      if (selectedSquare === square) {
        squareButton.classList.add('selected');
      }

      if (legalTargets.includes(square)) {
        squareButton.classList.add('legal-target');
      }

      if (lastMoveSquares.includes(square)) {
        squareButton.classList.add('last-move-square');
      }

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

  const names = {
    p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
  };
  const side = piece.color === 'w' ? 'White' : 'Black';
  return `${square}, ${side} ${names[piece.type]}`;
}

function handleSquareClick(square) {
  if (botThinking || game.game_over() || game.turn() !== 'w') return;

  const piece = game.get(square);

  if (!selectedSquare) {
    if (piece && piece.color === 'w') {
      selectSquare(square);
    }
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

  const move = game.move({
    from: selectedSquare,
    to: square,
    promotion: 'q'
  });

  if (!move) return;

  lastMoveSquares = [move.from, move.to];
  clearSelection();
  lastMoveElement.textContent = `You played ${move.san}.`;
  updateStatus();
  renderBoard();

  if (!game.game_over()) {
    botThinking = true;
    statusElement.textContent = 'Stonefish_v1 is choosing randomly…';
    window.setTimeout(makeStonefishMove, 450);
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

function makeStonefishMove() {
  const move = getStonefishMove(game);

  if (move) {
    const playedMove = game.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion || 'q'
    });

    lastMoveSquares = [playedMove.from, playedMove.to];
    lastMoveElement.textContent = `Stonefish_v1 randomly played ${playedMove.san}.`;
  }

  botThinking = false;
  updateStatus();
  renderBoard();
}

function updateStatus() {
  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? 'Stonefish_v1' : 'You';
    statusElement.textContent = `Checkmate. ${winner} won.`;
    return;
  }

  if (game.in_draw()) {
    statusElement.textContent = 'Draw. Somehow, Stonefish survived.';
    return;
  }

  if (game.game_over()) {
    statusElement.textContent = 'Game over.';
    return;
  }

  const checkText = game.in_check() ? ' Check!' : '';
  statusElement.textContent = game.turn() === 'w'
    ? `Your move. You are White.${checkText}`
    : `Stonefish_v1 to move.${checkText}`;
}

function resetGame() {
  game.reset();
  selectedSquare = null;
  legalTargets = [];
  lastMoveSquares = [];
  botThinking = false;
  statusElement.textContent = 'Your move. You are White.';
  lastMoveElement.textContent = 'Stonefish is waiting.';
  renderBoard();
}

newGameButton.addEventListener('click', resetGame);

renderBoard();
updateStatus();
