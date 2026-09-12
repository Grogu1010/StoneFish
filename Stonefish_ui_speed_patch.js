// StoneFish UI latency patch.
// Normal play used to wait 450 ms before starting the selected engine and then
// repeated terminal-state move generation on the same unchanged position.
// Keep engine choice/search untouched: use early-exit legal-move existence,
// raw moves for square highlighting, and no artificial pre-think pause.
let stonefishUiGameEnded = false;

// Highlighting only needs destination squares. Avoid converting every legal
// move to a public object (piece strings, capture strings, wrapper allocation).
selectSquare = function(square) {
  selectedSquare = square;
  const from = game._sq(square);
  const raw = game.fastMoves();
  legalTargets = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i].from === from) legalTargets.push(game._alg(raw[i].to));
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

  const move = game.move({ from: selectedSquare, to: square, promotion: 'q' });
  if (!move) return;
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
