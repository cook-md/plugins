import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';

/**
 * Caches whether the running Cook Editor supports the report commands this plugin
 * needs. Every open recipe preview polls its badge provider roughly every 500 ms;
 * without caching, an editor that genuinely lacks the API would pay for
 * `api.version()` plus `api.supportsReports()` (which enumerates every registered
 * command) on each poll. `true` is cached forever. `false` is cached too, but only
 * for `recheckMs`, so a user who updates their editor without restarting it is
 * picked up eventually. Any thrown error counts as unsupported.
 */
export class SupportCheck {

    protected supported: boolean | undefined;
    protected lastCheckedAt: number | undefined;
    protected unsupportedWarningPending = false;

    constructor(
        protected readonly api: CooklangApi,
        protected readonly now: () => number = Date.now,
        protected readonly recheckMs = 30000,
    ) { }

    async isSupported(): Promise<boolean> {
        if (this.supported === true) {
            return true;
        }
        const nowMs = this.now();
        if (this.supported === false && this.lastCheckedAt !== undefined && nowMs - this.lastCheckedAt < this.recheckMs) {
            return false;
        }
        const isFirstCheck = this.supported === undefined;
        this.lastCheckedAt = nowMs;
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
