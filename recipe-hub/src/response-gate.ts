// Coordinates which async responses are still current for the search panel,
// free of `vscode` so it can be unit-tested directly. search-view-provider.ts
// uses it to decide whether a search or facets response should still be
// posted to the webview, or is stale and should be dropped.

import { HubError } from './hub-client';

export class ResponseGate {

    /** Sequence number of the newest seq-numbered request (e.g. a search); responses to older ones are dropped. */
    protected latestSeq = 0;
    /**
     * Bumped by `restart()` (the webview reloaded, or sent `ready` again). The
     * restarted webview counts `seq` from 1 again, so a response from before
     * the restart could otherwise match a new request's `seq`.
     */
    protected generation = 0;

    /** The webview (re)started: every response in flight before this point is now stale. */
    restart(): void {
        this.latestSeq = 0;
        this.generation += 1;
    }

    /**
     * A new seq-numbered request (e.g. a search) started. Returns a function
     * that reports whether its response is still current: only while `seq` is
     * still the newest one, and the generation has not changed.
     */
    startRequest(seq: number): () => boolean {
        this.latestSeq = seq;
        const generation = this.generation;
        return () => seq === this.latestSeq && generation === this.generation;
    }

    /**
     * A new request without its own seq (e.g. facets) started. Returns a
     * function that reports whether its response is still current: only while
     * the generation has not changed.
     */
    startGenerationRequest(): () => boolean {
        const generation = this.generation;
        return () => generation === this.generation;
    }
}

/** Any failure as a `HubError`, mapping anything that is not already one to the `network` kind. */
export function asHubError(e: unknown): HubError {
    return e instanceof HubError ? e : new HubError('network', e instanceof Error ? e.message : String(e));
}
