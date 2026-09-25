// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. an editor worktree).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.recipe-hub');

const required = ['package.json', 'out', 'media'];
const optional = ['README.md', 'LICENSE'];

const missing = required.filter(entry => !fs.existsSync(path.join(root, entry)));
if (missing.length > 0) {
    console.error(`Cannot deploy: missing ${missing.join(', ')} (run npm run compile first).`);
    process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of [...required, ...optional]) {
    const source = path.join(root, entry);
    if (!fs.existsSync(source)) {
        console.log(`Skipping ${entry} (not present).`);
        continue;
    }
    fs.cpSync(source, path.join(target, entry), { recursive: true });
}
console.log(`Deployed to ${target}`);
