import { buildCheckSpec } from './check-spec';
import { CooklangApi } from './cooklang-api';
import { ReadText, isMenuUri, isPreviewContext } from './provider';
import { parseServings } from './servings';
import { CoreVitalsSettings } from './settings';
import { buildTemplate } from './vitals-template';

/** Tab title of the report; `cooklang.api.openReport` reuses the tab for the same uri and label. */
export const REPORT_LABEL = 'Core Vitals';

function isCooklangUri(uri: string): boolean {
    return /\.(cook|menu)$/i.test(uri.replace(/[?#].*$/, ''));
}

/**
 * The recipe or menu URI a `cooklang.corevitals.openReport` invocation refers to:
 * the preview toolbars pass a `PreviewOutletContext`, `editor/title` passes the
 * resource `Uri`, the palette passes nothing (use the active editor). Undefined
 * when none of them names a `.cook` or `.menu`.
 */
export function uriFromArgument(argument: unknown, activeEditorUri: string | undefined): string | undefined {
    if (isPreviewContext(argument)) {
        return argument.uri;
    }
    if (typeof argument === 'object' && argument !== null) {
        const candidate = argument as { scheme?: unknown; toString?: unknown };
        if (typeof candidate.scheme === 'string' && typeof candidate.toString === 'function') {
            const uri = String(candidate.toString());
            return isCooklangUri(uri) ? uri : undefined;
        }
    }
    return activeEditorUri !== undefined && isCooklangUri(activeEditorUri) ? activeEditorUri : undefined;
}

/** Backs `cooklang.corevitals.openReport`. */
export class OpenReportCommand {

    constructor(
        protected readonly api: CooklangApi,
        protected readonly settings: () => CoreVitalsSettings,
        protected readonly readText: ReadText,
    ) { }

    /** Opens the report tab; false when the editor lacks `cooklang.api.openReport`. */
    async open(uri: string): Promise<boolean> {
        const isMenu = isMenuUri(uri);
        const parsedServings = isMenu ? undefined : parseServings(await this.readText(uri) ?? '');
        const spec = buildCheckSpec(this.settings(), parsedServings ?? 1, isMenu || parsedServings !== undefined);
        const template = buildTemplate(spec, 'html');
        return this.api.openReport({ uri, template, label: REPORT_LABEL, outputFormat: 'html', scale: 1 });
    }
}
