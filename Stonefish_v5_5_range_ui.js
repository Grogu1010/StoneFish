// Developer registration for the Full ARMX v5.5 range.
// Keep these out of the public opponent selector until the launch gate passes.

models.v55athena = {
  name: 'Stonefish_v5.5 Athena',
  trait: 'Full ARMX · extreme defense',
  subtitle: 'A defensive Full-ARMX v5.5 that preserves tension, protects its king and learns which defensive answers frustrate this opponent.',
  logic: [
    'Use the same native PVS engine and evaluation as the v5.5 range',
    'Run Full ARMX with per-game opponent learning and adaptive search effort',
    'Prefer defensive, tension-preserving finalists when native scores permit',
    'Never override mate-scale truth or large native score gaps',
    'Reset all opponent notes every game'
  ],
  getMove: getStonefishV55AthenaMove
};

models.v55ares = {
  name: 'Stonefish_v5.5 Ares',
  trait: 'Full ARMX · extreme aggression',
  subtitle: 'An aggressive Full-ARMX v5.5 that seeks forcing contact and learns which forms of pressure this opponent handles poorly.',
  logic: [
    'Use the same native PVS engine and evaluation as the v5.5 range',
    'Run Full ARMX with per-game opponent learning and adaptive search effort',
    'Prefer checks, king pressure, captures and forward forcing play when native scores permit',
    'Never override mate-scale truth or large native score gaps',
    'Reset all opponent notes every game'
  ],
  getMove: getStonefishV55AresMove
};

models.v55artemis = {
  name: 'Stonefish_v5.5 Artemis',
  trait: 'Full ARMX · balanced',
  subtitle: 'The neutral Full-ARMX reference: no style prior, only stronger opponent adaptation and evidence-driven search effort.',
  logic: [
    'Use the same native PVS engine and evaluation as Athena and Ares',
    'Run Full ARMX with per-game opponent learning and adaptive search effort',
    'Apply no defensive or aggressive style prior',
    'Use learned opponent evidence only within protected native-search bounds',
    'Reset all opponent notes every game'
  ],
  getMove: getStonefishV55ArtemisMove
};

// Rolling best-known test units. Keep these on the current saved range version;
// when a stronger version is promoted, update the model getter and this label
// together so Dev Test always runs the latest best-known Athena/Ares/Artemis.
models.v55athenatestunit = {
  ...models.v55athena,
  name: 'v5.5 Athena (testunit)',
  trait: 'Rolling best-known Full ARMX · Athena'
};

models.v55arestestunit = {
  ...models.v55ares,
  name: 'v5.5 Ares (testunit)',
  trait: 'Rolling best-known Full ARMX · Ares'
};

models.v55artemistestunit = {
  ...models.v55artemis,
  name: 'v5.5 Artemis (testunit)',
  trait: 'Rolling best-known Full ARMX · Artemis'
};
