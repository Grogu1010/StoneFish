class ChessGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = this.createInitialState();
    this.moveHistory = [];
    this.gameOver = false;
    this.result = null;
  }

  createInitialState() {
    return {
      board: [
        ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
        ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
        ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"]
      ],
      turn: "w",
      castling: {
        w: { K: true, Q: true },
        b: { K: true, Q: true }
      },
      enPassant: null,
      fullMove: 1
    };
  }

  cloneState(state = this.state) {
    return {
      board: state.board.map(row => row.slice()),
      turn: state.turn,
      castling: {
        w: { K: state.castling.w.K, Q: state.castling.w.Q },
        b: { K: state.castling.b.K, Q: state.castling.b.Q }
      },
      enPassant: state.enPassant ? { ...state.enPassant } : null,
      fullMove: state.fullMove
    };
  }

  cloneMove(move) {
    return {
      from: { ...move.from },
      to: { ...move.to },
      promotion: move.promotion,
      castle: move.castle,
      enPassant: move.enPassant
    };
  }

  colorOf(piece) {
    return piece ? piece[0] : null;
  }

  typeOf(piece) {
    return piece ? piece[1] : null;
  }

  opponent(color) {
    return color === "w" ? "b" : "w";
  }

  isOnBoard(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  squareName(r, c) {
    return "abcdefgh"[c] + (8 - r);
  }

  isPromotionMove(move, state = this.state) {
    const piece = state.board[move.from.r][move.from.c];
    return piece && this.typeOf(piece) === "P" && (move.to.r === 0 || move.to.r === 7);
  }

  makeMove(move, label = "Move") {
    if (this.gameOver) return false;

    const movingPiece = this.state.board[move.from.r][move.from.c];
    if (!movingPiece || this.colorOf(movingPiece) !== this.state.turn) return false;

    const capturedPiece = move.enPassant
      ? this.state.board[move.from.r][move.to.c]
      : this.state.board[move.to.r][move.to.c];

    const notation = this.moveNotation(move, movingPiece, capturedPiece);
    const beforeTurn = this.state.turn;
    this.applyMoveToState(this.state, move);
    const decorated = this.decorateNotation(notation, this.state.turn, this.state);

    this.moveHistory.push({
      san: decorated,
      color: beforeTurn,
      label,
      from: this.squareName(move.from.r, move.from.c),
      to: this.squareName(move.to.r, move.to.c)
    });

    this.refreshGameOver();
    return true;
  }

  applyMoveToState(state, move) {
    const board = state.board;
    const movingPiece = board[move.from.r][move.from.c];
    if (!movingPiece) return;

    const color = this.colorOf(movingPiece);
    const capturedPiece = move.enPassant ? board[move.from.r][move.to.c] : board[move.to.r][move.to.c];
    const capturedSquare = move.enPassant ? { r: move.from.r, c: move.to.c } : move.to;

    this.updateCastlingRights(state, move, movingPiece, capturedPiece, capturedSquare);

    board[move.from.r][move.from.c] = null;

    if (move.enPassant) {
      board[move.from.r][move.to.c] = null;
    }

    if (move.castle === "K") {
      board[move.to.r][5] = board[move.to.r][7];
      board[move.to.r][7] = null;
    }

    if (move.castle === "Q") {
      board[move.to.r][3] = board[move.to.r][0];
      board[move.to.r][0] = null;
    }

    let placedPiece = movingPiece;
    if (this.typeOf(movingPiece) === "P" && (move.to.r === 0 || move.to.r === 7)) {
      placedPiece = color + (move.promotion || "Q");
    }

    board[move.to.r][move.to.c] = placedPiece;

    state.enPassant = null;
    if (this.typeOf(movingPiece) === "P" && Math.abs(move.from.r - move.to.r) === 2) {
      state.enPassant = {
        r: (move.from.r + move.to.r) / 2,
        c: move.from.c
      };
    }

    if (state.turn === "b") state.fullMove += 1;
    state.turn = this.opponent(state.turn);
  }

  updateCastlingRights(state, move, movingPiece, capturedPiece, capturedSquare) {
    const from = move.from;
    const color = this.colorOf(movingPiece);

    if (this.typeOf(movingPiece) === "K") {
      state.castling[color].K = false;
      state.castling[color].Q = false;
    }

    if (this.typeOf(movingPiece) === "R") {
      if (from.r === 7 && from.c === 0) state.castling.w.Q = false;
      if (from.r === 7 && from.c === 7) state.castling.w.K = false;
      if (from.r === 0 && from.c === 0) state.castling.b.Q = false;
      if (from.r === 0 && from.c === 7) state.castling.b.K = false;
    }

    if (capturedPiece && this.typeOf(capturedPiece) === "R") {
      const to = capturedSquare;
      if (to.r === 7 && to.c === 0) state.castling.w.Q = false;
      if (to.r === 7 && to.c === 7) state.castling.w.K = false;
      if (to.r === 0 && to.c === 0) state.castling.b.Q = false;
      if (to.r === 0 && to.c === 7) state.castling.b.K = false;
    }
  }

  getAllLegalMoves(color = this.state.turn, state = this.state) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (state.board[r][c] && this.colorOf(state.board[r][c]) === color) {
          moves.push(...this.getLegalMovesForPiece(r, c, state));
        }
      }
    }
    return moves;
  }

  getLegalMovesForPiece(r, c, state = this.state) {
    const piece = state.board[r][c];
    if (!piece) return [];
    const color = this.colorOf(piece);
    const pseudo = this.getPseudoMoves(r, c, state);

    return pseudo.filter(move => {
      const testState = this.cloneState(state);
      this.applyMoveToState(testState, move);
      return !this.isInCheck(color, testState);
    });
  }

  getPseudoMoves(r, c, state = this.state) {
    const board = state.board;
    const piece = board[r][c];
    if (!piece) return [];

    const color = this.colorOf(piece);
    const type = this.typeOf(piece);
    const moves = [];

    const addMove = (toR, toC, extras = {}) => {
      if (!this.isOnBoard(toR, toC)) return;
      const target = board[toR][toC];
      if (target && this.typeOf(target) === "K") return;
      if (!target || this.colorOf(target) !== color) {
        moves.push({ from: { r, c }, to: { r: toR, c: toC }, ...extras });
      }
    };

    if (type === "P") {
      const dir = color === "w" ? -1 : 1;
      const startRow = color === "w" ? 6 : 1;
      const promotionRow = color === "w" ? 0 : 7;
      const oneR = r + dir;

      if (this.isOnBoard(oneR, c) && !board[oneR][c]) {
        addMove(oneR, c, oneR === promotionRow ? { promotion: "Q" } : {});
        const twoR = r + dir * 2;
        if (r === startRow && this.isOnBoard(twoR, c) && !board[twoR][c]) addMove(twoR, c);
      }

      for (const dc of [-1, 1]) {
        const capR = r + dir;
        const capC = c + dc;
        if (!this.isOnBoard(capR, capC)) continue;

        const target = board[capR][capC];
        if (target && this.colorOf(target) !== color) {
          addMove(capR, capC, capR === promotionRow ? { promotion: "Q" } : {});
        }

        if (state.enPassant && state.enPassant.r === capR && state.enPassant.c === capC) {
          addMove(capR, capC, { enPassant: true });
        }
      }
    }

    if (type === "N") {
      for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        addMove(r + dr, c + dc);
      }
    }

    if (["B", "R", "Q"].includes(type)) {
      const directions = [];
      if (["B", "Q"].includes(type)) directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      if (["R", "Q"].includes(type)) directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);

      for (const [dr, dc] of directions) {
        let nr = r + dr;
        let nc = c + dc;
        while (this.isOnBoard(nr, nc)) {
          const target = board[nr][nc];
          if (!target) {
            addMove(nr, nc);
          } else {
            if (this.colorOf(target) !== color) addMove(nr, nc);
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
    }

    if (type === "K") {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr || dc) addMove(r + dr, c + dc);
        }
      }

      const homeRow = color === "w" ? 7 : 0;
      const enemy = this.opponent(color);
      if (r === homeRow && c === 4 && !this.isInCheck(color, state)) {
        if (
          state.castling[color].K &&
          board[homeRow][7] === color + "R" &&
          !board[homeRow][5] &&
          !board[homeRow][6] &&
          !this.isSquareAttacked(homeRow, 5, enemy, state) &&
          !this.isSquareAttacked(homeRow, 6, enemy, state)
        ) {
          addMove(homeRow, 6, { castle: "K" });
        }

        if (
          state.castling[color].Q &&
          board[homeRow][0] === color + "R" &&
          !board[homeRow][1] &&
          !board[homeRow][2] &&
          !board[homeRow][3] &&
          !this.isSquareAttacked(homeRow, 3, enemy, state) &&
          !this.isSquareAttacked(homeRow, 2, enemy, state)
        ) {
          addMove(homeRow, 2, { castle: "Q" });
        }
      }
    }

    return moves;
  }

  isInCheck(color, state = this.state) {
    const king = this.findKing(color, state);
    if (!king) return true;
    return this.isSquareAttacked(king.r, king.c, this.opponent(color), state);
  }

  findKing(color, state = this.state) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (state.board[r][c] === color + "K") return { r, c };
      }
    }
    return null;
  }

  isSquareAttacked(r, c, byColor, state = this.state) {
    const board = state.board;
    for (let pr = 0; pr < 8; pr++) {
      for (let pc = 0; pc < 8; pc++) {
        if (pr === r && pc === c) continue;
        const piece = board[pr][pc];
        if (!piece || this.colorOf(piece) !== byColor) continue;

        const type = this.typeOf(piece);
        const dr = r - pr;
        const dc = c - pc;

        if (type === "P") {
          const dir = byColor === "w" ? -1 : 1;
          if (dr === dir && Math.abs(dc) === 1) return true;
        }

        if (type === "N") {
          if ((Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2)) return true;
        }

        if (type === "K") {
          if (Math.max(Math.abs(dr), Math.abs(dc)) === 1) return true;
        }

        if (["B", "R", "Q"].includes(type)) {
          const diagonal = Math.abs(dr) === Math.abs(dc);
          const straight = dr === 0 || dc === 0;
          const canAttack = (type === "B" && diagonal) || (type === "R" && straight) || (type === "Q" && (diagonal || straight));
          if (!canAttack) continue;

          const stepR = Math.sign(dr);
          const stepC = Math.sign(dc);
          let checkR = pr + stepR;
          let checkC = pc + stepC;
          let blocked = false;

          while (checkR !== r || checkC !== c) {
            if (board[checkR][checkC]) {
              blocked = true;
              break;
            }
            checkR += stepR;
            checkC += stepC;
          }
          if (!blocked) return true;
        }
      }
    }
    return false;
  }

  isCheckmate(color, state = this.state) {
    return this.isInCheck(color, state) && this.getAllLegalMoves(color, state).length === 0;
  }

  isStalemate(color, state = this.state) {
    return !this.isInCheck(color, state) && this.getAllLegalMoves(color, state).length === 0;
  }

  getStatus(state = this.state) {
    const color = state.turn;
    const legalMoves = this.getAllLegalMoves(color, state);
    const checked = this.isInCheck(color, state);

    if (legalMoves.length === 0 && checked) {
      return { over: true, kind: "checkmate", winner: this.opponent(color) };
    }

    if (legalMoves.length === 0) {
      return { over: true, kind: "stalemate", winner: null };
    }

    return { over: false, kind: checked ? "check" : "playing", winner: null };
  }

  refreshGameOver() {
    const status = this.getStatus(this.state);
    this.gameOver = status.over;
    this.result = status;
    return status;
  }

  moveNotation(move, movingPiece, capturedPiece) {
    if (move.castle === "K") return "O-O";
    if (move.castle === "Q") return "O-O-O";

    const type = this.typeOf(movingPiece);
    const pieceLetter = type === "P" ? "" : type;
    const capture = capturedPiece || move.enPassant ? "x" : "";
    const pawnFile = type === "P" && capture ? "abcdefgh"[move.from.c] : "";
    const promo = this.typeOf(movingPiece) === "P" && (move.to.r === 0 || move.to.r === 7)
      ? `=${move.promotion || "Q"}`
      : "";
    return `${pieceLetter}${pawnFile}${capture}${this.squareName(move.to.r, move.to.c)}${promo}`;
  }

  decorateNotation(notation, sideToMove, state = this.state) {
    const legal = this.getAllLegalMoves(sideToMove, state);
    const checked = this.isInCheck(sideToMove, state);
    if (legal.length === 0 && checked) return notation + "#";
    if (checked) return notation + "+";
    return notation;
  }
}

