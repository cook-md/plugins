import type { FromWebview, ToWebview, ViewState } from '../protocol';
import { displayCategories, recipeRows } from '../view-model';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
let pantryExpanded = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

function renderRecipes(state: ViewState): HTMLElement | undefined {
    if (state.items.length === 0) {
        // With an error (e.g. an unreadable .shopping-list) the error block explains the empty list.
        return state.error
            ? undefined
            : element('div', 'empty', 'No recipes yet. Add recipes from the preview, the explorer, or the editor title bar.');
    }
    const section = element('div', 'recipes');
    const header = element('div', 'recipes-header');
    header.append(element('span', 'section-title', 'Selected Recipes'));
    const clear = element('button', 'clear', 'Clear All');
    clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    header.append(clear);
    section.append(header);
    for (const row of recipeRows(state.items)) {
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
        const remove = element('button', 'remove', '×');
        remove.title = 'Remove from shopping list';
        remove.addEventListener('click', () => vscode.postMessage({ type: 'remove', index: row.index }));
        line.append(main, scale, remove);
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
            const label = element('label', isChecked ? 'ingredient checked' : 'ingredient');
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
        toggle.addEventListener('click', () => { pantryExpanded = !pantryExpanded; render(state); });
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
    if (!state.hasWorkspace) {
        root.replaceChildren(element('div', 'empty', 'Open a recipe folder to use the shopping list.'));
        return;
    }
    const recipes = renderRecipes(state);
    const result = renderResult(state);
    // Errors come first so they are visible whether or not any recipes are listed.
    root.replaceChildren(...(state.error ? [...result, ...(recipes ? [recipes] : [])] : [...(recipes ? [recipes] : []), ...result]));
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    if (event.data?.type === 'state') {
        render(event.data.state);
    }
});
vscode.postMessage({ type: 'ready' });
