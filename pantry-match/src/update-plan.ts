// The decisions of the controller's update(), free of `vscode` so they can be tested.
export type ViewState = 'noWorkspace' | 'unsupported' | 'noPantry' | 'pantryError' | 'indexing' | 'empty' | 'ready';

/** The state to show instead of doing any work, when the plugin can't run at all. */
export function blockedState(hasFolder: boolean, supported: boolean): ViewState | undefined {
    if (!hasFolder) {
        return 'noWorkspace';
    }
    return supported ? undefined : 'unsupported';
}

export type UpdatePlan =
    | { action: 'show-empty'; state: ViewState; pantryMessage: boolean }
    | { action: 'idle' }
    | { action: 'scan'; announceIndexing: boolean };

/**
 * What to do once the pantry has been loaded. The workspace is only scanned after the
 * view was shown; "indexing" is announced only when there is nothing to show yet, so the
 * welcome text doesn't flicker on every incremental refresh.
 */
export function planUpdate(pantry: 'missing' | 'error' | 'ok', viewed: boolean, indexEmpty: boolean): UpdatePlan {
    if (pantry === 'missing') {
        return { action: 'show-empty', state: 'noPantry', pantryMessage: false };
    }
    if (pantry === 'error') {
        return { action: 'show-empty', state: 'pantryError', pantryMessage: true };
    }
    return viewed ? { action: 'scan', announceIndexing: indexEmpty } : { action: 'idle' };
}

export function resultState(modelIsEmpty: boolean): ViewState {
    return modelIsEmpty ? 'empty' : 'ready';
}