window.ChessGame = ChessGame;

window.addEventListener("DOMContentLoaded", () => {
  const PIECES = {
    wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
    bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟"
  };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const lastMoveEl = document.getElementById("lastMove");
  const movesEl = document.getElementById("moves");
  const moveCountEl = document.getElementById("moveCount");
  const opponentSelect = document.getElementById("opponentSelect");
  const whiteEngineSelect = document.getElementById("whiteEngineSelect");
  const blackEngineSelect = document.getElementById("blackEngineSelect");
  const testGamesInput = document.getElementById("testGamesInput");
  const testResultEl = document.getElementById("testResult");
  const openingStatsEl = document.getElementById("openingStats");
  const runTestBtn = document.getElementById("runTestBtn");
  const promotionModal = document.getElementById("promotionModal");

  const engines = {
    v1: window.StonefishV1,
    v2: window.StonefishV2,
    v3: window.StonefishV3,
    v31: window.StonefishV31,
    v4: window.StonefishV4,
    v45f: window.StonefishV45Flash,
    v45: window.StonefishV45,
    v5f: window.StonefishV5Flash,
    v5: window.StonefishV5,
    v6f: window.StonefishV6Flash,
    v6: window.StonefishV6,
    v65f: window.StonefishV65Flash,
    v65: window.StonefishV65,
    v67f: window.StonefishV67Flash,
    v67: window.StonefishV67
  };

  let game = new ChessGame();
  let selected = null;
  let selectedMoves = [];
  let flipped = false;
  let mode = "human";
  let humanColor = "w";
  let engineTimer = null;
  let watchTimer = null;
  let testTimer = null;
  let testRunId = 0;
  let pendingPromotionMove = null;
  let lastOpponentMove = null;

  function selectedOpponentEngine() {
    return engines[opponentSelect.value] || engines.v45 || engines.v4;
  }

  function engineBySelect(select) {
    return engines[select.value] || engines.v45 || engines.v4;
  }

  function hideOpeningStats() {
    if (!openingStatsEl) return;
    openingStatsEl.classList.add("hidden");
    openingStatsEl.innerHTML = "";
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clearTimers() {
    clearTimeout(engineTimer);
    clearTimeout(watchTimer);
    clearTimeout(testTimer);
    engineTimer = null;
    watchTimer = null;
    testTimer = null;
    testRunId += 1;
    if (runTestBtn) runTestBtn.disabled = false;
  }

  function newHumanGame() {
    clearTimers();
    mode = "human";
    game.reset();
    selected = null;
    selectedMoves = [];
    pendingPromotionMove = null;
    lastOpponentMove = null;
    hidePromotionModal();
    lastMoveEl.textContent = `You are White. Opponent: ${selectedOpponentEngine().name}.`;
    testResultEl.textContent = "Watch mode makes one move every 3 seconds.";
    hideOpeningStats();
    render();
  }

  function render() {
    boardEl.innerHTML = "";
    const board = game.state.board;
    const rows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const cols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const checkedKingSquares = new Set();

    for (const color of ["w", "b"]) {
      const king = game.findKing(color, game.state);
      if (king && game.isInCheck(color, game.state)) checkedKingSquares.add(`${king.r},${king.c}`);
    }

    for (const r of rows) {
      for (const c of cols) {
        const square = document.createElement("div");
        square.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;
        square.dataset.r = r;
        square.dataset.c = c;

        if (lastOpponentMove && (
          (lastOpponentMove.from.r === r && lastOpponentMove.from.c === c) ||
          (lastOpponentMove.to.r === r && lastOpponentMove.to.c === c)
        )) {
          square.classList.add("last-opponent-move");
        }

        if (checkedKingSquares.has(`${r},${c}`)) square.classList.add("in-check");

        if (selected && selected.r === r && selected.c === c) square.classList.add("selected");

        const moveToHere = selectedMoves.find(m => m.to.r === r && m.to.c === c);
        if (moveToHere) {
          if (board[r][c] || moveToHere.enPassant) square.classList.add("capture");
          else square.classList.add("legal");
        }

        const piece = board[r][c];
        if (piece) {
          const pieceEl = document.createElement("span");
          pieceEl.className = `piece ${game.colorOf(piece) === "w" ? "white" : "black"}`;
          pieceEl.textContent = PIECES[piece];

          if (canHumanMovePiece(r, c)) {
            pieceEl.draggable = true;
            pieceEl.addEventListener("dragstart", event => onDragStart(event, r, c));
          }
          square.appendChild(pieceEl);
        }

        if ((!flipped && (r === 7 || c === 0)) || (flipped && (r === 0 || c === 7))) {
          const coord = document.createElement("span");
          coord.className = "coord";
          if ((!flipped && c === 0) || (flipped && c === 7)) coord.textContent += 8 - r;
          if ((!flipped && r === 7) || (flipped && r === 0)) coord.textContent += "abcdefgh"[c];
          square.appendChild(coord);
        }

        square.addEventListener("click", onSquareClick);
        square.addEventListener("dragover", event => event.preventDefault());
        square.addEventListener("drop", event => onDrop(event, r, c));
        boardEl.appendChild(square);
      }
    }

    renderStatus();
    renderMoveList();
  }

  function canHumanMovePiece(r, c) {
    if (mode !== "human" || game.gameOver || pendingPromotionMove) return false;
    const piece = game.state.board[r][c];
    return piece && game.colorOf(piece) === humanColor && game.state.turn === humanColor;
  }

  function renderStatus() {
    const status = game.getStatus(game.state);
    if (status.over) {
      if (status.kind === "checkmate") {
        statusEl.innerHTML = `<span class="mate">Checkmate. ${status.winner === "w" ? "White" : "Black"} wins.</span>`;
      } else {
        statusEl.textContent = "Stalemate. Draw.";
      }
      return;
    }

    const side = game.state.turn === "w" ? "White" : "Black";
    if (status.kind === "check") {
      statusEl.innerHTML = `<span class="check">${side} to move — check!</span>`;
    } else {
      statusEl.textContent = `${side} to move`;
    }
  }

  function renderMoveList() {
    movesEl.innerHTML = "";
    for (let i = 0; i < game.moveHistory.length; i += 2) {
      const row = document.createElement("div");
      row.className = "move-row";
      row.innerHTML = `
        <span class="move-no">${Math.floor(i / 2) + 1}.</span>
        <span>${game.moveHistory[i]?.san || ""}</span>
        <span>${game.moveHistory[i + 1]?.san || ""}</span>
      `;
      movesEl.appendChild(row);
    }
    movesEl.scrollTop = movesEl.scrollHeight;
    moveCountEl.textContent = `${game.moveHistory.length} move${game.moveHistory.length === 1 ? "" : "s"}`;
  }

  function onSquareClick(event) {
    if (mode !== "human" || game.gameOver || pendingPromotionMove || game.state.turn !== humanColor) return;

    const r = Number(event.currentTarget.dataset.r);
    const c = Number(event.currentTarget.dataset.c);
    const piece = game.state.board[r][c];

    if (selected) {
      const legalMove = selectedMoves.find(m => m.to.r === r && m.to.c === c);
      if (legalMove) {
        attemptHumanMove(legalMove);
        return;
      }

      if (piece && game.colorOf(piece) === humanColor) {
        selectSquare(r, c);
        return;
      }

      selected = null;
      selectedMoves = [];
      render();
      return;
    }

    if (piece && game.colorOf(piece) === humanColor) selectSquare(r, c);
  }

  function selectSquare(r, c) {
    selected = { r, c };
    selectedMoves = game.getLegalMovesForPiece(r, c);
    render();
  }

  function onDragStart(event, r, c) {
    if (!canHumanMovePiece(r, c)) return;
    selected = { r, c };
    selectedMoves = game.getLegalMovesForPiece(r, c);
    event.dataTransfer.setData("text/plain", `${r},${c}`);
    event.dataTransfer.effectAllowed = "move";
  }

  function onDrop(event, r, c) {
    event.preventDefault();
    if (mode !== "human" || game.gameOver || pendingPromotionMove || game.state.turn !== humanColor || !selected) return;
    const legalMove = selectedMoves.find(m => m.to.r === r && m.to.c === c);
    if (legalMove) attemptHumanMove(legalMove);
  }

  function attemptHumanMove(move) {
    const moveCopy = game.cloneMove(move);
    if (game.isPromotionMove(moveCopy)) {
      pendingPromotionMove = moveCopy;
      showPromotionModal();
      return;
    }
    completeHumanMove(moveCopy);
  }

  function completeHumanMove(move) {
    selected = null;
    selectedMoves = [];
    pendingPromotionMove = null;
    hidePromotionModal();
    lastOpponentMove = null;
    game.makeMove(move, "You");
    const played = game.moveHistory[game.moveHistory.length - 1];
    lastMoveEl.textContent = played ? `You played ${played.san}` : "You moved.";
    render();
    maybeOpponentMove();
  }

  function showPromotionModal() {
    promotionModal.classList.remove("hidden");
  }

  function hidePromotionModal() {
    promotionModal.classList.add("hidden");
  }

  function maybeOpponentMove() {
    if (mode !== "human" || game.gameOver || game.state.turn === humanColor) return;
    statusEl.innerHTML = `<span class="thinking">${selectedOpponentEngine().name} is thinking...</span>`;
    engineTimer = setTimeout(() => {
      const engine = selectedOpponentEngine();
      const move = engine.chooseMove(game, game.state.turn);
      if (!move) {
        game.refreshGameOver();
        render();
        return;
      }
      game.makeMove(move, engine.name);
      lastOpponentMove = { from: { ...move.from }, to: { ...move.to } };
      const played = game.moveHistory[game.moveHistory.length - 1];
      lastMoveEl.textContent = `${engine.name} played ${played.san}`;
      render();
    }, 420);
  }

  function startWatchMode() {
    clearTimers();
    mode = "watch";
    game.reset();
    selected = null;
    selectedMoves = [];
    pendingPromotionMove = null;
    lastOpponentMove = null;
    hidePromotionModal();
    lastMoveEl.textContent = `${engineBySelect(whiteEngineSelect).name} vs ${engineBySelect(blackEngineSelect).name}.`;
    testResultEl.textContent = "Watch mode running: one move every 3 seconds.";
    hideOpeningStats();
    render();
    scheduleWatchMove();
  }

  function scheduleWatchMove() {
    clearTimeout(watchTimer);
    if (mode !== "watch" || game.gameOver) return;
    watchTimer = setTimeout(playWatchMove, 3000);
  }

  function playWatchMove() {
    if (mode !== "watch" || game.gameOver) return;
    const engine = game.state.turn === "w" ? engineBySelect(whiteEngineSelect) : engineBySelect(blackEngineSelect);
    const move = engine.chooseMove(game, game.state.turn);
    if (!move) {
      game.refreshGameOver();
      render();
      return;
    }

    game.makeMove(move, engine.name);
    lastOpponentMove = { from: { ...move.from }, to: { ...move.to } };
    const played = game.moveHistory[game.moveHistory.length - 1];
    lastMoveEl.textContent = `${engine.name} played ${played.san}`;
    render();
    scheduleWatchMove();
  }

  function stopWatchMode() {
    clearTimers();
    if (mode === "watch") {
      mode = "human";
      testResultEl.textContent = "Watch mode stopped.";
      render();
    }
  }

  function createOpeningStats() {
    const stats = new Map();
    const book = window.StonefishOpenings;

    const addOpenings = openings => {
      for (const opening of openings || []) {
        if (!stats.has(opening.name)) {
          stats.set(opening.name, { games: 0, wins: 0, losses: 0, draws: 0 });
        }
      }
    };

    if (book) {
      addOpenings((book.WHITE_OPENINGS || []).slice(0, book.FIRST_WHITE_LIMIT || 15));
      addOpenings((book.BLACK_OPENINGS || []).slice(0, book.FIRST_BLACK_LIMIT || 15));
    }

    return stats;
  }

  function recordOpeningResult(openingStats, openingNames, winner, sideUsingOpening) {
    const names = Array.isArray(openingNames)
      ? openingNames
      : openingNames
        ? [openingNames]
        : [];

    for (const openingName of new Set(names)) {
      if (!openingName) continue;
      if (!openingStats.has(openingName)) {
        openingStats.set(openingName, { games: 0, wins: 0, losses: 0, draws: 0 });
      }

      const row = openingStats.get(openingName);
      row.games += 1;
      if (winner === "draw") row.draws += 1;
      else if (winner === sideUsingOpening) row.wins += 1;
      else row.losses += 1;
    }
  }

  function openingScoreRate(stat) {
    if (!stat.games) return -1;
    return (stat.wins + stat.draws * 0.5) / stat.games;
  }

  function openingWinRate(stat) {
    if (!stat.games) return -1;
    return stat.wins / stat.games;
  }

  function renderOpeningStats(openingStats, completed, total) {
    if (!openingStatsEl) return;

    const rows = Array.from(openingStats.entries())
      .sort((a, b) => {
        const scoreDiff = openingScoreRate(b[1]) - openingScoreRate(a[1]);
        if (scoreDiff !== 0) return scoreDiff;

        const winDiff = openingWinRate(b[1]) - openingWinRate(a[1]);
        if (winDiff !== 0) return winDiff;

        if (b[1].games !== a[1].games) return b[1].games - a[1].games;
        return a[0].localeCompare(b[0]);
      });

    openingStatsEl.classList.remove("hidden");
    if (!rows.length) {
      openingStatsEl.innerHTML = `<h3>Opening win rates</h3><p>No openings are loaded.</p>`;
      return;
    }

    const body = rows.map(([name, stat]) => {
      const winRate = stat.games ? ((stat.wins / stat.games) * 100).toFixed(1) + "%" : "—";
      const scoreRate = stat.games ? (((stat.wins + stat.draws * 0.5) / stat.games) * 100).toFixed(1) + "%" : "—";
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${stat.games}</td>
        <td>${stat.wins}-${stat.draws}-${stat.losses}</td>
        <td>${winRate}</td>
        <td>${scoreRate}</td>
      </tr>`;
    }).join("");

    openingStatsEl.innerHTML = `
      <h3>Opening win rates (${completed}/${total})</h3>
      <p>All loaded openings are shown, sorted by best score percentage.</p>
      <table>
        <thead>
          <tr><th>Opening</th><th>Games</th><th>W-D-L</th><th>Win</th><th>Score</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function runTestMode() {
    clearTimers();
    mode = "test";
    selected = null;
    selectedMoves = [];
    pendingPromotionMove = null;
    lastOpponentMove = null;
    hidePromotionModal();

    const requested = Number.parseInt(testGamesInput.value, 10);
    let games = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 5000) : 100;
    games = Math.max(2, games);
    if (games % 2 !== 0) games += 1;
    if (games > 5000) games = 5000;
    testGamesInput.value = games;

    const engineA = engineBySelect(whiteEngineSelect);
    const engineB = engineBySelect(blackEngineSelect);
    const labelA = engineA.name === engineB.name ? `${engineA.name} A` : engineA.name;
    const labelB = engineA.name === engineB.name ? `${engineB.name} B` : engineB.name;
    const totals = { a: 0, b: 0, draw: 0 };
    const colorCounts = { aWhite: 0, aBlack: 0, bWhite: 0, bBlack: 0 };
    const openingStats = createOpeningStats();
    const runId = testRunId;
    const started = performance.now();
    let completed = 0;

    runTestBtn.disabled = true;
    testResultEl.textContent = `Testing 0/${games} games: ${labelA} 0.0%, ${labelB} 0.0%, draws 0.0%. Colors alternate evenly.`;
    renderOpeningStats(openingStats, 0, games);
    lastMoveEl.textContent = `${labelA} vs ${labelB} test mode running.`;
    game.reset();
    render();

    const updateProgress = () => {
      const done = Math.max(completed, 1);
      const aPct = ((totals.a / done) * 100).toFixed(1);
      const bPct = ((totals.b / done) * 100).toFixed(1);
      const drawPct = ((totals.draw / done) * 100).toFixed(1);
      testResultEl.textContent = `Testing ${completed}/${games} games: ${labelA} ${aPct}%, ${labelB} ${bPct}%, draws ${drawPct}%. Colors: ${labelA} W${colorCounts.aWhite}/B${colorCounts.aBlack}, ${labelB} W${colorCounts.bWhite}/B${colorCounts.bBlack}.`;
      renderOpeningStats(openingStats, completed, games);
    };

    const finish = () => {
      const elapsed = ((performance.now() - started) / 1000).toFixed(2);
      const aPct = ((totals.a / games) * 100).toFixed(1);
      const bPct = ((totals.b / games) * 100).toFixed(1);
      const drawPct = ((totals.draw / games) * 100).toFixed(1);
      testResultEl.textContent = `Done ${games}/${games} games in ${elapsed}s: ${labelA} won ${aPct}%, ${labelB} won ${bPct}%, draws ${drawPct}%. Colors were even: ${labelA} W${colorCounts.aWhite}/B${colorCounts.aBlack}, ${labelB} W${colorCounts.bWhite}/B${colorCounts.bBlack}.`;
      renderOpeningStats(openingStats, games, games);
      runTestBtn.disabled = false;
      mode = "human";
      game.reset();
      lastMoveEl.textContent = "Test mode finished. Start a new game or watch mode.";
      render();
    };

    const processChunk = () => {
      if (runId !== testRunId || mode !== "test") {
        runTestBtn.disabled = false;
        return;
      }

      const chunkStarted = performance.now();
      do {
        const evenGame = completed % 2 === 0;
        const whiteEngine = evenGame ? engineA : engineB;
        const blackEngine = evenGame ? engineB : engineA;
        const whiteSlot = evenGame ? "a" : "b";
        const blackSlot = evenGame ? "b" : "a";

        if (whiteSlot === "a") colorCounts.aWhite += 1;
        else colorCounts.bWhite += 1;

        if (blackSlot === "a") colorCounts.aBlack += 1;
        else colorCounts.bBlack += 1;

        const gameResult = simulateGame(whiteEngine, blackEngine, 320);
        const result = gameResult.winner;
        if (result === "w") totals[whiteSlot] += 1;
        else if (result === "b") totals[blackSlot] += 1;
        else totals.draw += 1;

        recordOpeningResult(openingStats, gameResult.openings.w, result, "w");
        recordOpeningResult(openingStats, gameResult.openings.b, result, "b");

        completed += 1;
      } while (completed < games && performance.now() - chunkStarted < 35);

      updateProgress();

      if (completed >= games) {
        finish();
      } else {
        testTimer = setTimeout(processChunk, 0);
      }
    };

    testTimer = setTimeout(processChunk, 0);
  }

  function simulateGame(whiteEngine, blackEngine, maxPlies) {
    const sim = new ChessGame();
    const openingsUsed = { w: new Set(), b: new Set() };

    const finishSimulation = winner => ({
      winner: winner || "draw",
      openings: {
        w: Array.from(openingsUsed.w),
        b: Array.from(openingsUsed.b)
      }
    });

    for (let ply = 0; ply < maxPlies; ply++) {
      const status = sim.getStatus(sim.state);
      if (status.over) return finishSimulation(status.winner || "draw");

      const engine = sim.state.turn === "w" ? whiteEngine : blackEngine;
      let move = engine.chooseMove(sim, sim.state.turn);
      const legal = sim.getAllLegalMoves(sim.state.turn);

      if (!move && legal.length) move = sim.cloneMove(legal[Math.floor(Math.random() * legal.length)]);
      if (!move) return finishSimulation(sim.isInCheck(sim.state.turn) ? sim.opponent(sim.state.turn) : "draw");

      if (!isLegalMoveObject(sim, move, legal)) {
        move = sim.cloneMove(legal[Math.floor(Math.random() * legal.length)]);
      }

      const beforeTurn = sim.state.turn;
      if (move._stonefishBook) {
        const names = Array.isArray(move._stonefishOpeningNames) && move._stonefishOpeningNames.length
          ? move._stonefishOpeningNames
          : move._stonefishOpeningName
            ? [move._stonefishOpeningName]
            : [];
        for (const name of names) openingsUsed[beforeTurn].add(name);
      }
      const from = sim.squareName(move.from.r, move.from.c);
      const to = sim.squareName(move.to.r, move.to.c);
      sim.applyMoveToState(sim.state, move);
      sim.moveHistory.push({
        san: `${from}-${to}`,
        color: beforeTurn,
        label: engine.name,
        from,
        to
      });
    }

    return finishSimulation("draw");
  }

  function isLegalMoveObject(sim, candidate, legalMoves) {
    return legalMoves.some(move =>
      move.from.r === candidate.from.r &&
      move.from.c === candidate.from.c &&
      move.to.r === candidate.to.r &&
      move.to.c === candidate.to.c
    );
  }

  document.getElementById("newGameBtn").addEventListener("click", newHumanGame);
  document.getElementById("flipBtn").addEventListener("click", () => {
    flipped = !flipped;
    render();
  });
  document.getElementById("watchBtn").addEventListener("click", startWatchMode);
  document.getElementById("stopWatchBtn").addEventListener("click", stopWatchMode);
  runTestBtn.addEventListener("click", runTestMode);
  opponentSelect.addEventListener("change", () => {
    if (mode === "human" && game.state.turn !== humanColor) maybeOpponentMove();
    lastMoveEl.textContent = `Opponent: ${selectedOpponentEngine().name}.`;
  });

  promotionModal.querySelectorAll("button[data-piece]").forEach(button => {
    button.addEventListener("click", () => {
      if (!pendingPromotionMove) return;
      pendingPromotionMove.promotion = button.dataset.piece;
      completeHumanMove(pendingPromotionMove);
    });
  });

  opponentSelect.value = "v67";
  newHumanGame();
});
