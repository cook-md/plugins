import type { Facets, HubErrorKind, RecipeCard } from '../hub-client';
import { isDisplayableImageUrl } from '../hub-urls';
import type { FromWebview, ToWebview } from '../protocol';
import {
    activeFilterCount, addTerm, clearFilters, emptyFilters, MAX_LIST_VALUES, MAX_TIME_PRESETS, orderServings, parseFilters,
    resolveDefaultLocale, SearchFilters, SortOrder,
} from '../search-query';

interface SavedState {
    filters: SearchFilters;
    filtersOpen: boolean;
    /** The user picked a language, so facets no longer adjust the default. */
    localeTouched: boolean;
}

declare function acquireVsCodeApi(): {
    postMessage(message: FromWebview): void;
    getState(): unknown;
    setState(state: SavedState): void;
};

type InitMessage = Extract<ToWebview, { type: 'init' }>;
type ResultsMessage = Extract<ToWebview, { type: 'results' }>;
type ErrorMessage = Extract<ToWebview, { type: 'error' }>;

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
const SEARCH_DEBOUNCE_MS = 300;
const FALLBACK_DIFFICULTIES = ['easy', 'medium', 'hard'];

function readSavedState(): SavedState | undefined {
    const raw = vscode.getState() as { filters?: unknown; filtersOpen?: unknown; localeTouched?: unknown } | undefined;
    const filters = parseFilters(raw?.filters);
    return filters ? { filters, filtersOpen: raw?.filtersOpen === true, localeTouched: raw?.localeTouched === true } : undefined;
}

const saved = readSavedState();
let filters: SearchFilters = saved?.filters ?? emptyFilters();
let filtersOpen = saved?.filtersOpen ?? false;
let localeTouched = saved?.localeTouched ?? false;
/** False until the first `init` when nothing was saved: the default language is not known before it. */
let initialized = saved !== undefined;
let defaultLocale = '';
let serverOrigin = '';
let facets: Facets | undefined;

let seq = 0;
let loading = false;
/** Page of the newest request (1 = new search, >1 = "Load more"). */
let requestedPage = 1;
let cards: RecipeCard[] = [];
let total = 0;
let page = 0;
let hasMore = false;
let searched = false;
let error: { kind: HubErrorKind; message: string } | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

// --- DOM helpers ---

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

function button(className: string, text: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

/** The server rejects lists longer than this, so the UI stops adding at the cap. */
function isFull(list: readonly string[]): boolean {
    return list.length >= MAX_LIST_VALUES;
}

const FULL_PLACEHOLDER = `Up to ${MAX_LIST_VALUES}`;

function termInput(placeholder: string, current: () => readonly string[], onAdd: (term: string) => void): HTMLInputElement {
    const input = element('input', 'term-input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.dataset.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing && input.value.trim() !== '' && !isFull(current())) {
            onAdd(input.value);
            input.value = '';
        }
    });
    return input;
}

/** Disables a term input once its list is at the cap. */
function syncTermInput(input: HTMLInputElement, list: readonly string[]): void {
    const full = isFull(list);
    input.disabled = full;
    input.placeholder = full ? FULL_PLACEHOLDER : input.dataset.placeholder ?? '';
}

function servingsInput(placeholder: string, onChange: (value: number | undefined) => void): HTMLInputElement {
    const input = element('input', 'servings-input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', `${placeholder} servings`);
    input.addEventListener('change', () => {
        const value = Number(input.value);
        onChange(input.value !== '' && Number.isInteger(value) && value > 0 ? value : undefined);
    });
    return input;
}

function filterRow(label: string, ...controls: HTMLElement[]): HTMLElement {
    const row = element('div', 'filter-row');
    row.append(element('div', 'filter-label', label), ...controls);
    return row;
}

function fillSelect(select: HTMLSelectElement, options: ReadonlyArray<readonly [string, string]>, value: string): void {
    select.replaceChildren(...options.map(([optionValue, label]) => {
        const option = element('option', undefined, label);
        option.value = optionValue;
        return option;
    }));
    select.value = value;
}

