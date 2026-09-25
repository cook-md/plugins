import * as vscode from 'vscode';
import { HubFileSystemCore, HubFsEntryType, HubFsError } from './hub-file-system-core';

/**
 * Read-only `cooklang-hub:` file system. Theia bridges plugin file systems into
 * its FileService, so the standard recipe preview can load Recipe Hub recipes.
 */
export class HubFileSystemProvider implements vscode.FileSystemProvider {

    protected readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    /** Hub recipes do not change under an open preview; nothing fires. */
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.onDidChangeFileEmitter.event;

    constructor(protected readonly core: HubFileSystemCore) { }

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return this.translate(uri, async () => {
            const stat = await this.core.stat(corePath(uri));
            return { type: fileType(stat.type), ctime: 0, mtime: 0, size: stat.size };
        });
    }

    readDirectory(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
        return this.translate(uri, async () =>
            this.core.readDirectory(corePath(uri)).map(([name, type]): [string, vscode.FileType] => [name, fileType(type)]));
    }

    readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return this.translate(uri, () => this.core.readFile(corePath(uri)));
    }

    createDirectory(uri: vscode.Uri): Promise<void> {
        return this.translate(uri, async () => this.core.denyWrite(corePath(uri)));
    }

    writeFile(uri: vscode.Uri): Promise<void> {
        return this.translate(uri, async () => this.core.denyWrite(corePath(uri)));
    }

    delete(uri: vscode.Uri): Promise<void> {
        return this.translate(uri, async () => this.core.denyWrite(corePath(uri)));
    }

    rename(oldUri: vscode.Uri): Promise<void> {
        return this.translate(oldUri, async () => this.core.denyWrite(corePath(oldUri)));
    }

    dispose(): void {
        this.onDidChangeFileEmitter.dispose();
    }

    protected async translate<T>(uri: vscode.Uri, action: () => Promise<T>): Promise<T> {
        try {
            return await action();
        } catch (e) {
            if (e instanceof HubFsError) {
                switch (e.code) {
                    case 'FileNotFound': throw vscode.FileSystemError.FileNotFound(uri);
                    case 'NoPermissions': throw vscode.FileSystemError.NoPermissions(e.message);
                    case 'Unavailable': throw vscode.FileSystemError.Unavailable(e.message);
                }
            }
            throw e;
        }
    }
}

/** The core expects '/'-rooted paths; a scheme-only URI has an empty path, which means the root. */
function corePath(uri: vscode.Uri): string {
    return uri.path === '' ? '/' : uri.path;
}

function fileType(type: HubFsEntryType): vscode.FileType {
    return type === 'file' ? vscode.FileType.File : vscode.FileType.Directory;
}
