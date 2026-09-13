// Developer-menu registration only for Stonefish v5.5 testunit1 variants.
// Neither variant is added to the normal opponent selector. Round-robin games run
// in test-worker.js so ARMX-on vs ARMX-off can be compared directly.

models.v55test1noarmx = {
  name: 'Stonefish_v5.5 testunit1 (No ARMX)',
  trait: 'Development-only v5.5 control build',
  subtitle: 'Native v5.5 Guarded-PVS with Refutation Guard, but with the separate ARMX-preview opponent model completely disabled.',
  logic: [
    'Use Stonefish_v5 Pro chess knowledge and evaluation',
    'Search four root finalists with native v5.5 Guarded PVS',
    'Use Refutation Guard to verify suspicious opponent replies through v5.5’s search horizon',
    'Do not call ARMX-preview at any point'
  ],
  getMove: null
};

models.v55test1 = {
  name: 'Stonefish_v5.5 testunit1 (ARMX-preview)',
  trait: 'Development-only v5.5 + ARMX-preview test unit',
  subtitle: 'The same native v5.5 host plus a separate per-game ARMX-preview model that learns the current opponent’s tendencies and adjusts close candidate scores.',
  logic: [
    'Use the exact same v5.5 Guarded-PVS + Refutation Guard host as the No-ARMX control',
    'ARMX-preview observes what the opponent tends to choose when options are available',
    'ARMX tracks whether exchanges and move types have helped or hurt against this opponent during the current game',
    'Apply only bounded evidence-based candidate multipliers; reset the ARMX profile every game'
  ],
  getMove: null
};
