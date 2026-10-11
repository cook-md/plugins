/**
 * Caches whether the running Cook Editor has the commands this plugin needs.
 * Only `true` is cached (for good); `false` and a thrown error both count as
 * unsupported but are re-checked on the next call, so a transient failure at
 * startup can't disable the plugin for the whole session. Concurrent callers
 * share one round trip.
 */
export class SupportCheck {

    protected supported = false;
    protected pending: Promise<boolean> | undefined;

    constructor(protected readonly check: () => Promise<boolean>) { }

    isSupported(): Promise<boolean> {
        if (this.supported) {
            return Promise.resolve(true);
        }
        this.pending ??= this.check()
            .catch(() => false)
            .then(result => {
                this.supported = result;
                return result;
            })
            .finally(() => { this.pending = undefined; });
        return this.pending;
    }
}
