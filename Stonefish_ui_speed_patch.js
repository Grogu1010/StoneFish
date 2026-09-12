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