function renderChips(container: HTMLElement, values: readonly string[], onRemove: (value: string) => void, className = 'chip'): void {
    container.replaceChildren(...values.map(value => {
        const chip = element('span', className, value);
        const remove = button('chip-remove', '×', () => onRemove(value));
        remove.title = `Remove ${value}`;
        remove.setAttribute('aria-label', `Remove ${value}`);
        chip.append(remove);
        return chip;
    }));
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatMinutes(minutes: number): string {
    if (minutes < 60) {
        return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// --- Controls (built once; syncControls writes the filter state into them) ---

const searchBox = element('input', 'search-box');
searchBox.type = 'search';
searchBox.placeholder = 'Search recipes, e.g. pasta or tags:vegan';
searchBox.setAttribute('aria-label', 'Search recipes');
searchBox.addEventListener('input', () => setFilters({ ...filters, q: searchBox.value }));
searchBox.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { searchNow(); }
});

const queryError = element('div', 'query-error');
const filtersToggle = button('filters-toggle', 'Filters', () => {
    filtersOpen = !filtersOpen;
    saveState();
    syncControls();
});
const clearLink = button('link', 'Clear filters', () => clearAllFilters());

const tagSelect = element('select', 'tag-select');
tagSelect.setAttribute('aria-label', 'Add a tag');
tagSelect.addEventListener('change', () => {
    if (tagSelect.value !== '' && !isFull(filters.tags)) {
        setFilters({ ...filters, tags: addTerm(filters.tags, tagSelect.value) });
    }
});
const tagInput = termInput('Type a tag', () => filters.tags, term => setFilters({ ...filters, tags: addTerm(filters.tags, term) }));
const tagChips = element('div', 'chips');

const includeInput = termInput('Add an ingredient to include', () => filters.includeIngredients, term =>
    setFilters({ ...filters, includeIngredients: addTerm(filters.includeIngredients, term) }));
const includeChips = element('div', 'chips');
const excludeInput = termInput('Add an ingredient to exclude', () => filters.excludeIngredients, term =>
    setFilters({ ...filters, excludeIngredients: addTerm(filters.excludeIngredients, term) }));
const excludeChips = element('div', 'chips');

const timeButtons = element('div', 'segmented');
for (const minutes of [...MAX_TIME_PRESETS, undefined]) {
    const option = button('segment', minutes === undefined ? 'Any' : `≤ ${minutes} min`, () => setFilters({ ...filters, maxTime: minutes }));
    option.dataset.minutes = minutes === undefined ? '' : String(minutes);
    timeButtons.append(option);
}

const difficultySelect = element('select');
difficultySelect.setAttribute('aria-label', 'Difficulty');
difficultySelect.addEventListener('change', () =>
    setFilters({ ...filters, difficulty: difficultySelect.value === '' ? undefined : difficultySelect.value }));

const minServings = servingsInput('Min', value => setFilters({ ...filters, minServings: value }));
const maxServings = servingsInput('Max', value => setFilters({ ...filters, maxServings: value }));
const servingsRange = element('div', 'range');
servingsRange.append(minServings, element('span', 'range-separator', '–'), maxServings);

const localeSelect = element('select');
localeSelect.setAttribute('aria-label', 'Language');
localeSelect.addEventListener('change', () => {
    localeTouched = true;
    setFilters({ ...filters, locale: localeSelect.value });
});

const sortSelect = element('select');
sortSelect.setAttribute('aria-label', 'Sort');
fillSelect(sortSelect, [['relevance', 'Relevance'], ['newest', 'Newest']], 'relevance');
sortSelect.addEventListener('change', () => setFilters({ ...filters, sort: sortSelect.value as SortOrder }));

const feedChip = element('div', 'chips');
const feedRow = filterRow('Feed', feedChip);

const filtersPanel = element('div', 'filters');
filtersPanel.append(
    filterRow('Tags', tagSelect, tagInput, tagChips),
    filterRow('With ingredients', includeInput, includeChips),
    filterRow('Without ingredients', excludeInput, excludeChips),
    filterRow('Max time', timeButtons),
    filterRow('Difficulty', difficultySelect),
    filterRow('Servings', servingsRange),
    filterRow('Language', localeSelect),
    filterRow('Sort', sortSelect),
    feedRow,
);

const resultsHeader = element('div', 'results-header');
const resultsList = element('div', 'results');
const resultsFooter = element('div', 'results-footer');

// --- State → controls ---

function syncControls(): void {
    if (searchBox.value !== filters.q) {
        searchBox.value = filters.q;
    }
    const count = activeFilterCount(filters, defaultFilterLocale());
    const arrow = element('span', 'filters-arrow', filtersOpen ? '▼' : '▶');
    arrow.setAttribute('aria-hidden', 'true');
    filtersToggle.replaceChildren(arrow, ` Filters${count > 0 ? ` (${count})` : ''}`);
    filtersToggle.setAttribute('aria-expanded', String(filtersOpen));
    filtersPanel.hidden = !filtersOpen;
    clearLink.hidden = count === 0;

    const tagOptions = (facets?.tags ?? [])
        .filter(tag => !filters.tags.includes(tag.name.toLowerCase()))
        .map(tag => [tag.name, `${tag.name} (${tag.count})`] as const);
    const tagsFull = isFull(filters.tags);
    const tagPrompt = tagsFull ? FULL_PLACEHOLDER : tagOptions.length > 0 ? 'Add a tag…' : 'No tag list available';
    fillSelect(tagSelect, [['', tagPrompt], ...(tagsFull ? [] : tagOptions)], '');
    tagSelect.disabled = tagsFull || tagOptions.length === 0;
    syncTermInput(tagInput, filters.tags);
    syncTermInput(includeInput, filters.includeIngredients);
    syncTermInput(excludeInput, filters.excludeIngredients);
    renderChips(tagChips, filters.tags, tag => setFilters({ ...filters, tags: filters.tags.filter(item => item !== tag) }));
    renderChips(includeChips, filters.includeIngredients, name =>
        setFilters({ ...filters, includeIngredients: filters.includeIngredients.filter(item => item !== name) }));
    renderChips(excludeChips, filters.excludeIngredients, name =>
        setFilters({ ...filters, excludeIngredients: filters.excludeIngredients.filter(item => item !== name) }), 'chip exclude');

    const activeMinutes = filters.maxTime === undefined ? '' : String(filters.maxTime);
    for (const option of Array.from(timeButtons.children) as HTMLElement[]) {
        option.classList.toggle('active', option.dataset.minutes === activeMinutes);
    }

    const difficulties = facets && facets.difficulties.length > 0
        ? facets.difficulties.map(item => item.name.toLowerCase())
        : FALLBACK_DIFFICULTIES;
    const difficultyValues = filters.difficulty !== undefined && !difficulties.includes(filters.difficulty)
        ? [...difficulties, filters.difficulty]
        : difficulties;
    fillSelect(difficultySelect, [['', 'Any'], ...difficultyValues.map(name => [name, capitalize(name)] as const)], filters.difficulty ?? '');

    minServings.value = filters.minServings === undefined ? '' : String(filters.minServings);
    maxServings.value = filters.maxServings === undefined ? '' : String(filters.maxServings);

    const locales = (facets?.locales ?? []).map(locale => [locale.code, locale.name] as const);
    const localeOptions = filters.locale !== '' && !locales.some(([code]) => code === filters.locale)
        ? [...locales, [filters.locale, filters.locale] as const]
        : locales;
    fillSelect(localeSelect, [['', 'Any language'], ...localeOptions], filters.locale);

    sortSelect.value = filters.sort;

    feedRow.hidden = filters.feed === undefined;
    renderChips(feedChip, filters.feed ? [filters.feed.title] : [], () => setFilters({ ...filters, feed: undefined }));
}

function saveState(): void {
    vscode.setState({ filters, filtersOpen, localeTouched });
}

/** The language a fresh panel searches: the display language, or any if the index has none in it. */
function defaultFilterLocale(): string {
    return resolveDefaultLocale(defaultLocale, facets?.locales);
}

function setFilters(next: SearchFilters): void {
    filters = orderServings(next);
    saveState();
    syncControls();
    scheduleSearch();
}

function clearAllFilters(): void {
    localeTouched = false;
    filters = clearFilters(filters, defaultFilterLocale());
    saveState();
    syncControls();
    searchNow();
}

// --- Searching ---

function scheduleSearch(): void {
    if (debounce !== undefined) {
        clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
        debounce = undefined;
        runSearch(1);
    }, SEARCH_DEBOUNCE_MS);
}

