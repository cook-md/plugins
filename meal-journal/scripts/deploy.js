// Copies the built plugin to ../../editor/plugins/cooklang.meal-journal,
// where the Cook Editor app picks it up on start (see app's copy:plugins script).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.resolve(root, '../../editor/plugins/cooklang.meal-journal');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'out', 'snippets']) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true });
}
console.log(`Deployed to ${target}`);
