// Behavioral contracts for per-game opponent memory and attributable evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

vm.runInThisContext(['StonefishChess.js', 'ARMX/ARMX.js']
  .map(file => fs.readFileSync(file, 'utf8')).join('\n\n'));

function play(game, ...moves) {
  for (const move of moves) {
    assert.ok(game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || 'q' }), move);
  }
  return game;
}

function snapshot(game) {
  return JSON.stringify({
    board: Array.from(game.boardState), side: game.side, castling: game.castling,
    ep: game.ep, halfmove: game.halfmove, fullmove: game.fullmove,
    kings: game.kingSq, history: game.historyStack, repetitions: [...game.positionCounts]
  });
}

function review(game) {
  return armxPreviewReview(game, game.fastMoves().slice(0, 3)
    .map(raw => ({ raw, score: 100, deep: 100 })), game.side);
}

// Both players can use ARMX without erasing each other's learned memory.
{
  const game = play(new Chess(), 'e2e4', 'e7e5', 'g1f3');
  const white = armxPreviewSyncProfile(game, 1);
  const black = armxPreviewSyncProfile(game, -1);
  assert.notEqual(white, black);
  play(game, 'b8c6');
  assert.equal(armxPreviewSyncProfile(game, 1), white);
  assert.equal(armxPreviewSyncProfile(game, -1), black);
  assert.equal(white.opponentMoves, 2);
  assert.equal(black.opponentMoves, 2);

  // Replacing a move after undo at the same history length must discard notes
  // about the old branch, including for the side that has not reviewed yet.
  game.fastUndo();
  play(game, 'd7d6');
  const replacement = armxPreviewSyncProfile(game, 1);
  assert.notEqual(replacement, white);
  assert.notEqual(armxPreviewSyncProfile(game, -1), black);
  assert.equal(replacement.replay.fastPositionKey(), game.fastPositionKey());
  game.reset();
  const fresh = armxPreviewSyncProfile(game, 1);
  assert.equal(fresh.opponentMoves, 0);
  assert.equal(fresh.pending.length, 0);
}

// Opening generators did not observe the actual opponent. Replay their moves
// for board alignment, and learn only from subsequent decisions.
{
  const game = play(new Chess(), 'e2e4', 'd7d5', 'e4d5', 'd8d5');
  game.armxObservationStartPly = game.historyStack.length;
  const first = review(game);
  assert.equal(first.observedPlies, 0);
  assert.equal(first.opponentMovesObserved, 0);
  assert.deepEqual(first.notes, []);
  assert.ok(first.reports.every(report => report.adjustment === 0));
  play(game, 'b1c3', 'd5a5');
  const second = review(game);
  assert.equal(second.observedPlies, 2);
  assert.equal(second.opponentMovesObserved, 1);
  assert.equal(armxPreviewSyncProfile(game, game.side).replay.fastPositionKey(), game.fastPositionKey());
}

// Replaying the same opening against the same opponent in another round must
// not inherit the first round's observations, including on a reused game object.
{
  const opening = ['e2e4', 'd7d5', 'e4d5', 'd8d5'];
  const first = play(new Chess(), ...opening);
  first.armxObservationStartPly = first.historyStack.length;
  review(first);
  play(first, 'b1c3', 'd5a5', 'g1f3', 'g8f6');
  review(first);
  const learned = armxPreviewSyncProfile(first, 1);
  assert.equal(learned.opponentMoves, 2);
  assert.ok(Object.values(learned.ourEffects).some(row => row.weight > 0));

  const second = play(new Chess(), ...opening);
  second.armxObservationStartPly = second.historyStack.length;
  const fresh = review(second);
  assert.notEqual(armxPreviewSyncProfile(second, 1), learned);
  assert.equal(fresh.opponentMovesObserved, 0);
  assert.equal(fresh.observedPlies, 0);
  assert.deepEqual(fresh.notes, []);
  assert.ok(fresh.reports.every(report => report.adjustment === 0));

  first.reset();
  play(first, ...opening);
  first.armxObservationStartPly = first.historyStack.length;
  const reused = review(first);
  assert.notEqual(armxPreviewSyncProfile(first, 1), learned);
  assert.equal(reused.opponentMovesObserved, 0);
  assert.deepEqual(reused.notes, []);
  assert.ok(reused.reports.every(report => report.adjustment === 0));
}

