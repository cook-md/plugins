// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. an editor worktree).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.nutriscore');

// Skips test specs and source maps, which the packaged plugin doesn't need.
const skipTestArtifacts = src => !/\.spec\.js$|\.map$/.test(src);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'out', 'README.md', 'LICENSE']) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, filter: skipTestArtifacts });
}
console.log(`Deployed to ${target}`);
