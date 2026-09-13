// Compatibility redirect only.
// The actual separate opponent-adaptation model lives in ARMX-preview.js.
// Keep this shim temporarily for older benchmark loaders while they migrate.

if (typeof importScripts === 'function') {
  importScripts('./ARMX-preview.js');
} else if (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
  const fs = process.getBuiltinModule('fs');
  const vm = process.getBuiltinModule('vm');
  vm.runInThisContext(fs.readFileSync('ARMX-preview.js', 'utf8'), { filename: 'ARMX-preview.js' });
} else {
  throw new Error('ARMX-preview compatibility loader could not load ARMX-preview.js');
}
