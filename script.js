const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const moveListEl = document.getElementById("move-list");
const newGameButton = document.getElementById("new-game");

const game = new Chess();
const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const pieceSymbols = {
  p: "♟",
  r: "♜",
  n: "♞",
  b: "♝",
  q: "♛",
  k: "♚",
  P: "♙",
  R: "♖",
  N: "♘",
  B: "♗",
  Q: "♕",
  K: "♔",
};

const selectedModel = window.StoneFishModel;
let selectedSquare = null;

function squareColor(square) {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return (file + rank) % 2 === 0 ? "dark" : "light";
}

function renderBoard() {
  boardEl.innerHTML = "";
  for (let rank = 8; rank >= 1; rank -= 1) {
    for (const file of files) {
      const square = `${file}${rank}`;
      const piece = game.get(square);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.square = square;
      button.className = `square ${squareColor(square)}`;

      if (piece) {
        const key = piece.color === "w" ? piece.type.toUpperCase() : piece.type;
        button.textContent = pieceSymbols[key];
      }

      if (square === selectedSquare) {
        button.classList.add("selected");
      }

      boardEl.appendChild(button);
    }
  }

  if (selectedSquare) {
    for (const move of game.moves({ square: selectedSquare, verbose: true })) {
      const hintSquare = boardEl.querySelector(`[data-square="${move.to}"]`);
      if (hintSquare) {
        hintSquare.classList.add("hint");
      }
    }
  }
}

function updateStatus() {
  if (!selectedModel) {
    statusEl.textContent = "Model failed to load. Check models/StoneFish/model.js.";
    return;
  }

  if (game.isCheckmate()) {
    statusEl.textContent = game.turn() === "w" ? `${selectedModel.displayName} wins by checkmate.` : "Checkmate! You win.";
  } else if (game.isDraw()) {
    statusEl.textContent = "Draw game.";
  } else if (isKingInCheck()) {
    statusEl.textContent = game.turn() === "w" ? "You are in check." : `${selectedModel.displayName} is in check.`;
  } else {
    statusEl.textContent = game.turn() === "w" ? "Your move (White)." : `${selectedModel.displayName} is thinking...`;
  }
}

function isKingInCheck() {
  if (typeof game.isCheck === "function") {
    return game.isCheck();
  }

  if (typeof game.inCheck === "function") {
    return game.inCheck();
  }

  return false;
}

function updateMoveList() {
  moveListEl.innerHTML = "";
  const history = game.history();

  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement("li");
    const whiteMove = history[i];
    const blackMove = history[i + 1] || "";
    li.textContent = `${Math.floor(i / 2) + 1}. ${whiteMove} ${blackMove}`.trim();
    moveListEl.appendChild(li);
  }
}

function engineMove() {
  if (!selectedModel || game.turn() !== "b" || game.isGameOver()) {
    return;
  }

  const chosenMove = selectedModel.chooseMove(game);
  if (!chosenMove) {
    return;
  }

  game.move(chosenMove);
  updateMoveList();
  updateStatus();
  renderBoard();
}

function handlePlayerClick(square) {
  if (!selectedModel || game.turn() !== "w" || game.isGameOver()) {
    return;
  }

  const piece = game.get(square);

  if (selectedSquare) {
    const move = game.move({ from: selectedSquare, to: square, promotion: "q" });
    if (move) {
      selectedSquare = null;
      updateMoveList();
      updateStatus();
      renderBoard();
      window.setTimeout(engineMove, 380);
      return;
    }
  }

  if (piece && piece.color === "w") {
    selectedSquare = square;
  } else {
    selectedSquare = null;
  }

  renderBoard();
}

boardEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-square]");
  if (!button) {
    return;
  }

  handlePlayerClick(button.dataset.square);
});

newGameButton.addEventListener("click", () => {
  game.reset();
  selectedSquare = null;
  updateMoveList();
  updateStatus();
  renderBoard();
});

updateMoveList();
updateStatus();
renderBoard();
