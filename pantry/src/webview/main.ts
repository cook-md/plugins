import type { PantryItem } from '../cooklang-api';
import type { FromWebview, ToWebview, ViewState } from '../protocol';
import {
    EditDraft, ItemStatus, PantryFilter, addAttributes, changedFields, daysUntil, defaultAddSection, displayQuantity, expiryLabel,
    initialDraft, itemStatus, sectionChoices, todayIso, visibleSections,
} from '../view-model';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const FILTERS: Array<[PantryFilter, string]> = [['all', 'All'], ['low', 'Low'], ['out', 'Out of stock'], ['expiring', 'Expiring']];
const STATUS_LABELS: Record<ItemStatus, string> = {
    expired: 'Expired', out: 'Out of stock', low: 'Low stock', expiring: 'Expiring soon', ok: 'In stock',
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let state: ViewState | undefined;
let search = '';
let filter: PantryFilter = 'all';
const collapsed = new Set<string>();
/** `base` is the draft as the form opened; saving sends only what differs from it. */
let editing: { section: string; name: string; base: EditDraft; draft: EditDraft } | undefined;
let adding: ({ section: string; name: string } & EditDraft) | undefined;
/** `pantry.addItem` arrived before the pantry was loaded; open the add form once it is. */
let wantAdd = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

/**
 * A labelled input; date fields fall back to text when the stored value is not ISO.
 * `key` becomes `data-field`, used to restore focus after the list is rebuilt.
 */
function field(key: string, label: string, value: string, kind: 'text' | 'date', onInput: (value: string) => void, placeholder = ''): HTMLLabelElement {
    const wrapper = element('label', 'field');
    wrapper.append(element('span', 'field-label', label));
    const input = element('input');
    input.dataset.field = key;
    input.type = kind === 'date' && (value === '' || ISO_DATE.test(value)) ? 'date' : 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener('input', () => onInput(input.value));
    wrapper.append(input);
    return wrapper;
}

/** The quantity, low and date inputs shared by the add and edit forms. */
function draftFields(draft: EditDraft): HTMLElement {
    const grid = element('div', 'grid');
    grid.append(
        field('quantity', 'Quantity', draft.quantity, 'text', value => { draft.quantity = value; }, 'e.g. 500 g'),
        field('low', 'Low at', draft.low, 'text', value => { draft.low = value; }, 'e.g. 100 g'),
        field('bought', 'Bought', draft.bought, 'date', value => { draft.bought = value; }),
        field('expire', 'Expires', draft.expire, 'date', value => { draft.expire = value; }),
    );
    return grid;
}

/** Enter in an input submits (buttons keep their own Enter, IME composition is left alone); Escape cancels. */
function keys(form: HTMLElement, submit: () => void, cancel: () => void): void {
    form.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.isComposing) {
            event.preventDefault();
            submit();
        }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
}

// --- persistent parts (kept across renders so the search box keeps focus) ---

const banner = element('div');
const body = element('div');
const toolbar = element('div', 'toolbar');
const addContainer = element('div');
const list = element('div', 'sections');
const chips = new Map<PantryFilter, HTMLButtonElement>();

const searchInput = element('input', 'search');
searchInput.type = 'search';
searchInput.placeholder = 'Search pantry';
searchInput.addEventListener('input', () => { search = searchInput.value; renderList(); });
const chipRow = element('div', 'chips');
for (const [value, label] of FILTERS) {
    const chip = button('chip', label, () => { filter = value; updateChips(); renderList(); });
    chips.set(value, chip);
    chipRow.append(chip);
}
const toolbarRow = element('div', 'toolbar-row');
toolbarRow.append(searchInput, button('primary', 'Add', () => openAddForm()));
toolbar.append(toolbarRow, chipRow);
updateChips();
root.append(banner, body);

function updateChips(): void {
    chips.forEach((chip, value) => chip.classList.toggle('active', value === filter));
}

// --- rendering ---

