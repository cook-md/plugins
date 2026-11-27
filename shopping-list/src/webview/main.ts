import { displayQuantity, recognizeLine, splitPastedText } from '../free-hand';
import type { FreeHandRef, FromWebview, ToWebview, ViewState } from '../protocol';
import { displayCategories, freeHandRows, recipeRows } from '../view-model';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const vscode = acquireVsCodeApi();
/** Re-rendered on every state; the composer lives outside it so typing survives updates. */
const root = document.getElementById('root')!;
const composer = document.getElementById('composer')!;

/** How long rows just added stay highlighted. */
const HIGHLIGHT_MS = 2000;

let lastState: ViewState | undefined;
let pantryExpanded = false;
/** The free-hand line being edited in place, and the text typed so far. */
let editing: { ref: FreeHandRef; draft: string } | undefined;
/** Lower-cased names of rows to highlight, until `highlightTimer` fires. */
let highlighted = new Set<string>();
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
let scrollToHighlight = false;
/** Lines from a multi-line paste, waiting for "Add items". */
let pasted: string[] = [];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

function iconButton(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = element('button', `icon-button ${className}`, text);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', onClick);
    return button;
}

function sameRef(a: FreeHandRef, b: FreeHandRef): boolean {
    return a.index === b.index && a.name === b.name && a.quantity === b.quantity;
}

// ── Composer: quick add and paste preview ───────────────────────────────────

const form = element('form', 'composer-form');
const input = element('input', 'composer-input');
input.type = 'text';
input.placeholder = 'Add an item, e.g. Milk 2 l';
input.setAttribute('aria-label', 'Add an item to the shopping list');
input.maxLength = 500;
const chip = element('span', 'quantity-chip');
const addButton = element('button', 'composer-add', 'Add');
addButton.type = 'submit';
form.append(input, chip, addButton);
const preview = element('div', 'paste-preview');
composer.append(form, preview);

function updateChip(): void {
    const quantity = displayQuantity(recognizeLine(input.value)?.quantity);
    chip.textContent = quantity;
    chip.hidden = quantity === '';
    addButton.disabled = input.value.trim() === '';
}

function sendLines(lines: string[]): void {
    if (lines.length > 0) {
        vscode.postMessage({ type: 'addItems', lines });
    }
}

form.addEventListener('submit', event => {
    event.preventDefault();
    sendLines(input.value.trim() === '' ? [] : [input.value]);
    input.value = '';
    updateChip();
});
input.addEventListener('input', updateChip);
input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        input.value = '';
        updateChip();
    }
});
input.addEventListener('paste', event => {
    const lines = splitPastedText(event.clipboardData?.getData('text/plain') ?? '');
    if (lines.length > 1) {
        event.preventDefault();
        pasted = lines;
        renderPreview();
    }
});

function renderPreview(): void {
    preview.hidden = pasted.length === 0;
    if (pasted.length === 0) {
        preview.replaceChildren();
        return;
    }
    const list = element('ul', 'paste-list');
    pasted.forEach((line, index) => {
        const recognized = recognizeLine(line);
        const row = element('li', 'paste-row');
        row.append(
            iconButton('paste-drop', '×', `Leave out ${line}`, () => { pasted.splice(index, 1); renderPreview(); }),
            element('span', 'item-name', recognized?.name ?? line),
        );
        const quantity = displayQuantity(recognized?.quantity);
        if (quantity) { row.append(element('span', 'quantity-chip', quantity)); }
        list.append(row);
    });
    const actions = element('div', 'paste-actions');
    const add = element('button', 'primary', pasted.length === 1 ? 'Add 1 item' : `Add ${pasted.length} items`);
    add.type = 'button';
    add.addEventListener('click', () => { sendLines(pasted); pasted = []; renderPreview(); input.focus(); });
    const cancel = element('button', 'secondary', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { pasted = []; renderPreview(); input.focus(); });
    actions.append(add, cancel);
    preview.replaceChildren(list, actions);
}

