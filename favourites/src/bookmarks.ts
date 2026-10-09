// Pure edits of the `.bookmarks` text: one workspace-relative recipe path per
// line, `#` comments, blank lines. Free of the `vscode` import so it can be
// unit-tested. Comments, blank lines and the order of untouched lines survive
// every edit; output always uses LF and ends with a newline (or is empty).

/** Trims, turns `\` into `/` and drops leading `./` segments. */
export function normalizePath(raw: string): string {
    let path = raw.trim().replace(/\\/g, '/');
    while (path.startsWith('./')) {
        path = path.slice(2);
    }
    return path;
}

/** The favourite a line names, or `undefined` for blank and comment lines. */
function entryOf(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
        return undefined;
    }
    return normalizePath(trimmed);
}

function splitLines(text: string): string[] {
    if (text === '') {
        return [];
    }
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function joinLines(lines: readonly string[]): string {
    return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

/** Drops later lines naming a favourite an earlier line already names. */
function dedupe(lines: readonly string[]): string[] {
    const seen = new Set<string>();
    return lines.filter(line => {
        const entry = entryOf(line);
        if (entry === undefined) {
            return true;
        }
        if (seen.has(entry)) {
            return false;
        }
        seen.add(entry);
        return true;
    });
}

function folderPrefix(dir: string): string {
    const folder = normalizePath(dir).replace(/\/+$/, '');
    return folder === '' ? '' : folder + '/';
}

/** Whether a path names a recipe (`.cook`, any case). */
export function isRecipePath(path: string): boolean {
    return /\.cook$/i.test(path);
}

/** The favourites the text lists, normalised, in file order, without duplicates. */
export function parse(text: string): string[] {
    const out: string[] = [];
    for (const line of dedupe(splitLines(text))) {
        const entry = entryOf(line);
        if (entry !== undefined) {
            out.push(entry);
        }
    }
    return out;
}

/** Appends `path` as the last line unless it is already listed. */
export function add(text: string, path: string): string {
    const entry = normalizePath(path);
    if (parse(text).includes(entry)) {
        return text;
    }
    return joinLines([...splitLines(text), entry]);
}

/** Deletes every line naming `path`. */
export function remove(text: string, path: string): string {
    const entry = normalizePath(path);
    return joinLines(splitLines(text).filter(line => entryOf(line) !== entry));
}

/** Rewrites the line naming `from` to `to`, dropping duplicates. */
export function rename(text: string, from: string, to: string): string {
    const source = normalizePath(from);
    const target = normalizePath(to);
    return joinLines(dedupe(splitLines(text).map(line => entryOf(line) === source ? target : line)));
}

/** Rewrites every favourite under `fromDir/` to live under `toDir/`; `toDir` may be `''` (the workspace root). */
export function renamePrefix(text: string, fromDir: string, toDir: string): string {
    const source = folderPrefix(fromDir);
    const target = folderPrefix(toDir);
    return joinLines(dedupe(splitLines(text).map(line => {
        const entry = entryOf(line);
        return entry !== undefined && entry.startsWith(source) ? target + entry.slice(source.length) : line;
    })));
}

/** Drops every favourite under `dir/`. */
export function removePrefix(text: string, dir: string): string {
    const source = folderPrefix(dir);
    return joinLines(splitLines(text).filter(line => {
        const entry = entryOf(line);
        return entry === undefined || !entry.startsWith(source);
    }));
}
