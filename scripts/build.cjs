const { mkdirSync, cpSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['index.html', 'style.css', 'icon.svg', 'src/core.js', 'src/samples.js', 'src/app.js', 'LICENSE', 'README.md'];
mkdirSync(path.join(root, 'dist'), { recursive: true });
const manifest = [];
for (const file of files) {
  const target = path.join(root, 'dist', file);
  mkdirSync(path.dirname(target), { recursive: true }); cpSync(path.join(root, file), target);
  manifest.push({ file, sha256: createHash('sha256').update(readFileSync(target)).digest('hex') });
}
writeFileSync(path.join(root, 'dist', 'manifest.json'), JSON.stringify({ product: 'Rowglass', version: '1.0.0', files: manifest }, null, 2) + '\n');
console.log(`Rowglass 1.0.0 ready in dist/ (${files.length} files, no runtime dependencies).`);
