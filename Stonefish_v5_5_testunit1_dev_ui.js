// Developer-menu registration only for Stonefish v5.5 testunit1.
// This does not add v5.5 to the normal opponent selector and does not run ARMX
// on the main UI thread. Round-robin games execute the model inside test-worker.js.

models.v55test1 = {
  name: 'Stonefish_v5.5 testunit1',
  trait: 'Development-only v5 + ARMX-preview test unit',
  subtitle: 'Stonefish_v5 unchanged, with ARMX-preview available only in developer round-robin tests.',
  logic: [
    'Use Stonefish_v5 as the unchanged base engine',
    'Ask ARMX-preview to review only the strongest v5 candidates',
    'Use a 3-ply ARMX base with a selective 4-ply forcing extension',
    'Keep ARMX under a hard node budget for low test latency'
  ],
  getMove: null
};
