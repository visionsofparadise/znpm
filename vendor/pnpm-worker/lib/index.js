"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TarballIntegrityError = void 0;
exports.restartWorkerPool = restartWorkerPool;
exports.finishWorkers = finishWorkers;
exports.calcMaxWorkers = calcMaxWorkers;
exports.addFilesFromDir = addFilesFromDir;
exports.addFilesFromTarball = addFilesFromTarball;
exports.readPkgFromCafs = readPkgFromCafs;
exports.importPackage = importPackage;
exports.symlinkAllModules = symlinkAllModules;
exports.hardLinkDir = hardLinkDir;
exports.initStoreDir = initStoreDir;
// cspell:ignore checkin
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const WorkerPool_1 = require("@rushstack/worker-pool/lib/WorkerPool");
const error_1 = require("@pnpm/error");
const child_process_1 = require("child_process");
const is_windows_1 = __importDefault(require("is-windows"));
const p_limit_1 = __importDefault(require("p-limit"));
let workerPool;
async function restartWorkerPool() {
    await finishWorkers();
    workerPool = createTarballWorkerPool();
}
async function finishWorkers() {
    // @ts-expect-error
    await global.finishWorkers?.();
}
function createTarballWorkerPool() {
    const maxWorkers = calcMaxWorkers();
    const workerPool = new WorkerPool_1.WorkerPool({
        id: 'pnpm',
        maxWorkers,
        // eslint-disable-next-line comment-rules/no-restricted-comments
        // @pnpm/worker: workerScriptPath takes PNPM_WORKER_SCRIPT_PATH over path.join(__dirname, 'worker.js').
        workerScriptPath: process.env.PNPM_WORKER_SCRIPT_PATH ?? path_1.default.join(__dirname, 'worker.js'),
    });
    // @ts-expect-error
    if (global.finishWorkers) {
        // @ts-expect-error
        const previous = global.finishWorkers;
        // @ts-expect-error
        global.finishWorkers = async () => {
            await previous();
            await workerPool.finishAsync();
        };
    }
    else {
        // @ts-expect-error
        global.finishWorkers = () => workerPool.finishAsync();
    }
    return workerPool;
}
function calcMaxWorkers() {
    if (process.env.PNPM_MAX_WORKERS) {
        return parseInt(process.env.PNPM_MAX_WORKERS);
    }
    if (process.env.PNPM_WORKERS) {
        const idleCPUs = Math.abs(parseInt(process.env.PNPM_WORKERS));
        return Math.max(2, availableParallelism() - idleCPUs) - 1;
    }
    return Math.max(1, availableParallelism() - 1);
}
function availableParallelism() {
    return os_1.default.availableParallelism?.() ?? os_1.default.cpus().length;
}
async function addFilesFromDir(opts) {
    if (!workerPool) {
        workerPool = createTarballWorkerPool();
    }
    const localWorker = await workerPool.checkoutWorkerAsync(true);
    return new Promise((resolve, reject) => {
        localWorker.once('message', ({ status, error, value }) => {
            workerPool.checkinWorker(localWorker);
            if (status === 'error') {
                reject(new error_1.PnpmError(error.code ?? 'GIT_FETCH_FAILED', error.message));
                return;
            }
            resolve(value);
        });
        localWorker.postMessage({
            type: 'add-dir',
            storeDir: opts.storeDir,
            dir: opts.dir,
            filesIndexFile: opts.filesIndexFile,
            sideEffectsCacheKey: opts.sideEffectsCacheKey,
            readManifest: opts.readManifest,
            pkg: opts.pkg,
            appendManifest: opts.appendManifest,
            files: opts.files,
        });
    });
}
class TarballIntegrityError extends error_1.PnpmError {
    found;
    expected;
    algorithm;
    sri;
    url;
    constructor(opts) {
        super('TARBALL_INTEGRITY', `Got unexpected checksum for "${opts.url}". Wanted "${opts.expected}". Got "${opts.found}".`, {
            attempts: opts.attempts,
            hint: `The downloaded tarball does not match the integrity recorded in the lockfile. pnpm will not silently overwrite the locked integrity — that would defeat the lockfile's protection if a registry or proxy is serving tampered content.

If you trust the new content (legitimate republish, or stale local metadata cache):

  - Run "pnpm store prune" and retry, in case only the metadata cache is out of date.
  - Run "pnpm install --update-checksums" to refresh the locked integrity from the registry.

If you did not expect this package to change, treat it as a potential supply-chain issue and verify the new content before re-running with --update-checksums.`,
        });
        this.found = opts.found;
        this.expected = opts.expected;
        this.algorithm = opts.algorithm;
        this.sri = opts.sri;
        this.url = opts.url;
    }
}
exports.TarballIntegrityError = TarballIntegrityError;
async function addFilesFromTarball(opts) {
    if (!workerPool) {
        workerPool = createTarballWorkerPool();
    }
    const localWorker = await workerPool.checkoutWorkerAsync(true);
    return new Promise((resolve, reject) => {
        localWorker.once('message', ({ status, error, value }) => {
            workerPool.checkinWorker(localWorker);
            if (status === 'error') {
                if (error.type === 'integrity_validation_failed') {
                    reject(new TarballIntegrityError({
                        ...error,
                        url: opts.url,
                    }));
                    return;
                }
                reject(new error_1.PnpmError(error.code ?? 'TARBALL_EXTRACT', `Failed to add tarball from "${opts.url}" to store: ${error.message}`));
                return;
            }
            resolve(value);
        });
        localWorker.postMessage({
            type: 'extract',
            buffer: opts.buffer,
            storeDir: opts.storeDir,
            integrity: opts.integrity,
            filesIndexFile: opts.filesIndexFile,
            readManifest: opts.readManifest,
            pkg: opts.pkg,
            appendManifest: opts.appendManifest,
        });
    });
}
async function readPkgFromCafs(storeDir, verifyStoreIntegrity, filesIndexFile, readManifest) {
    if (!workerPool) {
        workerPool = createTarballWorkerPool();
    }
    const localWorker = await workerPool.checkoutWorkerAsync(true);
    return new Promise((resolve, reject) => {
        localWorker.once('message', ({ status, error, value }) => {
            workerPool.checkinWorker(localWorker);
            if (status === 'error') {
                reject(new error_1.PnpmError(error.code ?? 'READ_FROM_STORE', error.message));
                return;
            }
            resolve(value);
        });
        localWorker.postMessage({
            type: 'readPkgFromCafs',
            storeDir,
            filesIndexFile,
            readManifest,
            verifyStoreIntegrity,
        });
    });
}
// The workers are doing lots of file system operations
// so, running them in parallel helps only to a point.
// With local experimenting it was discovered that running 4 workers gives the best results.
// Adding more workers actually makes installation slower.
const limitImportingPackage = (0, p_limit_1.default)(4);
async function importPackage(opts) {
    return limitImportingPackage(async () => {
        if (!workerPool) {
            workerPool = createTarballWorkerPool();
        }
        const localWorker = await workerPool.checkoutWorkerAsync(true);
        return new Promise((resolve, reject) => {
            localWorker.once('message', ({ status, error, value }) => {
                workerPool.checkinWorker(localWorker);
                if (status === 'error') {
                    reject(new error_1.PnpmError(error.code ?? 'LINKING_FAILED', `[importPackage ${opts.targetDir}] ${error.message}`));
                    return;
                }
                resolve(value);
            });
            localWorker.postMessage({
                type: 'link',
                ...opts,
            });
        });
    });
}
async function symlinkAllModules(opts) {
    if (!workerPool) {
        workerPool = createTarballWorkerPool();
    }
    const localWorker = await workerPool.checkoutWorkerAsync(true);
    return new Promise((resolve, reject) => {
        localWorker.once('message', ({ status, error, value }) => {
            workerPool.checkinWorker(localWorker);
            if (status === 'error') {
                const hint = opts.deps?.[0]?.modules != null ? createErrorHint(error, opts.deps[0].modules) : undefined;
                reject(new error_1.PnpmError(error.code ?? 'SYMLINK_FAILED', `[symlinkAllModules] ${error.message}`, { hint }));
                return;
            }
            resolve(value);
        });
        localWorker.postMessage({
            type: 'symlinkAllModules',
            ...opts,
        });
    });
}
function createErrorHint(err, checkedDir) {
    if ('code' in err && err.code === 'EISDIR' && (0, is_windows_1.default)()) {
        const checkedDrive = `${checkedDir.split(':')[0]}:`;
        if (isDriveExFat(checkedDrive)) {
            return `The "${checkedDrive}" drive is exFAT, which does not support symlinks. This will cause installation to fail. You can set the node-linker to "hoisted" to avoid this issue.`;
        }
    }
    return undefined;
}
// In Windows system exFAT drive, symlink will result in error.
function isDriveExFat(drive) {
    if (!/^[a-z]:$/i.test(drive)) {
        throw new Error(`${drive} is not a valid disk on Windows`);
    }
    try {
        // cspell:disable-next-line
        const output = (0, child_process_1.execSync)(`powershell -Command "Get-Volume -DriveLetter ${drive.replace(':', '')} | Select-Object -ExpandProperty FileSystem"`).toString();
        const lines = output.trim().split('\n');
        const name = lines[0].trim();
        return name === 'exFAT';
    }
    catch {
        return false;
    }
}
async function hardLinkDir(src, destDirs) {
    if (!workerPool) {
        workerPool = createTarballWorkerPool();
    }
    const localWorker = await workerPool.checkoutWorkerAsync(true);
    await new Promise((resolve, reject) => {
        localWorker.once('message', ({ status, error }) => {
            workerPool.checkinWorker(localWorker);
            if (status === 'error') {
                reject(new error_1.PnpmError(error.code ?? 'HARDLINK_FAILED', error.message));
                return;
            }
            resolve();
        });
        localWorker.postMessage({
            type: 'hardLinkDir',
            src,
            destDirs,
        });
    });
}
async function initStoreDir(storeDir) {
    if (!workerPool) {
        workerPool = createTarballWorkerPool();
    }
    const localWorker = await workerPool.checkoutWorkerAsync(true);
    return new Promise((resolve, reject) => {
        localWorker.once('message', ({ status, error }) => {
            workerPool.checkinWorker(localWorker);
            if (status === 'error') {
                reject(new error_1.PnpmError(error.code ?? 'INIT_CAFS_FAILED', error.message));
                return;
            }
            resolve();
        });
        localWorker.postMessage({
            type: 'init-store',
            storeDir,
        });
    });
}
//# sourceMappingURL=index.js.map