// ── List ─────────────────────────────────────────────────────────────────────

function renderToolbar(state: ViewState): HTMLElement | undefined {
    if (state.items.length === 0) {
        return undefined;
    }
    const bar = element('div', 'toolbar');
    const clear = element('button', 'clear', 'Clear All');
    clear.type = 'button';
    clear.title = 'Remove every recipe and item from the shopping list';
    clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    bar.append(clear);
    return bar;
}

function renderRecipes(state: ViewState): HTMLElement | undefined {
    const rows = recipeRows(state.items);
    if (rows.length === 0) {
        return undefined;
    }
    const section = element('div', 'recipes');
    section.append(element('h3', 'section-title', 'Selected Recipes'));
    for (const row of rows) {
        const line = element('div', 'recipe-row');
        const main = element('div', 'recipe-main');
        main.append(element('span', 'recipe-name', row.name));
        if (row.detail) { main.append(element('span', 'recipe-detail', row.detail)); }
        const scale = element('input', 'scale');
        scale.type = 'number';
        scale.min = '0.5';
        scale.max = '100';
        scale.step = '0.5';
        scale.value = String(row.scale);
        scale.title = 'Scale factor';
        scale.addEventListener('change', () => {
            const value = parseFloat(scale.value);
            if (Number.isFinite(value) && value > 0) {
                vscode.postMessage({ type: 'scale', index: row.index, scale: value });
            }
        });
        line.append(main, scale, iconButton('remove', '×', 'Remove from shopping list', () => vscode.postMessage({ type: 'remove', index: row.index })));
        section.append(line);
    }
    return section;
}

/** The free-hand lines, editable: what the iOS app calls "Other items". */
function renderFreeHand(state: ViewState): HTMLElement | undefined {
    const rows = freeHandRows(state.items);
    if (editing && !rows.some(row => sameRef(row.ref, editing!.ref))) {
        editing = undefined;
    }
    if (rows.length === 0) {
        return undefined;
    }
    const section = element('div', 'free-hand');
    const header = element('div', 'section-header');
    header.append(
        element('h3', 'section-title', 'Other Items'),
        iconButton('remove-all', 'Remove all', 'Remove all other items (recipes stay)', () => vscode.postMessage({ type: 'removeAllItems' })),
    );
    section.append(header);
    for (const row of rows) {
        const line = element('div', highlighted.has(row.ref.name.toLowerCase()) ? 'free-hand-row just-added' : 'free-hand-row');
        if (editing && sameRef(editing.ref, row.ref)) {
            const current = editing;
            const edit = element('input', 'edit-input');
            edit.type = 'text';
            edit.maxLength = 500;
            edit.value = current.draft;
            edit.setAttribute('aria-label', `Edit ${row.ref.name}`);
            const save = (): void => {
                editing = undefined;
                vscode.postMessage({ type: 'editItem', item: current.ref, line: edit.value });
            };
            edit.addEventListener('input', () => { current.draft = edit.value; });
            edit.addEventListener('keydown', event => {
                if (event.key === 'Enter') { event.preventDefault(); save(); }
                if (event.key === 'Escape') { editing = undefined; rerender(); }
            });
            line.append(edit, iconButton('save', '✓', 'Save', save));
            section.append(line);
            // Re-rendering replaced the old box; keep the caret where the user was typing.
            queueMicrotask(() => { edit.focus(); edit.setSelectionRange(edit.value.length, edit.value.length); });
            continue;
        }
        const label = element('span', 'item-name', row.ref.name);
        label.title = 'Double-click to edit';
        const startEdit = (): void => {
            editing = { ref: row.ref, draft: row.quantity ? `${row.ref.name} ${row.quantity}` : row.ref.name };
            rerender();
        };
        label.addEventListener('dblclick', startEdit);
        line.append(label);
        if (row.quantity) { line.append(element('span', 'ingredient-qty', row.quantity)); }
        line.append(
            iconButton('edit', '✎', `Edit ${row.ref.name}`, startEdit),
            iconButton('remove', '×', `Remove ${row.ref.name}`, () => vscode.postMessage({ type: 'removeItem', item: row.ref })),
        );
        section.append(line);
    }
    return section;
}