// A capture of another piece is not an accepted exchange invitation.
{
  const unrelated = play(new Chess(), 'e2e4', 'd7d5', 'g1f3', 'd5e4');
  const unrelatedProfile = armxPreviewSyncProfile(unrelated, 1);
  assert.equal(unrelatedProfile.acceptedResponseEffects.capture.weight, 0);
  assert.equal(unrelatedProfile.opponentChoices.capture, 1);

  const exchange = play(new Chess(), 'e2e4', 'd7d5', 'e4d5', 'd8d5');
  const exchangeProfile = armxPreviewSyncProfile(exchange, 1);
  assert.ok(exchangeProfile.acceptedResponseEffects.capture.weight > 0);
  assert.deepEqual([...exchangeProfile.acceptedResponseEffects.capture.observations], [3]);

  const enPassant = play(new Chess(), 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6');
  assert.ok(armxPreviewSyncProfile(enPassant, -1).acceptedResponseEffects.capture.weight > 0);
}

// A captured-piece invitation depends on this candidate, not any legal capture.
{
  const game = play(new Chess(), 'e2e4', 'd7d5');
  const quiet = game.fastMoves().find(move => move.from === game._sq('g1') && move.to === game._sq('f3'));
  const capture = game.fastMoves().find(move => move.from === game._sq('e4') && move.to === game._sq('d5'));
  const before = snapshot(game);
  const quietOptions = armxPreviewCandidateReplyOpportunities(game, quiet);
  const captureOptions = armxPreviewCandidateReplyOpportunities(game, capture);
  assert.ok(quietOptions.available.has('capture'));
  assert.equal(quietOptions.offered.has('capture'), false);
  assert.ok(captureOptions.offered.has('capture'));
  assert.equal(snapshot(game), before);
}

// Sparse tendencies are regularized; repeated horizons and correlated feature
// labels do not manufacture independent observations or full confidence.
{
  const profile = armxPreviewNewProfile(1);
  profile.opponentOpportunities.capture = 1;
  profile.opponentChoices.capture = 1;
  assert.equal(armxPreviewOpponentChoiceRate(profile, 'capture').rate, 2 / 3);
  const features = new Set(['capture', 'trade', 'rookTrade', 'simplify']);
  armxPreviewRecordImpact(profile.ourEffects, features, 100, 0.65, 4);
  armxPreviewRecordImpact(profile.ourEffects, features, 100, 0.35, 4);
  armxPreviewRecordImpact(profile.ourEffects, features, 100, 0.65, 6);
  armxPreviewRecordImpact(profile.ourEffects, features, 100, 0.35, 6);
  assert.equal(profile.ourEffects.capture.observations.size, 2);
  const game = new Chess();
  const raw = { from: 0, to: 56, piece: 4, captured: 4, promotion: 0, flags: 1 };
  const report = armxPreviewCandidateReport(game, { raw, score: 100, deep: 100 }, profile);
  assert.equal(report.independentObservations, 2);
  assert.ok(report.featureEvidence > report.evidence);
  assert.equal(report.evidence, 2);
  assert.ok(report.confidence < 0.4);
}

// A partial-history position begins at that position, with no invented moves.
{
  const game = play(new Chess(), 'e2e4', 'e7e5');
  game.historyStack = [];
  const before = snapshot(game);
  const profile = armxPreviewSyncProfile(game, game.side);
  assert.equal(profile.replay.fastPositionKey(), game.fastPositionKey());
  assert.equal(profile.opponentMoves, 0);
  review(game);
  assert.equal(snapshot(game), before);
}

console.log('ARMX_CONTRACT passed: per-round reset, side isolation, undo, opening exclusion, attribution, evidence, board purity');
