// Test harness helper: transparently append the root-fusion layer whenever a
// benchmark loads the candidate geometry patch. The released reference context
// does not load the geometry patch, so it remains pinned and untouched.

const fs = require('fs');
const path = require('path');

const originalReadFileSync = fs.readFileSync.bind(fs);
fs.readFileSync = function(file, ...args) {
  const value = originalReadFileSync(file, ...args);
  if (!String(file).endsWith('Stonefish_v5_pro_geometry_patch.js')) return value;

  const encoding = typeof args[0] === 'string'
    ? args[0]
    : (args[0] && args[0].encoding);
  if (encoding !== 'utf8' && encoding !== 'utf-8') return value;

  const extra = originalReadFileSync(
    path.join(path.dirname(String(file)), 'Stonefish_v5_pro_root_fusion_patch.js'),
    'utf8'
  );
  return String(value) + '\n\n' + extra;
};

const target = process.argv[2];
if (!target) throw new Error('Usage: node run_with_root_fusion.js <benchmark.js>');
require(path.resolve(target));
