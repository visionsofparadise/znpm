"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const graceful_fs_1 = __importDefault(require("@pnpm/graceful-fs"));
const create_cafs_store_1 = require("@pnpm/create-cafs-store");
const crypto = __importStar(require("@pnpm/crypto.polyfill"));
const exec_pkg_requires_build_1 = require("@pnpm/exec.pkg-requires-build");
const fs_hard_link_dir_1 = require("@pnpm/fs.hard-link-dir");
const store_cafs_1 = require("@pnpm/store.cafs");
const symlink_dependency_1 = require("@pnpm/symlink-dependency");
const load_json_file_1 = require("load-json-file");
const worker_threads_1 = require("worker_threads");
const INTEGRITY_REGEX = /^([^-]+)-([a-z0-9+/=]+)$/i;
function startWorker() {
    process.on('uncaughtException', (err) => {
        console.error(err);
    });
    worker_threads_1.parentPort.on('message', handleMessage);
}
const cafsCache = new Map();
const cafsStoreCache = new Map();
const cafsLocker = new Map();
async function handleMessage(message) {
    if (message === false) {
        worker_threads_1.parentPort.off('message', handleMessage);
        process.exit(0);
    }
    try {
        switch (message.type) {
            case 'extract': {
                worker_threads_1.parentPort.postMessage(addTarballToStore(message));
                break;
            }
            case 'link': {
                worker_threads_1.parentPort.postMessage(importPackage(message));
                break;
            }
            case 'add-dir': {
                worker_threads_1.parentPort.postMessage(addFilesFromDir(message));
                break;
            }
            case 'init-store': {
                worker_threads_1.parentPort.postMessage(initStore(message));
                break;
            }
            case 'readPkgFromCafs': {
                let { storeDir, filesIndexFile, readManifest, verifyStoreIntegrity } = message;
                let pkgFilesIndex;
                try {
                    pkgFilesIndex = (0, load_json_file_1.sync)(filesIndexFile);
                }
                catch {
                    // ignoring. It is fine if the integrity file is not present. Just refetch the package
                }
                if (!pkgFilesIndex) {
                    worker_threads_1.parentPort.postMessage({
                        status: 'success',
                        value: {
                            verified: false,
                            pkgFilesIndex: null,
                        },
                    });
                    return;
                }
                let verifyResult;
                if (pkgFilesIndex.requiresBuild == null) {
                    readManifest = true;
                }
                if (verifyStoreIntegrity) {
                    verifyResult = (0, store_cafs_1.checkPkgFilesIntegrity)(storeDir, pkgFilesIndex, readManifest);
                }
                else {
                    verifyResult = {
                        passed: true,
                        manifest: readManifest ? (0, store_cafs_1.readManifestFromStore)(storeDir, pkgFilesIndex) : undefined,
                    };
                }
                const requiresBuild = pkgFilesIndex.requiresBuild ?? (0, exec_pkg_requires_build_1.pkgRequiresBuild)(verifyResult.manifest, pkgFilesIndex.files);
                worker_threads_1.parentPort.postMessage({
                    status: 'success',
                    value: {
                        verified: verifyResult.passed,
                        manifest: verifyResult.manifest,
                        pkgFilesIndex,
                        requiresBuild,
                    },
                });
                break;
            }
            case 'symlinkAllModules': {
                worker_threads_1.parentPort.postMessage(symlinkAllModules(message));
                break;
            }
            case 'hardLinkDir': {
                (0, fs_hard_link_dir_1.hardLinkDir)(message.src, message.destDirs);
                worker_threads_1.parentPort.postMessage({ status: 'success' });
                break;
            }
        }
    }
    catch (e) { // eslint-disable-line
        worker_threads_1.parentPort.postMessage({
            status: 'error',
            error: {
                code: e.code,
                message: e.message ?? e.toString(),
            },
        });
    }
}
function addTarballToStore({ buffer, storeDir, integrity, filesIndexFile, appendManifest }) {
    if (integrity) {
        const [, algo, integrityHash] = integrity.match(INTEGRITY_REGEX);
        // Compensate for the possibility of non-uniform Base64 padding
        const normalizedRemoteHash = Buffer.from(integrityHash, 'base64').toString('hex');
        const calculatedHash = crypto.hash(algo, buffer, 'hex');
        if (calculatedHash !== normalizedRemoteHash) {
            return {
                status: 'error',
                error: {
                    type: 'integrity_validation_failed',
                    algorithm: algo,
                    expected: integrity,
                    found: `${algo}-${Buffer.from(calculatedHash, 'hex').toString('base64')}`,
                },
            };
        }
    }
    if (!cafsCache.has(storeDir)) {
        cafsCache.set(storeDir, (0, store_cafs_1.createCafs)(storeDir));
    }
    const cafs = cafsCache.get(storeDir);
    let { filesIndex, manifest } = cafs.addFilesFromTarball(buffer, true);
    if (appendManifest && manifest == null) {
        manifest = appendManifest;
        addManifestToCafs(cafs, filesIndex, appendManifest);
    }
    const { filesIntegrity, filesMap } = processFilesIndex(filesIndex);
    const requiresBuild = writeFilesIndexFile(filesIndexFile, { manifest: manifest ?? {}, files: filesIntegrity });
    return {
        status: 'success',
        value: {
            filesIndex: filesMap,
            manifest,
            requiresBuild,
            integrity: integrity ?? calcIntegrity(buffer),
        },
    };
}
function calcIntegrity(buffer) {
    const calculatedHash = crypto.hash('sha512', buffer, 'hex');
    return `sha512-${Buffer.from(calculatedHash, 'hex').toString('base64')}`;
}
function initStore({ storeDir }) {
    fs_1.default.mkdirSync(storeDir, { recursive: true });
    const hexChars = '0123456789abcdef'.split('');
    for (const subDir of ['files', 'index']) {
        const subDirPath = path_1.default.join(storeDir, subDir);
        try {
            fs_1.default.mkdirSync(subDirPath);
        }
        catch {
            // If a parallel process has already started creating the directories in the store,
            // ignore if it already exists.
        }
        for (const hex1 of hexChars) {
            for (const hex2 of hexChars) {
                try {
                    fs_1.default.mkdirSync(path_1.default.join(subDirPath, `${hex1}${hex2}`));
                }
                catch {
                    // If a parallel process has already started creating the directories in the store,
                    // ignore if it already exists.
                }
            }
        }
    }
    return { status: 'success' };
}
function addFilesFromDir({ appendManifest, dir, files, filesIndexFile, sideEffectsCacheKey, storeDir, }) {
    if (!cafsCache.has(storeDir)) {
        cafsCache.set(storeDir, (0, store_cafs_1.createCafs)(storeDir));
    }
    const cafs = cafsCache.get(storeDir);
    let { filesIndex, manifest } = cafs.addFilesFromDir(dir, {
        files,
        readManifest: true,
    });
    if (appendManifest && manifest == null) {
        manifest = appendManifest;
        addManifestToCafs(cafs, filesIndex, appendManifest);
    }
    const { filesIntegrity, filesMap } = processFilesIndex(filesIndex);
    let requiresBuild;
    if (sideEffectsCacheKey) {
        let filesIndex;
        try {
            filesIndex = (0, load_json_file_1.sync)(filesIndexFile);
        }
        catch {
            // If there is no existing index file, then we cannot store the side effects.
            return {
                status: 'success',
                value: {
                    filesIndex: filesMap,
                    manifest,
                    requiresBuild: (0, exec_pkg_requires_build_1.pkgRequiresBuild)(manifest, filesIntegrity),
                },
            };
        }
        filesIndex.sideEffects = filesIndex.sideEffects ?? {};
        filesIndex.sideEffects[sideEffectsCacheKey] = calculateDiff(filesIndex.files, filesIntegrity);
        if (filesIndex.requiresBuild == null) {
            requiresBuild = (0, exec_pkg_requires_build_1.pkgRequiresBuild)(manifest, filesIntegrity);
        }
        else {
            requiresBuild = filesIndex.requiresBuild;
        }
        writeJsonFile(filesIndexFile, filesIndex);
    }
    else {
        requiresBuild = writeFilesIndexFile(filesIndexFile, { manifest: manifest ?? {}, files: filesIntegrity });
    }
    return { status: 'success', value: { filesIndex: filesMap, manifest, requiresBuild } };
}
function addManifestToCafs(cafs, filesIndex, manifest) {
    const fileBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    const mode = 0o644;
    filesIndex['package.json'] = {
        mode,
        size: fileBuffer.length,
        ...cafs.addFile(fileBuffer, mode),
    };
}
function calculateDiff(baseFiles, sideEffectsFiles) {
    const deleted = [];
    const added = {};
    for (const file of new Set([...Object.keys(baseFiles), ...Object.keys(sideEffectsFiles)])) {
        if (!sideEffectsFiles[file]) {
            deleted.push(file);
        }
        else if (!baseFiles[file] ||
            baseFiles[file].integrity !== sideEffectsFiles[file].integrity ||
            baseFiles[file].mode !== sideEffectsFiles[file].mode) {
            added[file] = sideEffectsFiles[file];
        }
    }
    const diff = {};
    if (deleted.length > 0) {
        diff.deleted = deleted;
    }
    if (Object.keys(added).length > 0) {
        diff.added = added;
    }
    return diff;
}
function processFilesIndex(filesIndex) {
    const filesIntegrity = {};
    const filesMap = {};
    for (const [k, { checkedAt, filePath, integrity, mode, size }] of Object.entries(filesIndex)) {
        filesIntegrity[k] = {
            checkedAt,
            integrity: integrity.toString(), // TODO: use the raw Integrity object
            mode,
            size,
        };
        filesMap[k] = filePath;
    }
    return { filesIntegrity, filesMap };
}
function importPackage({ storeDir, packageImportMethod, filesResponse, sideEffectsCacheKey, targetDir, requiresBuild, force, keepModulesDir, disableRelinkLocalDirDeps, safeToSkip, }) {
    const cacheKey = JSON.stringify({ storeDir, packageImportMethod });
    if (!cafsStoreCache.has(cacheKey)) {
        cafsStoreCache.set(cacheKey, (0, create_cafs_store_1.createCafsStore)(storeDir, { packageImportMethod, cafsLocker }));
    }
    const cafsStore = cafsStoreCache.get(cacheKey);
    const { importMethod, isBuilt } = cafsStore.importPackage(targetDir, {
        filesResponse,
        force,
        disableRelinkLocalDirDeps,
        requiresBuild,
        sideEffectsCacheKey,
        keepModulesDir,
        safeToSkip,
    });
    return { status: 'success', value: { isBuilt, importMethod } };
}
function symlinkAllModules(opts) {
    for (const dep of opts.deps) {
        for (const [alias, pkgDir] of Object.entries(dep.children)) {
            if (alias !== dep.name) {
                (0, symlink_dependency_1.symlinkDependencySync)(pkgDir, dep.modules, alias);
            }
        }
    }
    return { status: 'success' };
}
function writeFilesIndexFile(filesIndexFile, { manifest, files, sideEffects }) {
    const requiresBuild = (0, exec_pkg_requires_build_1.pkgRequiresBuild)(manifest, files);
    const filesIndex = {
        name: manifest.name,
        version: manifest.version,
        requiresBuild,
        files,
        sideEffects,
    };
    writeJsonFile(filesIndexFile, filesIndex);
    return requiresBuild;
}
function writeJsonFile(filePath, data) {
    const targetDir = path_1.default.dirname(filePath);
    // TODO: use the API of @pnpm/cafs to write this file
    // There is actually no need to create the directory in 99% of cases.
    // So by using cafs API, we'll improve performance.
    fs_1.default.mkdirSync(targetDir, { recursive: true });
    // We remove the "-index.json" from the end of the temp file name
    // in order to avoid ENAMETOOLONG errors
    const temp = `${filePath.slice(0, -11)}${process.pid}`;
    graceful_fs_1.default.writeFileSync(temp, JSON.stringify(data));
    (0, store_cafs_1.optimisticRenameOverwrite)(temp, filePath);
}
//# sourceMappingURL=start.js.map