function searchNow(): void {
    if (debounce !== undefined) {
        clearTimeout(debounce);
        debounce = undefined;
    }
    runSearch(1);
}

function runSearch(pageToLoad: number): void {
    seq += 1;
    requestedPage = pageToLoad;
    loading = true;
    error = undefined;
    vscode.postMessage({ type: 'search', seq, page: pageToLoad, filters });
    renderResults();
}

function onResults(message: ResultsMessage): void {
    if (message.seq !== seq) {
        return;
    }
    loading = false;
    searched = true;
    if (message.page > 1) {
        // The index can shift between pages; don't show a recipe twice.
        const shown = new Set(cards.map(card => card.id));
        cards = [...cards, ...message.cards.filter(card => !shown.has(card.id))];
    } else {
        cards = message.cards;
    }
    total = message.total;
    page = message.page;
    hasMore = message.hasMore;
    renderResults();
}

function onError(message: ErrorMessage): void {
    if (message.seq !== seq) {
        return;
    }
    loading = false;
    error = { kind: message.kind, message: message.message };
    if (requestedPage === 1) {
        cards = [];
        total = 0;
        hasMore = false;
    }
    renderResults();
}

// --- Results rendering ---

function errorBlock(kind: HubErrorKind, message: string): HTMLElement {
    const block = element('div', 'error');
    const text = kind === 'network' ? 'Could not reach Recipe Hub.'
        : kind === 'rateLimited' ? 'Too many searches — try again shortly.'
            : message;
    block.append(element('div', undefined, text));
    if (kind === 'network') {
        block.append(element('div', 'error-detail', message));
    }
    block.append(button('retry', 'Retry', () => runSearch(requestedPage)));
    return block;
}

