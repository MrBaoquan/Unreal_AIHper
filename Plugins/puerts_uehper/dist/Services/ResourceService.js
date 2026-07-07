"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceSessionFacade = exports.ResourceSession = exports.ResourceFacade = exports.ResourceService = exports.ResourceAsyncPreloadError = void 0;
const puerts_1 = require("puerts");
const UE = require("ue");
const Cancellation_1 = require("../Framework/Cancellation");
class ResourceAsyncPreloadError extends Error {
    constructor(batch) {
        super(`Async resource preload failed: ${batch.failed.map((item) => item.key).join(', ')}`);
        this.batch = batch;
        this.name = 'ResourceAsyncPreloadError';
    }
}
exports.ResourceAsyncPreloadError = ResourceAsyncPreloadError;
class ResourceService {
    constructor() {
        this.manifest = new Map();
        this.preloadGroups = new Map();
        this.cache = new Map();
        this.referenceCounts = new Map();
        this.activeAsyncRequests = new Map();
        this.asyncRequestSeed = 0;
    }
    setManifest(manifest) {
        this.manifest.clear();
        for (const key of Object.keys(manifest)) {
            this.register(key, manifest[key]);
        }
    }
    setPreloadGroups(groups) {
        this.preloadGroups.clear();
        for (const groupName of Object.keys(groups)) {
            this.registerPreloadGroup(groupName, groups[groupName]);
        }
    }
    register(key, entry) {
        if (!key) {
            throw new Error('Resource key is empty.');
        }
        if (!entry?.path) {
            throw new Error(`Resource path is empty: ${key}`);
        }
        this.manifest.set(key, { ...entry });
    }
    has(key) {
        return this.manifest.has(key);
    }
    registerPreloadGroup(groupName, keys) {
        if (!groupName) {
            throw new Error('Resource preload group name is empty.');
        }
        this.preloadGroups.set(groupName, [...keys]);
    }
    getPreloadGroup(groupName) {
        const keys = this.preloadGroups.get(groupName);
        return keys ? [...keys] : undefined;
    }
    getEntry(key) {
        const entry = this.manifest.get(key);
        return entry ? { ...entry } : undefined;
    }
    getCached(key) {
        return this.cache.get(key);
    }
    load(key, options = {}) {
        const entry = this.requireEntry(key);
        return this.isClassEntry(entry) ? this.loadClass(key, options) : this.loadObject(key, options);
    }
    loadObject(key, options = {}) {
        const entry = this.requireEntry(key);
        const cached = this.getUsableCache(key, options, entry);
        if (cached) {
            return { key, entry, asset: cached, fromCache: true };
        }
        const bSuccess = (0, puerts_1.$ref)(false);
        const errorMessage = (0, puerts_1.$ref)('');
        const asset = UE.UEHperBridgeLibrary.LoadObjectByPath(entry.path, bSuccess, errorMessage);
        this.assertLoaded(key, entry, asset, (0, puerts_1.$unref)(bSuccess), (0, puerts_1.$unref)(errorMessage));
        this.remember(key, entry, options, asset);
        return { key, entry, asset, fromCache: false };
    }
    loadAsync(key, worldContextObject, options = {}) {
        return this.createLoadTask(key, worldContextObject, options).promise;
    }
    loadObjectAsync(key, worldContextObject, options = {}) {
        return this.createObjectLoadTask(key, worldContextObject, options).promise;
    }
    loadClassAsync(key, worldContextObject, options = {}) {
        return this.createClassLoadTask(key, worldContextObject, options).promise;
    }
    createLoadTask(key, worldContextObject, options = {}) {
        const entry = this.requireEntry(key);
        return this.isClassEntry(entry)
            ? this.createClassLoadTask(key, worldContextObject, options)
            : this.createObjectLoadTask(key, worldContextObject, options);
    }
    createObjectLoadTask(key, worldContextObject, options = {}) {
        return this.createAsyncLoadTask(key, worldContextObject, false, options);
    }
    createClassLoadTask(key, worldContextObject, options = {}) {
        return this.createAsyncLoadTask(key, worldContextObject, true, options);
    }
    loadClass(key, options = {}) {
        const entry = this.requireEntry(key);
        const cached = this.getUsableCache(key, options, entry);
        if (cached) {
            return { key, entry, asset: cached, fromCache: true };
        }
        const bSuccess = (0, puerts_1.$ref)(false);
        const errorMessage = (0, puerts_1.$ref)('');
        const asset = UE.UEHperBridgeLibrary.LoadClassByPath(entry.path, bSuccess, errorMessage);
        this.assertLoaded(key, entry, asset, (0, puerts_1.$unref)(bSuccess), (0, puerts_1.$unref)(errorMessage));
        this.remember(key, entry, options, asset);
        return { key, entry, asset, fromCache: false };
    }
    preload(keys) {
        const targetKeys = keys ?? Array.from(this.manifest.keys());
        for (const key of targetKeys) {
            this.load(key, { cache: true });
        }
    }
    preloadGroup(groupName) {
        this.preload(this.requirePreloadGroup(groupName));
    }
    async preloadAsync(keys, worldContextObject, options = {}) {
        const batch = await this.preloadBatchAsync(keys, worldContextObject, { ...options, collectErrors: false });
        return batch.succeeded.map((item) => item.result);
    }
    preloadGroupAsync(groupName, worldContextObject, options = {}) {
        return this.preloadAsync(this.requirePreloadGroup(groupName), worldContextObject, options);
    }
    async preloadBatchAsync(keys, worldContextObject, options = {}) {
        return this.runPreloadBatch(keys ?? Array.from(this.manifest.keys()), undefined, options, (key) => this.loadAsync(key, worldContextObject, { ...options, cache: options.cache ?? true }));
    }
    preloadGroupBatchAsync(groupName, worldContextObject, options = {}) {
        return this.runPreloadBatch(this.requirePreloadGroup(groupName), groupName, options, (key) => this.loadAsync(key, worldContextObject, { ...options, cache: options.cache ?? true }));
    }
    cancelAsync(requestId) {
        const active = this.activeAsyncRequests.get(requestId);
        return active ? active.subsystem.CancelAsyncLoad(requestId) : false;
    }
    createSession(name) {
        return new ResourceSession(name, this);
    }
    retain(key) {
        const nextCount = (this.referenceCounts.get(key) ?? 0) + 1;
        this.referenceCounts.set(key, nextCount);
        return nextCount;
    }
    releaseReference(key) {
        const currentCount = this.referenceCounts.get(key) ?? 0;
        const nextCount = Math.max(0, currentCount - 1);
        if (nextCount === 0) {
            this.referenceCounts.delete(key);
            this.release(key);
        }
        else {
            this.referenceCounts.set(key, nextCount);
        }
        return nextCount;
    }
    getReferenceCount(key) {
        return this.referenceCounts.get(key) ?? 0;
    }
    release(key) {
        this.cache.delete(key);
        this.referenceCounts.delete(key);
    }
    releaseAll() {
        this.cache.clear();
        this.referenceCounts.clear();
    }
    dispose() {
        this.releaseAll();
        this.manifest.clear();
    }
    createAsyncLoadTask(key, worldContextObject, bIsClass, options) {
        options.cancellationToken?.throwIfCancellationRequested();
        const entry = this.requireEntry(key);
        const cached = this.getUsableCache(key, options, entry);
        const requestId = options.requestId || this.createRequestId(key);
        if (cached) {
            return {
                requestId,
                key,
                promise: Promise.resolve({ key, entry, asset: cached, fromCache: true, requestId, status: UE.EUEHperAsyncLoadStatus.Completed }),
                cancel: () => false,
            };
        }
        if (this.activeAsyncRequests.has(requestId)) {
            throw new Error(`Async resource request already exists: ${requestId}`);
        }
        const subsystem = this.requireResourceSubsystem(worldContextObject);
        const promise = new Promise((resolve, reject) => {
            const callback = (result) => {
                if (result.RequestId !== requestId) {
                    return;
                }
                const status = subsystem.GetAsyncLoadStatus(requestId);
                this.cleanupAsyncRequest(requestId, true);
                if (status === UE.EUEHperAsyncLoadStatus.Canceled) {
                    reject(new Cancellation_1.OperationCanceledError(result.ErrorMessage || options.cancellationToken?.reason));
                    return;
                }
                const asset = (bIsClass ? result.Class : result.Object);
                try {
                    this.assertLoaded(key, entry, asset, result.bSuccess, result.ErrorMessage);
                    this.remember(key, entry, options, asset);
                    resolve({ key, entry, asset: asset, fromCache: false, requestId, status });
                }
                catch (error) {
                    reject(error);
                }
            };
            const delegate = (0, puerts_1.toManualReleaseDelegate)(callback);
            subsystem.OnAsyncLoadCompleted.Add(delegate);
            const unsubscribeCancellation = options.cancellationToken?.onCancellationRequested(() => {
                this.cancelAsync(requestId);
            });
            this.activeAsyncRequests.set(requestId, { subsystem, callback, delegate, unsubscribeCancellation });
            const errorMessage = (0, puerts_1.$ref)('');
            const accepted = bIsClass ? subsystem.RequestAsyncLoadClass(requestId, entry.path, errorMessage) : subsystem.RequestAsyncLoadObject(requestId, entry.path, errorMessage);
            if (!accepted) {
                this.cleanupAsyncRequest(requestId, false);
                const detail = (0, puerts_1.$unref)(errorMessage) || `path=${entry.path}`;
                UE.UEHperBridgeLibrary.ReportFrameworkError('Resource.AsyncRequestFailed', `Async resource request failed: ${key}`, detail);
                reject(new Error(`Async resource request failed: ${key}. ${detail}`));
            }
        });
        return {
            requestId,
            key,
            promise,
            cancel: () => this.cancelAsync(requestId),
        };
    }
    requireResourceSubsystem(worldContextObject) {
        if (!worldContextObject) {
            throw new Error('WorldContextObject is required for async resource loading.');
        }
        const subsystem = UE.UEHperBridgeLibrary.GetResourceSubsystem(worldContextObject);
        if (!subsystem || !UE.UEHperBridgeLibrary.IsValidObject(subsystem)) {
            throw new Error('UEHperResourceSubsystem is not available for the current world context.');
        }
        return subsystem;
    }
    cleanupAsyncRequest(requestId, releaseHandle) {
        const active = this.activeAsyncRequests.get(requestId);
        if (!active) {
            return;
        }
        active.subsystem.OnAsyncLoadCompleted.Remove(active.delegate);
        (0, puerts_1.releaseManualReleaseDelegate)(active.callback);
        active.unsubscribeCancellation?.();
        if (releaseHandle) {
            active.subsystem.ReleaseAsyncLoadHandle(requestId);
        }
        this.activeAsyncRequests.delete(requestId);
    }
    createRequestId(key) {
        this.asyncRequestSeed += 1;
        const normalizedKey = key.replace(/[^A-Za-z0-9_]/g, '_');
        return `resource_${normalizedKey}_${Date.now()}_${this.asyncRequestSeed}`;
    }
    async runPreloadBatch(keys, groupName, options, loader) {
        const itemResults = await this.executePreloadItems(keys, groupName, options, loader);
        const batch = this.createPreloadBatch(groupName, keys, itemResults);
        if (!batch.success && options.rollbackOnFailure) {
            for (const item of batch.succeeded) {
                this.release(item.key);
            }
        }
        if (!batch.success && !options.collectErrors) {
            throw new ResourceAsyncPreloadError(batch);
        }
        return batch;
    }
    async executePreloadItems(keys, groupName, options, loader) {
        const itemResults = new Array(keys.length);
        const concurrency = this.normalizePreloadConcurrency(options, keys.length);
        let nextIndex = 0;
        let completed = 0;
        let inFlight = 0;
        let succeeded = 0;
        let failed = 0;
        let shouldStop = false;
        const worker = async () => {
            while (!shouldStop) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= keys.length) {
                    return;
                }
                const key = keys[index];
                inFlight += 1;
                this.emitPreloadProgress(groupName, options, key, index, completed, keys.length, inFlight, concurrency, succeeded, failed, 'started', undefined, undefined, undefined);
                try {
                    options.cancellationToken?.throwIfCancellationRequested();
                    const result = await loader(key);
                    succeeded += 1;
                    itemResults[index] = { key, success: true, result };
                    completed += 1;
                    inFlight -= 1;
                    this.emitPreloadProgress(groupName, options, key, index, completed, keys.length, inFlight, concurrency, succeeded, failed, 'completed', true, result, undefined);
                }
                catch (error) {
                    failed += 1;
                    itemResults[index] = { key, success: false, error };
                    completed += 1;
                    inFlight -= 1;
                    this.emitPreloadProgress(groupName, options, key, index, completed, keys.length, inFlight, concurrency, succeeded, failed, 'completed', false, undefined, error);
                    if (!options.collectErrors) {
                        shouldStop = true;
                    }
                }
            }
        };
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        return itemResults.filter((item) => item != null);
    }
    normalizePreloadConcurrency(options, total) {
        if (total <= 0) {
            return 1;
        }
        const requested = Math.floor(options.concurrency ?? 1);
        return Math.max(1, Math.min(total, requested));
    }
    emitPreloadProgress(groupName, options, key, index, completed, total, inFlight, concurrency, succeeded, failed, phase, success, result, error) {
        options.onProgress?.({ groupName, phase, key, index, completed, total, inFlight, concurrency, succeeded, failed, success, result, error });
    }
    createPreloadBatch(groupName, keys, results) {
        const succeeded = results.filter((item) => item.success);
        const failed = results.filter((item) => !item.success);
        return {
            groupName,
            keys: [...keys],
            success: failed.length === 0,
            results,
            succeeded,
            failed,
        };
    }
    requireEntry(key) {
        const entry = this.manifest.get(key);
        if (!entry) {
            throw new Error(`Resource not registered: ${key}`);
        }
        return entry;
    }
    requirePreloadGroup(groupName) {
        const keys = this.preloadGroups.get(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }
        return [...keys];
    }
    getUsableCache(key, options, entry) {
        if (!this.shouldCache(entry, options)) {
            return undefined;
        }
        const cached = this.cache.get(key);
        if (!cached) {
            return undefined;
        }
        if (cached instanceof UE.Object && !UE.UEHperBridgeLibrary.IsValidObject(cached)) {
            this.cache.delete(key);
            return undefined;
        }
        return cached;
    }
    remember(key, entry, options, asset) {
        if (this.shouldCache(entry, options)) {
            this.cache.set(key, asset);
        }
    }
    shouldCache(entry, options) {
        return options.cache ?? entry.cache ?? true;
    }
    isClassEntry(entry) {
        const type = entry.type.toLowerCase();
        return type === 'class' || type.endsWith('class') || entry.path.endsWith('_C');
    }
    assertLoaded(key, entry, asset, bSuccess, errorMessage) {
        if (bSuccess && asset) {
            return;
        }
        const detail = errorMessage || `path=${entry.path}`;
        UE.UEHperBridgeLibrary.ReportFrameworkError('Resource.LoadFailed', `Resource load failed: ${key}`, detail);
        throw new Error(`Resource load failed: ${key}. ${detail}`);
    }
}
exports.ResourceService = ResourceService;
class ResourceFacade {
    constructor(resources, worldContextObject) {
        this.resources = resources;
        this.worldContextObject = worldContextObject;
    }
    get root() {
        return this.resources;
    }
    setManifest(manifest) {
        this.resources.setManifest(manifest);
    }
    setPreloadGroups(groups) {
        this.resources.setPreloadGroups(groups);
    }
    register(key, entry) {
        this.resources.register(key, entry);
    }
    has(key) {
        return this.resources.has(key);
    }
    registerPreloadGroup(groupName, keys) {
        this.resources.registerPreloadGroup(groupName, keys);
    }
    getPreloadGroup(groupName) {
        return this.resources.getPreloadGroup(groupName);
    }
    getEntry(key) {
        return this.resources.getEntry(key);
    }
    getCached(key) {
        return this.resources.getCached(key);
    }
    load(key, options = {}) {
        return this.resources.load(key, options);
    }
    loadObject(key, options = {}) {
        return this.resources.loadObject(key, options);
    }
    loadClass(key, options = {}) {
        return this.resources.loadClass(key, options);
    }
    loadAsync(key, options = {}) {
        return this.resources.loadAsync(key, this.worldContextObject, options);
    }
    loadObjectAsync(key, options = {}) {
        return this.resources.loadObjectAsync(key, this.worldContextObject, options);
    }
    loadClassAsync(key, options = {}) {
        return this.resources.loadClassAsync(key, this.worldContextObject, options);
    }
    createLoadTask(key, options = {}) {
        return this.resources.createLoadTask(key, this.worldContextObject, options);
    }
    createObjectLoadTask(key, options = {}) {
        return this.resources.createObjectLoadTask(key, this.worldContextObject, options);
    }
    createClassLoadTask(key, options = {}) {
        return this.resources.createClassLoadTask(key, this.worldContextObject, options);
    }
    preload(keys) {
        this.resources.preload(keys);
    }
    preloadGroup(groupName) {
        this.resources.preloadGroup(groupName);
    }
    preloadAsync(keys, options = {}) {
        return this.resources.preloadAsync(keys, this.worldContextObject, options);
    }
    preloadGroupAsync(groupName, options = {}) {
        return this.resources.preloadGroupAsync(groupName, this.worldContextObject, options);
    }
    preloadBatchAsync(keys, options = {}) {
        return this.resources.preloadBatchAsync(keys, this.worldContextObject, options);
    }
    preloadGroupBatchAsync(groupName, options = {}) {
        return this.resources.preloadGroupBatchAsync(groupName, this.worldContextObject, options);
    }
    createSession(name) {
        return new ResourceSessionFacade(this.resources.createSession(name), this.worldContextObject);
    }
    retain(key) {
        return this.resources.retain(key);
    }
    releaseReference(key) {
        return this.resources.releaseReference(key);
    }
    getReferenceCount(key) {
        return this.resources.getReferenceCount(key);
    }
    release(key) {
        this.resources.release(key);
    }
    releaseAll() {
        this.resources.releaseAll();
    }
    cancelAsync(requestId) {
        return this.resources.cancelAsync(requestId);
    }
}
exports.ResourceFacade = ResourceFacade;
class ResourceSession {
    constructor(name, resources) {
        this.name = name;
        this.resources = resources;
        this.retainedKeys = new Set();
        if (!name) {
            throw new Error('ResourceSession name is empty.');
        }
    }
    load(key, options = {}) {
        const result = this.resources.load(key, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }
    loadObject(key, options = {}) {
        const result = this.resources.loadObject(key, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }
    loadClass(key, options = {}) {
        const result = this.resources.loadClass(key, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }
    async loadAsync(key, worldContextObject, options = {}) {
        const result = await this.resources.loadAsync(key, worldContextObject, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }
    async loadObjectAsync(key, worldContextObject, options = {}) {
        const result = await this.resources.loadObjectAsync(key, worldContextObject, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }
    async loadClassAsync(key, worldContextObject, options = {}) {
        const result = await this.resources.loadClassAsync(key, worldContextObject, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }
    preload(keys) {
        for (const key of keys) {
            this.load(key, { cache: true });
        }
    }
    preloadGroup(groupName) {
        const keys = this.resources.getPreloadGroup(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }
        this.preload(keys);
    }
    async preloadAsync(keys, worldContextObject, options = {}) {
        const batch = await this.preloadBatchAsync(keys, worldContextObject, { ...options, collectErrors: false });
        return batch.succeeded.map((item) => item.result);
    }
    preloadGroupAsync(groupName, worldContextObject, options = {}) {
        const keys = this.resources.getPreloadGroup(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }
        return this.preloadAsync(keys, worldContextObject, options);
    }
    async preloadBatchAsync(keys, worldContextObject, options = {}) {
        const itemResults = await this.executePreloadItems(keys, undefined, options, (key) => this.loadAsync(key, worldContextObject, options));
        const batch = this.createPreloadBatch(undefined, keys, itemResults);
        if (!batch.success && options.rollbackOnFailure) {
            for (const item of batch.succeeded) {
                this.release(item.key);
            }
        }
        if (!batch.success && !options.collectErrors) {
            throw new ResourceAsyncPreloadError(batch);
        }
        return batch;
    }
    async preloadGroupBatchAsync(groupName, worldContextObject, options = {}) {
        const keys = this.resources.getPreloadGroup(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }
        const batch = await this.preloadBatchAsync(keys, worldContextObject, options);
        return { ...batch, groupName };
    }
    release(key) {
        if (!this.retainedKeys.delete(key)) {
            return;
        }
        this.resources.releaseReference(key);
    }
    releaseAll() {
        for (const key of Array.from(this.retainedKeys)) {
            this.release(key);
        }
    }
    dispose() {
        this.releaseAll();
    }
    getRetainedKeys() {
        return Array.from(this.retainedKeys);
    }
    retain(key) {
        if (this.retainedKeys.has(key)) {
            return;
        }
        this.retainedKeys.add(key);
        this.resources.retain(key);
    }
    createPreloadBatch(groupName, keys, results) {
        const succeeded = results.filter((item) => item.success);
        const failed = results.filter((item) => !item.success);
        return {
            groupName,
            keys: [...keys],
            success: failed.length === 0,
            results,
            succeeded,
            failed,
        };
    }
    async executePreloadItems(keys, groupName, options, loader) {
        const itemResults = new Array(keys.length);
        const concurrency = this.normalizePreloadConcurrency(options, keys.length);
        let nextIndex = 0;
        let completed = 0;
        let inFlight = 0;
        let succeeded = 0;
        let failed = 0;
        let shouldStop = false;
        const worker = async () => {
            while (!shouldStop) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= keys.length) {
                    return;
                }
                const key = keys[index];
                inFlight += 1;
                this.emitPreloadProgress(groupName, options, key, index, completed, keys.length, inFlight, concurrency, succeeded, failed, 'started', undefined, undefined, undefined);
                try {
                    options.cancellationToken?.throwIfCancellationRequested();
                    const result = await loader(key);
                    succeeded += 1;
                    itemResults[index] = { key, success: true, result };
                    completed += 1;
                    inFlight -= 1;
                    this.emitPreloadProgress(groupName, options, key, index, completed, keys.length, inFlight, concurrency, succeeded, failed, 'completed', true, result, undefined);
                }
                catch (error) {
                    failed += 1;
                    itemResults[index] = { key, success: false, error };
                    completed += 1;
                    inFlight -= 1;
                    this.emitPreloadProgress(groupName, options, key, index, completed, keys.length, inFlight, concurrency, succeeded, failed, 'completed', false, undefined, error);
                    if (!options.collectErrors) {
                        shouldStop = true;
                    }
                }
            }
        };
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        return itemResults.filter((item) => item != null);
    }
    normalizePreloadConcurrency(options, total) {
        if (total <= 0) {
            return 1;
        }
        const requested = Math.floor(options.concurrency ?? 1);
        return Math.max(1, Math.min(total, requested));
    }
    emitPreloadProgress(groupName, options, key, index, completed, total, inFlight, concurrency, succeeded, failed, phase, success, result, error) {
        options.onProgress?.({ groupName, phase, key, index, completed, total, inFlight, concurrency, succeeded, failed, success, result, error });
    }
}
exports.ResourceSession = ResourceSession;
class ResourceSessionFacade {
    constructor(session, worldContextObject) {
        this.session = session;
        this.worldContextObject = worldContextObject;
    }
    get name() {
        return this.session.name;
    }
    get root() {
        return this.session;
    }
    load(key, options = {}) {
        return this.session.load(key, options);
    }
    loadObject(key, options = {}) {
        return this.session.loadObject(key, options);
    }
    loadClass(key, options = {}) {
        return this.session.loadClass(key, options);
    }
    loadAsync(key, options = {}) {
        return this.session.loadAsync(key, this.worldContextObject, options);
    }
    loadObjectAsync(key, options = {}) {
        return this.session.loadObjectAsync(key, this.worldContextObject, options);
    }
    loadClassAsync(key, options = {}) {
        return this.session.loadClassAsync(key, this.worldContextObject, options);
    }
    preload(keys) {
        this.session.preload(keys);
    }
    preloadGroup(groupName) {
        this.session.preloadGroup(groupName);
    }
    preloadAsync(keys, options = {}) {
        return this.session.preloadAsync(keys, this.worldContextObject, options);
    }
    preloadGroupAsync(groupName, options = {}) {
        return this.session.preloadGroupAsync(groupName, this.worldContextObject, options);
    }
    preloadBatchAsync(keys, options = {}) {
        return this.session.preloadBatchAsync(keys, this.worldContextObject, options);
    }
    preloadGroupBatchAsync(groupName, options = {}) {
        return this.session.preloadGroupBatchAsync(groupName, this.worldContextObject, options);
    }
    release(key) {
        this.session.release(key);
    }
    releaseAll() {
        this.session.releaseAll();
    }
    dispose() {
        this.session.dispose();
    }
    getRetainedKeys() {
        return this.session.getRetainedKeys();
    }
}
exports.ResourceSessionFacade = ResourceSessionFacade;
//# sourceMappingURL=ResourceService.js.map