function renderResult(state: ViewState): HTMLElement[] {
    if (state.error) {
        // The store's unreadable-list message is already a full sentence; generation errors are raw.
        const text = state.error.startsWith('Could not read') ? state.error : `Could not build the list: ${state.error}`;
        return [element('div', 'error', text)];
    }
    if (!state.result) {
        return [];
    }
    const checked = new Set(state.checked);
    const nodes: HTMLElement[] = [];
    for (const category of displayCategories(state.result)) {
        const block = element('div', 'category');
        block.append(element('h3', 'section-title', category.name));
        for (const item of category.items) {
            const isChecked = checked.has(item.name.toLowerCase());
            const classes = ['ingredient'];
            if (isChecked) { classes.push('checked'); }
            if (highlighted.has(item.name.toLowerCase())) { classes.push('just-added'); }
            const label = element('label', classes.join(' '));
            const box = element('input');
            box.type = 'checkbox';
            box.checked = isChecked;
            box.addEventListener('change', () => vscode.postMessage({ type: 'toggle', name: item.name }));
            label.append(box, element('span', 'ingredient-name', item.name));
            if (item.quantities) { label.append(element('span', 'ingredient-qty', item.quantities)); }
            block.append(label);
        }
        nodes.push(block);
    }
    if (state.result.pantryItems.length > 0) {
        const pantry = element('div', 'pantry');
        const toggle = element('button', 'pantry-toggle', `${pantryExpanded ? '▼' : '▶'} In Pantry (${state.result.pantryItems.length})`);
        toggle.type = 'button';
        toggle.addEventListener('click', () => { pantryExpanded = !pantryExpanded; rerender(); });
        pantry.append(toggle);
        if (pantryExpanded) {
            const list = element('ul', 'pantry-list');
            state.result.pantryItems.forEach(name => list.append(element('li', undefined, name)));
            pantry.append(list);
        }
        nodes.push(pantry);
    }
    return nodes;
}

function render(state: ViewState): void {
    lastState = state;
    composer.hidden = !state.hasWorkspace;
    if (!state.hasWorkspace) {
        root.replaceChildren(element('div', 'empty', 'Open a recipe folder to use the shopping list.'));
        return;
    }
    const result = renderResult(state);
    const parts = [renderToolbar(state), renderRecipes(state), renderFreeHand(state)].filter((node): node is HTMLElement => node !== undefined);
    if (state.items.length === 0 && !state.error) {
        parts.push(element('div', 'empty', 'Your shopping list is empty. Type an item above, or add recipes from the preview, the explorer, or the editor title bar.'));
    }
    // Errors come first so they are visible whether or not anything is listed.
    root.replaceChildren(...(state.error ? [...result, ...parts] : [...parts, ...result]));
    if (scrollToHighlight) {
        scrollToHighlight = false;
        root.querySelector('.just-added')?.scrollIntoView({ block: 'nearest' });
    }
}

function rerender(): void {
    if (lastState) {
        render(lastState);
    }
}

function highlight(names: readonly string[]): void {
    highlighted = new Set(names.map(name => name.toLowerCase()));
    scrollToHighlight = true;
    if (highlightTimer !== undefined) {
        clearTimeout(highlightTimer);
    }
    highlightTimer = setTimeout(() => {
        highlightTimer = undefined;
        highlighted = new Set();
        rerender();
    }, HIGHLIGHT_MS);
    rerender();
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    if (event.data?.type === 'state') {
        render(event.data.state);
    } else if (event.data?.type === 'added') {
        highlight(event.data.names);
    }
});
composer.hidden = true;
updateChip();
renderPreview();
vscode.postMessage({ type: 'ready' });
