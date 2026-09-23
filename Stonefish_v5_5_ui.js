// Public registration for the final Stonefish v5.5 release.

models.v55 = {
  name: 'Stonefish_v5.5',
  trait: 'Native PVS + ARMX adaptive engine',
  subtitle: 'The final Stonefish 5.5 model: native PVS search, capture quiescence, Refutation Guard, and per-game ARMX opponent adaptation.',
  logic: [
    'Evaluate material, piece placement, pawn structure and king safety',
    'Consider every legal root move with native PVS',
    'Resolve captures before evaluating a position and keep exact finalist scores',
    'Use Refutation Guard to verify dangerous legal replies outside the normal reply beam',
    'Learn opponent reply preferences during the current game with bounded ARMX adjustments'
  ],
  getMove: getStonefishV55Move
};

selectedModel = 'v55';
modelSelect.value = 'v55';
updateModelUI();
resetGame();
