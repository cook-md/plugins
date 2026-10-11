import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';

/**
 * Caches whether the running Cook Editor supports the report commands this plugin
 * needs. Badge refreshes aren't polled on a timer — each visible preview is
 * debounced and re-checks on recipe edits, scale changes, subscription changes,
 * and command/menu changes. Without caching, an editor that genuinely lacks the
 * API would still pay for `api.version()` plus `api.supportsReports()` (which
 * enumerates every registered command) on every one of those refreshes. `true`
 * is cached forever. `false` is cached too, but only for `recheckMs`, so a user
 * who updates their editor without restarting it is picked up eventually. Any
 * thrown error counts as unsupported.
 */
export class SupportCheck {

    protected supported: boolean | undefined;
    protected lastCheckedAt: number | undefined;
    protected unsupportedWarningPending = false;
    /** Set synchronously before any `await`, so concurrent callers (several open previews
     * polling at startup) share one API round trip instead of each starting their own. */
    protected pending: Promise<boolean> | undefined;

    constructor(
        protected readonly api: CooklangApi,
        protected readonly now: () => number = Date.now,
        protected readonly recheckMs = 30000,
    ) { }

    isSupported(): Promise<boolean> {
        if (this.supported === true) {
            return Promise.resolve(true);
        }
        const nowMs = this.now();
        if (this.supported === false && this.lastCheckedAt !== undefined && nowMs - this.lastCheckedAt < this.recheckMs) {
            return Promise.resolve(false);
        }
        if (this.pending) {
            return this.pending;
        }
        this.lastCheckedAt = nowMs;
        this.pending = this.check().finally(() => { this.pending = undefined; });
        return this.pending;
    }

    protected async check(): Promise<boolean> {
        const isFirstCheck = this.supported === undefined;
        try {
            this.supported = await this.api.version() === SUPPORTED_API_VERSION && await this.api.supportsReports();
        } catch {
            this.supported = false;
        }
        if (!this.supported && isFirstCheck) {
            this.unsupportedWarningPending = true;
        }
        return this.supported;
    }

    /** True exactly once: the first time `isSupported()` ever resolved to false. */
    consumeFirstUnsupportedWarning(): boolean {
        const pending = this.unsupportedWarningPending;
        this.unsupportedWarningPending = false;
        return pending;
    }
}
