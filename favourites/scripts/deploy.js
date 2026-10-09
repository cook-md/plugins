// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. an editor worktree).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.favourites');

// Skips test specs and source maps, which the packaged plugin doesn't need.
const skipTestArtifacts = src => !/\.spec\.js$|\.map$/.test(src);

const required = ['package.json', 'out', 'media', 'LICENSE'];
const optional = ['README.md'];

for (const entry of required) {
    if (!fs.existsSync(path.join(root, entry))) {
        throw new Error(`Missing ${entry}${entry === 'out' ? '; run npm run compile first' : ''}`);
    }
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of [...required, ...optional]) {
    if (!fs.existsSync(path.join(root, entry))) {
        continue;
    }
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, filter: skipTestArtifacts });
}
console.log(`Deployed to ${target}`);