function render(): void {
    renderBanner();
    if (!state) {
        body.replaceChildren();
        return;
    }
    switch (state.status) {
        case 'unsupported':
            body.replaceChildren(element('div', 'empty', 'This version of Cook Editor does not support the Pantry plugin. Please update Cook Editor.'));
            return;
        case 'noWorkspace':
            body.replaceChildren(element('div', 'empty', 'Open a folder to use the pantry.'));
            return;
        case 'loading':
            body.replaceChildren();
            return;
        case 'noFile': {
            const box = element('div', 'empty');
            box.append(element('p', undefined, 'No pantry yet. Your pantry lives in config/pantry.conf, shared with CookCLI and the shopping list.'));
            box.append(button('primary', 'Create pantry', () => vscode.postMessage({ type: 'create' })));
            body.replaceChildren(box);
            return;
        }
        case 'parseError': {
            const box = element('div', 'error');
            box.append(element('p', undefined, `config/pantry.conf could not be read: ${state.parseError ?? ''}`));
            box.append(button('secondary', 'Open file', () => vscode.postMessage({ type: 'openFile' })));
            body.replaceChildren(box);
            return;
        }
        case 'loaded':
            if (!body.contains(toolbar)) {
                body.replaceChildren(toolbar, addContainer, list);
            }
            // An open add form is only rebuilt when it opens or closes, so typing is never interrupted.
            if (!adding || !addContainer.firstChild) {
                renderAddForm();
            }
            renderList();
            return;
    }
}

function renderBanner(): void {
    if (!state?.editError) {
        banner.replaceChildren();
        return;
    }
    const box = element('div', 'banner');
    box.append(element('span', undefined, state.editError));
    const close = button('icon', '×', () => vscode.postMessage({ type: 'dismissError' }));
    close.title = 'Dismiss';
    box.append(close);
    banner.replaceChildren(box);
}

function openAddForm(): void {
    if (state?.status !== 'loaded') {
        return;
    }
    if (!adding) {
        adding = { section: defaultAddSection(sectionChoices(state.sections)), name: '', quantity: '', low: '', bought: '', expire: '' };
        renderAddForm();
    }
    addContainer.querySelector<HTMLInputElement>('.name-field input')?.focus();
}

function renderAddForm(): void {
    if (!adding || state?.status !== 'loaded') {
        addContainer.replaceChildren();
        return;
    }
    const draft = adding;
    const form = element('div', 'form add-form');
    form.append(element('div', 'form-title', 'Add item'));

    const sectionField = field('section', 'Section', draft.section, 'text', value => { draft.section = value; });
    const options = element('datalist');
    options.id = 'pantry-sections';
    for (const name of sectionChoices(state.sections)) {
        const option = element('option');
        option.value = name;
        options.append(option);
    }
    sectionField.querySelector('input')!.setAttribute('list', options.id);
    const nameField = field('name', 'Name', draft.name, 'text', value => { draft.name = value; }, 'e.g. milk');
    nameField.classList.add('name-field');
    const grid = draftFields(draft);

    const submit = (): void => {
        const section = draft.section.trim();
        const name = draft.name.trim();
        if (!section || !name) {
            form.classList.add('invalid');
            return;
        }
        vscode.postMessage({ type: 'add', section, name, attributes: addAttributes(draft) });
        adding = undefined;
        renderAddForm();
    };
    const cancel = (): void => { adding = undefined; renderAddForm(); };
    const actions = element('div', 'actions');
    actions.append(button('primary', 'Add', submit), button('secondary', 'Cancel', cancel));
    form.append(sectionField, options, nameField, grid, actions);
    keys(form, submit, cancel);
    addContainer.replaceChildren(form);
}

