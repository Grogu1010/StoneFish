// Developer-menu registration only for Stonefish v5.5 testunit1 variants.
// Neither variant is added to the normal opponent selector. Round-robin games run
// in test-worker.js so ARMX-on vs ARMX-off can be compared directly.

models.v55test1noarmx = {
  name: 'Stonefish_v5.5 testunit1 (No ARMX)',
  trait: 'Development-only v5.5 control build',
  subtitle: 'The native v5.5 Guarded-PVS engine with the exact same search and evaluation stack, but ARMX-preview completely disabled.',
  logic: [
    'Use Stonefish_v5 Pro chess knowledge and evaluation',
    'Rank candidates with the native v5.5 fast safety layer',
    'Search the two finalists with v5.5 Guarded PVS',
    'Do not call ARMX-preview at any point'
  ],
  getMove: null
};

models.v55test1 = {
  name: 'Stonefish_v5.5 testunit1 (ARMX-preview)',
  trait: 'Development-only v5.5 + ARMX-preview test unit',
  subtitle: 'The native v5.5 Guarded-PVS engine with ARMX-preview auditing missed opponent replies before the final decision.',
  logic: [
    'Use Stonefish_v5 Pro chess knowledge and evaluation',
    'Rank candidates with the native v5.5 fast safety layer',
    'Ask the separate ARMX-preview model to inspect replies outside the host beam',
    'Inject ARMX’s critical reply into v5.5 Guarded PVS before choosing the move'
  ],
  getMove: null
};