function headerContent(): HTMLElement[] {
    const firstPage = requestedPage === 1;
    if (loading && firstPage) {
        return [element('div', 'status', 'Searching…')];
    }
    if (error && firstPage) {
        // A bad query is explained under the search box.
        return error.kind === 'badQuery' ? [] : [errorBlock(error.kind, error.message)];
    }
    if (!searched) {
        return [];
    }
    if (total === 0) {
        const empty = element('div', 'empty', 'No recipes match your search.');
        if (activeFilterCount(filters, defaultFilterLocale()) > 0) {
            empty.append(' ', button('link', 'Clear filters', () => clearAllFilters()));
        }
        return [empty];
    }
    return [element('div', 'count', `${total} ${total === 1 ? 'recipe' : 'recipes'}`)];
}

function footerContent(): HTMLElement[] {
    const firstPage = requestedPage === 1;
    if (loading && !firstPage) {
        return [element('div', 'status', 'Loading more…')];
    }
    if (error && !firstPage) {
        return [errorBlock(error.kind, error.message)];
    }
    if (!loading && hasMore) {
        return [button('load-more', 'Load more', () => runSearch(page + 1))];
    }
    return [];
}

function renderCard(card: RecipeCard): HTMLElement {
    const node = element('div', 'card');
    const open = (): void => vscode.postMessage({ type: 'open', id: card.id, title: card.title });
    // The title button is the keyboard and screen-reader target; clicking anywhere else on the card is a mouse convenience.
    node.addEventListener('click', open);

    if (card.imageUrl !== undefined && isDisplayableImageUrl(card.imageUrl, serverOrigin)) {
        const image = element('img', 'thumb');
        image.src = card.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        // Third-party hosts don't need to learn where their thumbnails are shown.
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.replaceWith(element('div', 'thumb')));
        node.append(image);
    } else {
        node.append(element('div', 'thumb'));
    }

    const body = element('div', 'card-body');
    const title = button('card-title', card.title, event => {
        event.stopPropagation();
        open();
    });
    title.title = `Preview ${card.title}`;
    body.append(title);
    if (card.summary !== undefined) {
        body.append(element('div', 'card-summary', card.summary));
    }
    const meta = element('div', 'card-meta');
    if (card.totalTimeMinutes !== undefined) {
        meta.append(element('span', undefined, formatMinutes(card.totalTimeMinutes)));
    }
    if (card.servings !== undefined) {
        meta.append(element('span', undefined, `${card.servings} ${card.servings === 1 ? 'serving' : 'servings'}`));
    }
    const feed = card.feed;
    if (feed?.title !== undefined) {
        const feedTitle = feed.title;
        const feedLink = button('link', feedTitle, event => {
            event.stopPropagation();
            setFilters({ ...filters, feed: { id: feed.id, title: feedTitle } });
        });
        feedLink.title = `Only recipes from ${feedTitle}`;
        meta.append(feedLink);
    }
    if (meta.childElementCount > 0) {
        body.append(meta);
    }
    if (card.tags.length > 0) {
        const tags = element('div', 'card-tags');
        for (const tag of card.tags.slice(0, 3)) {
            const chip = button('tag', tag, event => {
                event.stopPropagation();
                if (!isFull(filters.tags)) {
                    setFilters({ ...filters, tags: addTerm(filters.tags, tag) });
                }
            });
            chip.title = `Only recipes tagged ${tag}`;
            tags.append(chip);
        }
        body.append(tags);
    }
    node.append(body);
    return node;
}

