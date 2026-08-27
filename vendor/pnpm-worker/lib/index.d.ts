import { PnpmError } from '@pnpm/error';
import { type PackageFilesIndex } from '@pnpm/store.cafs';
import { type DependencyManifest } from '@pnpm/types';
import { type TarballExtractMessage, type AddDirToStoreMessage, type LinkPkgMessage, type SymlinkAllModulesMessage } from './types.js';
export declare function restartWorkerPool(): Promise<void>;
export declare function finishWorkers(): Promise<void>;
export declare function calcMaxWorkers(): number;
interface AddFilesResult {
    filesIndex: Record<string, string>;
    manifest: DependencyManifest;
    requiresBuild: boolean;
    integrity?: string;
}
type AddFilesFromDirOptions = Pick<AddDirToStoreMessage, 'storeDir' | 'dir' | 'filesIndexFile' | 'sideEffectsCacheKey' | 'readManifest' | 'pkg' | 'files' | 'appendManifest'>;
export declare function addFilesFromDir(opts: AddFilesFromDirOptions): Promise<AddFilesResult>;
export declare class TarballIntegrityError extends PnpmError {
    readonly found: string;
    readonly expected: string;
    readonly algorithm: string;
    readonly sri: string;
    readonly url: string;
    constructor(opts: {
        attempts?: number;
        found: string;
        expected: string;
        algorithm: string;
        sri: string;
        url: string;
    });
}
type AddFilesFromTarballOptions = Pick<TarballExtractMessage, 'buffer' | 'storeDir' | 'filesIndexFile' | 'integrity' | 'readManifest' | 'pkg' | 'appendManifest'> & {
    url: string;
};
export declare function addFilesFromTarball(opts: AddFilesFromTarballOptions): Promise<AddFilesResult>;
export declare function readPkgFromCafs(storeDir: string, verifyStoreIntegrity: boolean, filesIndexFile: string, readManifest?: boolean): Promise<{
    verified: boolean;
    pkgFilesIndex: PackageFilesIndex;
    manifest?: DependencyManifest;
    requiresBuild: boolean;
}>;
export declare function importPackage(opts: Omit<LinkPkgMessage, 'type'>): Promise<{
    isBuilt: boolean;
    importMethod: string | undefined;
}>;
export declare function symlinkAllModules(opts: Omit<SymlinkAllModulesMessage, 'type'>): Promise<{
    isBuilt: boolean;
    importMethod: string | undefined;
}>;
export declare function hardLinkDir(src: string, destDirs: string[]): Promise<void>;
export declare function initStoreDir(storeDir: string): Promise<void>;
export {};
