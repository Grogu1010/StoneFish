// Developer-menu registration only for Stonefish v5.5 testunit1.
// This does not add v5.5 to the normal opponent selector. Round-robin games execute
// v5 Pro + ARMX-preview inside test-worker.js.

models.v55test1 = {
  name: 'Stonefish_v5.5 testunit1',
  trait: 'Development-only v5 Pro + ARMX-preview test unit',
  subtitle: 'Stonefish_v5 Pro unchanged as the base engine, with ARMX-preview providing a separate broad 3/4-ply second opinion.',
  logic: [
    'Run Stonefish_v5 Pro normally first',
    'Send Pro’s candidate set to the separate ARMX-preview model',
    'Let ARMX search more broadly at 3 ply with selective 4-ply danger extensions',
    'Allow ARMX to overturn Pro only when its independent line is clearly better'
  ],
  getMove: null
};