function renderResults(): void {
    const badQuery = error?.kind === 'badQuery' ? error.message : undefined;
    queryError.textContent = badQuery ?? '';
    queryError.hidden = badQuery === undefined;
    resultsList.classList.toggle('stale', loading && requestedPage === 1);
    resultsHeader.replaceChildren(...headerContent());
    resultsList.replaceChildren(...cards.map(renderCard));
    resultsFooter.replaceChildren(...footerContent());
}

// --- Messages from the extension host ---

function onInit(message: InitMessage): void {
    defaultLocale = message.defaultLocale;
    serverOrigin = message.serverOrigin;
    if (!initialized) {
        initialized = true;
        filters = emptyFilters(defaultLocale);
        saveState();
    }
    syncControls();
    searchNow();
}

function onFacets(next: Facets): void {
    facets = next;
    // The display language is only a default: with no recipes in it, search every language.
    if (!localeTouched && filters.locale !== '' && filters.locale === defaultLocale) {
        const resolved = resolveDefaultLocale(defaultLocale, next.locales);
        if (resolved !== filters.locale) {
            filters = { ...filters, locale: resolved };
            saveState();
            syncControls();
            searchNow();
            return;
        }
    }
    syncControls();
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    const message = event.data;
    if (!message) {
        return;
    }
    switch (message.type) {
        case 'init': onInit(message); break;
        case 'facets': onFacets(message.facets); break;
        case 'results': onResults(message); break;
        case 'error': onError(message); break;
        case 'focusSearch': searchBox.focus(); break;
    }
});

const searchRow = element('div', 'search-row');
searchRow.append(searchBox);
const filtersBar = element('div', 'filters-bar');
filtersBar.append(filtersToggle, clearLink);
root.append(searchRow, queryError, filtersBar, filtersPanel, resultsHeader, resultsList, resultsFooter);
syncControls();
renderResults();
vscode.postMessage({ type: 'ready' });
