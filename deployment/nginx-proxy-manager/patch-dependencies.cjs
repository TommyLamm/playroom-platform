const fs = require('node:fs');
const path = require('node:path');

const fixes = new Map([
  ['basic-ftp', '6.2.1'],
  ['brace-expansion', '5.0.12'],
  ['fast-uri', '3.1.8'],
  ['ip-address', '10.7.4'],
  ['proxy-addr', '2.0.8'],
  ['undici', '6.28.1'],
]);
const affected = new Map([
  ['basic-ftp', '5.3.1'],
  ['brace-expansion', '5.0.9'],
  ['fast-uri', '3.1.7'],
  ['ip-address', '10.5.0'],
  ['proxy-addr', '2.0.7'],
  ['undici', '6.28.0'],
]);
const replaced = new Map();
function patchModules(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      patchModules(target);
      continue;
    }
    const manifest = path.join(target, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const installed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (fixes.has(installed.name) && installed.version === affected.get(installed.name)) {
      const source = path.join('/security-deps/node_modules', installed.name);
      const replacement = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
      if (replacement.version !== fixes.get(installed.name)) {
        throw new Error('Unexpected replacement version for ' + installed.name);
      }
      // Each replacement includes its nested dependencies. Native packages elsewhere remain intact.
      fs.rmSync(target, { recursive: true });
      fs.cpSync(source, target, { recursive: true });
      replaced.set(installed.name, (replaced.get(installed.name) || 0) + 1);
      console.log(installed.name + ': ' + installed.version + ' -> ' + replacement.version);
      continue;
    }
    const nested = path.join(target, 'node_modules');
    if (fs.existsSync(nested)) patchModules(nested);
  }
}
patchModules('/app/node_modules');
for (const name of fixes.keys()) {
  if (!replaced.has(name)) throw new Error('Expected dependency was not found: ' + name);
}
