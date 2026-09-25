// URL helpers shared by the extension host and the webview bundle. No `vscode` import.

/** `serverUrl` without surrounding whitespace or trailing slashes. */
export function trimServerUrl(serverUrl: string): string {
    return serverUrl.trim().replace(/\/+$/, '');
}

/** `value` as a normalised http(s) URL; undefined for anything else. */
export function httpUrl(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    try {
        const url = new URL(value.trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

/** Origin of the configured server, for the webview CSP and thumbnail checks. */
export function serverOrigin(serverUrl: string): string | undefined {
    const url = httpUrl(trimServerUrl(serverUrl));
    return url === undefined ? undefined : new URL(url).origin;
}

/**
 * The server to talk to: the configured URL, trimmed, when it is http(s);
 * otherwise `fallback`. Nothing downstream (client, CSP, links) sees other schemes.
 */
export function effectiveServerUrl(configured: string | undefined, fallback: string): string {
    const trimmed = trimServerUrl(configured ?? '');
    return serverOrigin(trimmed) === undefined ? fallback : trimmed;
}

/** CSP `img-src` for the panel: any https image, plus the server origin when it is plain http. */
export function imageSources(serverUrl: string): string {
    const origin = serverOrigin(serverUrl);
    return origin !== undefined && origin.startsWith('http:') ? `https: ${origin}` : 'https:';
}

/** The recipe's page on the Recipe Hub website. */
export function hubRecipePageUrl(serverUrl: string, id: number): string {
    return `${trimServerUrl(serverUrl)}/recipes/${id}`;
}

/**
 * Where "Open Original Recipe" goes and what a draft's `source:` records: the
 * recipe's own page when it has an http(s) `source_url`, else its Recipe Hub page.
 */
export function originalRecipeUrl(sourceUrl: string | undefined, serverUrl: string, id: number): string {
    return httpUrl(sourceUrl) ?? hubRecipePageUrl(serverUrl, id);
}

/** Card thumbnails: any https image, or one from the configured server (plain http in development). */
export function isDisplayableImageUrl(url: string, origin: string): boolean {
    const valid = httpUrl(url);
    if (valid === undefined) {
        return false;
    }
    const parsed = new URL(valid);
    return parsed.protocol === 'https:' || (origin !== '' && parsed.origin === origin);
}
