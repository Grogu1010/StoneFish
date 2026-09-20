// Developer-menu registration only for Stonefish v5.5 testunit1 variants.
// Neither variant is added to the normal opponent selector. Round-robin games run
// in test-worker.js so ARMX-on vs ARMX-off can be compared directly.

models.v55test1noarmx = {
  name: '5.5(testunit1) (no ARMX)',
  trait: 'Development-only v5.5 control build',
  subtitle: 'Native v5.5 search with the separate ARMX-preview opponent model disabled.',
  logic: [
    'Evaluate material, piece placement, pawn structure and king safety',
    'Consider every legal root move with native PVS',
    'Resolve captures before evaluating a position and keep exact finalist scores',
    'Do not call ARMX-preview at any point'
  ],
  getMove: null
};

models.v55test1 = {
  name: '5.5(testunit1)',
  trait: 'Development-only v5.5 + ARMX-preview test unit',
  subtitle: 'The same native v5.5 host plus ARMX-preview, which learns reply preferences during the current game to guide search and compare close moves.',
  logic: [
    'Use the exact same native v5.5 host as the No-ARMX control',
    'ARMX-preview observes what the opponent tends to choose when options are available',
    'ARMX tracks whether exchanges and move types have helped or hurt against this opponent during the current game',
    'Learn quiet-reply preferences and spend more effort when predictions miss',
    'Compare close moves with bounded evidence-based multipliers; reset all notes every game'
  ],
  getMove: null
};
