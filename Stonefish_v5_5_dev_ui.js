// Developer-only registration for the Stonefish v5.5 No-ARMX control.
// This control intentionally stays out of the normal opponent selector.

models.v55noarmx = {
  name: 'Stonefish_v5.5 (No ARMX)',
  trait: 'Developer-only v5.5 control build',
  subtitle: 'The final native v5.5 host with ARMX disabled, retained only for controlled development comparisons.',
  logic: [
    'Use the same native v5.5 host as the released model',
    'Consider every legal root move with native PVS',
    'Resolve captures before evaluating a position and keep exact finalist scores',
    'Do not call ARMX at any point'
  ],
  getMove: null
};