function renderList(): void {
    if (state?.status !== 'loaded') {
        return;
    }
    if (state.sections.length === 0) {
        list.replaceChildren(element('div', 'empty', 'Your pantry is empty. Use Add to stock it.'));
        return;
    }
    const today = todayIso(new Date());
    const views = visibleSections(state.sections, search, filter, today);
    if (views.length === 0) {
        list.replaceChildren(element('div', 'empty', 'No items match.'));
        return;
    }
    const narrowing = search.trim() !== '' || filter !== 'all';
    // Remember which edit-form input had focus so the rebuilt form gets it back.
    const active = document.activeElement;
    const focusedField = active instanceof HTMLInputElement && list.contains(active) ? active.dataset.field : undefined;
    list.replaceChildren(...views.map(view => {
        const section = element('div', 'section');
        const isCollapsed = collapsed.has(view.name) && !narrowing;
        const count = narrowing ? `${view.items.length}/${view.total}` : String(view.total);
        const header = button('section-header', `${isCollapsed ? '▶' : '▼'} ${view.name}`, () => {
            if (narrowing) {
                return; // sections are always expanded while searching or filtering
            }
            if (collapsed.has(view.name)) { collapsed.delete(view.name); } else { collapsed.add(view.name); }
            renderList();
        });
        header.append(element('span', 'count', count));
        section.append(header);
        if (!isCollapsed) {
            view.items.forEach(item => section.append(itemRow(view.name, item, today)));
        }
        return section;
    }));
    if (focusedField) {
        list.querySelector<HTMLInputElement>(`.item.editing input[data-field="${focusedField}"]`)?.focus();
    }
}

function itemRow(section: string, item: PantryItem, today: string): HTMLElement {
    const status = itemStatus(item, today);
    const row = element('div', 'item');
    const head = button('item-head', '', () => {
        const base = initialDraft(item);
        editing = isEditing(section, item) ? undefined : { section, name: item.name, base, draft: { ...base } };
        renderList();
        list.querySelector<HTMLInputElement>('.item.editing input')?.focus();
    });
    const dot = element('span', `dot ${status}`);
    dot.title = STATUS_LABELS[status];
    head.append(dot, element('span', 'item-name', item.name));
    if (item.quantity) {
        head.append(element('span', 'item-qty', displayQuantity(item.quantity)));
    }
    if (item.expireDate) {
        head.append(element('span', `badge ${status}`, expiryLabel(daysUntil(item.expireDate, today))));
    }
    row.append(head);
    if (editing && isEditing(section, item)) {
        row.classList.add('editing');
        row.append(editForm(section, item, editing.base, editing.draft));
    }
    return row;
}

function isEditing(section: string, item: PantryItem): boolean {
    return editing?.section === section && editing.name === item.name;
}

function editForm(section: string, item: PantryItem, base: EditDraft, draft: EditDraft): HTMLElement {
    const form = element('div', 'form');
    const grid = draftFields(draft);
    const close = (): void => { editing = undefined; renderList(); };
    const save = (): void => {
        const fields = changedFields(base, draft);
        if (Object.keys(fields).length > 0) {
            vscode.postMessage({ type: 'update', section, name: item.name, fields });
        }
        close();
    };
    const actions = element('div', 'actions');
    actions.append(
        button('primary', 'Save', save),
        button('secondary', 'Cancel', close),
        // The form stays open until the removal lands (the next state drops it) or the confirmation is cancelled.
        button('danger', 'Delete', () => vscode.postMessage({ type: 'remove', section, name: item.name })),
    );
    form.append(grid, actions);
    keys(form, save, close);
    return form;
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    const message = event.data;
    if (message?.type === 'state') {
        state = message.state;
        // Drop the edit form if its item is gone (removed here or edited outside).
        if (editing && !state.sections.some(s => s.name === editing!.section && s.items.some(i => i.name === editing!.name))) {
            editing = undefined;
        }
        render();
        if (wantAdd && state.status === 'loaded') {
            wantAdd = false;
            openAddForm();
        }
    } else if (message?.type === 'showAdd') {
        if (state?.status === 'loaded') {
            openAddForm();
        } else {
            wantAdd = true;
        }
    }
});
vscode.postMessage({ type: 'ready' });
