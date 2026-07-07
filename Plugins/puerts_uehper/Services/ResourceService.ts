import { $ref, $unref, releaseManualReleaseDelegate, toManualReleaseDelegate } from 'puerts';
import * as UE from 'ue';
import { OperationCanceledError, type CancellationToken } from '../Framework/Cancellation';

export interface ResourceManifestEntry {
    type: string;
    path: string;
    cache?: boolean;
}

export type ResourceManifest = Record<string, ResourceManifestEntry>;
export type ResourcePreloadGroups = Record<string, string[]>;

export interface ResourceLoadOptions {
    cache?: boolean;
}

export interface ResourceLoadResult<T> {
    key: string;
    entry: ResourceManifestEntry;
    asset: T;
    fromCache: boolean;
}

export interface ResourceAsyncLoadOptions extends ResourceLoadOptions {
    requestId?: string;
    cancellationToken?: CancellationToken;
}

export interface ResourceAsyncLoadResult<T> extends ResourceLoadResult<T> {
    requestId: string;
    status: UE.EUEHperAsyncLoadStatus;
}

export interface ResourceAsyncLoadTask<T> {
    requestId: string;
    key: string;
    promise: Promise<ResourceAsyncLoadResult<T>>;
    cancel(): boolean;
}

export interface ResourceAsyncPreloadOptions extends ResourceAsyncLoadOptions {
    collectErrors?: boolean;
    rollbackOnFailure?: boolean;
    concurrency?: number;
    onProgress?: (progress: ResourceAsyncPreloadProgress<CachedResource>) => void;
}

export type ResourceAsyncPreloadProgressPhase = 'started' | 'completed';

export interface ResourceAsyncPreloadProgress<T> {
    groupName?: string;
    phase: ResourceAsyncPreloadProgressPhase;
    key: string;
    index: number;
    completed: number;
    total: number;
    inFlight: number;
    concurrency: number;
    succeeded: number;
    failed: number;
    success?: boolean;
    result?: ResourceAsyncLoadResult<T>;
    error?: unknown;
}

export interface ResourceAsyncPreloadItemResult<T> {
    key: string;
    success: boolean;
    result?: ResourceAsyncLoadResult<T>;
    error?: unknown;
}

export interface ResourceAsyncPreloadBatchResult<T> {
    groupName?: string;
    keys: string[];
    success: boolean;
    results: ResourceAsyncPreloadItemResult<T>[];
    succeeded: ResourceAsyncPreloadItemResult<T>[];
    failed: ResourceAsyncPreloadItemResult<T>[];
}

export class ResourceAsyncPreloadError<T> extends Error {
    constructor(readonly batch: ResourceAsyncPreloadBatchResult<T>) {
        super(`Async resource preload failed: ${batch.failed.map((item) => item.key).join(', ')}`);
        this.name = 'ResourceAsyncPreloadError';
    }
}

type CachedResource = UE.Object | UE.Class;

interface ActiveAsyncLoadRequest {
    subsystem: UE.UEHperResourceSubsystem;
    callback: (result: UE.UEHperAsyncLoadResult) => void;
    delegate: unknown;
    unsubscribeCancellation?: () => void;
}

export class ResourceService {
    private readonly manifest = new Map<string, ResourceManifestEntry>();
    private readonly preloadGroups = new Map<string, string[]>();
    private readonly cache = new Map<string, CachedResource>();
    private readonly referenceCounts = new Map<string, number>();
    private readonly activeAsyncRequests = new Map<string, ActiveAsyncLoadRequest>();
    private asyncRequestSeed = 0;

    setManifest(manifest: ResourceManifest): void {
        this.manifest.clear();
        for (const key of Object.keys(manifest)) {
            this.register(key, manifest[key]);
        }
    }

    setPreloadGroups(groups: ResourcePreloadGroups): void {
        this.preloadGroups.clear();
        for (const groupName of Object.keys(groups)) {
            this.registerPreloadGroup(groupName, groups[groupName]);
        }
    }

    register(key: string, entry: ResourceManifestEntry): void {
        if (!key) {
            throw new Error('Resource key is empty.');
        }
        if (!entry?.path) {
            throw new Error(`Resource path is empty: ${key}`);
        }

        this.manifest.set(key, { ...entry });
    }

    has(key: string): boolean {
        return this.manifest.has(key);
    }

    registerPreloadGroup(groupName: string, keys: string[]): void {
        if (!groupName) {
            throw new Error('Resource preload group name is empty.');
        }

        this.preloadGroups.set(groupName, [...keys]);
    }

    getPreloadGroup(groupName: string): string[] | undefined {
        const keys = this.preloadGroups.get(groupName);
        return keys ? [...keys] : undefined;
    }

    getEntry(key: string): ResourceManifestEntry | undefined {
        const entry = this.manifest.get(key);
        return entry ? { ...entry } : undefined;
    }

    getCached<T extends CachedResource = CachedResource>(key: string): T | undefined {
        return this.cache.get(key) as T | undefined;
    }

    load<T extends CachedResource = CachedResource>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        const entry = this.requireEntry(key);
        return this.isClassEntry(entry) ? (this.loadClass(key, options) as ResourceLoadResult<T>) : (this.loadObject(key, options) as ResourceLoadResult<T>);
    }

    loadObject<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        const entry = this.requireEntry(key);
        const cached = this.getUsableCache<T>(key, options, entry);
        if (cached) {
            return { key, entry, asset: cached, fromCache: true };
        }

        const bSuccess = $ref(false);
        const errorMessage = $ref('');
        const asset = UE.UEHperBridgeLibrary.LoadObjectByPath(entry.path, bSuccess, errorMessage) as T;
        this.assertLoaded(key, entry, asset, $unref(bSuccess), $unref(errorMessage));
        this.remember(key, entry, options, asset);
        return { key, entry, asset, fromCache: false };
    }

    loadAsync<T extends CachedResource = CachedResource>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        return this.createLoadTask<T>(key, worldContextObject, options).promise;
    }

    loadObjectAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        return this.createObjectLoadTask<T>(key, worldContextObject, options).promise;
    }

    loadClassAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<UE.Class>> {
        return this.createClassLoadTask<T>(key, worldContextObject, options).promise;
    }

    createLoadTask<T extends CachedResource = CachedResource>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): ResourceAsyncLoadTask<T> {
        const entry = this.requireEntry(key);
        return this.isClassEntry(entry)
            ? (this.createClassLoadTask(key, worldContextObject, options) as ResourceAsyncLoadTask<T>)
            : (this.createObjectLoadTask(key, worldContextObject, options) as ResourceAsyncLoadTask<T>);
    }

    createObjectLoadTask<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): ResourceAsyncLoadTask<T> {
        return this.createAsyncLoadTask<T>(key, worldContextObject, false, options);
    }

    createClassLoadTask<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): ResourceAsyncLoadTask<UE.Class> {
        return this.createAsyncLoadTask<UE.Class>(key, worldContextObject, true, options);
    }

    loadClass<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<UE.Class> {
        const entry = this.requireEntry(key);
        const cached = this.getUsableCache<UE.Class>(key, options, entry);
        if (cached) {
            return { key, entry, asset: cached, fromCache: true };
        }

        const bSuccess = $ref(false);
        const errorMessage = $ref('');
        const asset = UE.UEHperBridgeLibrary.LoadClassByPath(entry.path, bSuccess, errorMessage);
        this.assertLoaded(key, entry, asset, $unref(bSuccess), $unref(errorMessage));
        this.remember(key, entry, options, asset);
        return { key, entry, asset, fromCache: false };
    }

    preload(keys?: string[]): void {
        const targetKeys = keys ?? Array.from(this.manifest.keys());
        for (const key of targetKeys) {
            this.load(key, { cache: true });
        }
    }

    preloadGroup(groupName: string): void {
        this.preload(this.requirePreloadGroup(groupName));
    }

    async preloadAsync(keys: string[] | undefined, worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        const batch = await this.preloadBatchAsync(keys, worldContextObject, { ...options, collectErrors: false });
        return batch.succeeded.map((item) => item.result as ResourceAsyncLoadResult<CachedResource>);
    }

    preloadGroupAsync(groupName: string, worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        return this.preloadAsync(this.requirePreloadGroup(groupName), worldContextObject, options);
    }

    async preloadBatchAsync(keys: string[] | undefined, worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
        return this.runPreloadBatch(keys ?? Array.from(this.manifest.keys()), undefined, options, (key) => this.loadAsync(key, worldContextObject, { ...options, cache: options.cache ?? true }));
    }

    preloadGroupBatchAsync(groupName: string, worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
        return this.runPreloadBatch(this.requirePreloadGroup(groupName), groupName, options, (key) => this.loadAsync(key, worldContextObject, { ...options, cache: options.cache ?? true }));
    }

    cancelAsync(requestId: string): boolean {
        const active = this.activeAsyncRequests.get(requestId);
        return active ? active.subsystem.CancelAsyncLoad(requestId) : false;
    }

    createSession(name: string): ResourceSession {
        return new ResourceSession(name, this);
    }

    retain(key: string): number {
        const nextCount = (this.referenceCounts.get(key) ?? 0) + 1;
        this.referenceCounts.set(key, nextCount);
        return nextCount;
    }

    releaseReference(key: string): number {
        const currentCount = this.referenceCounts.get(key) ?? 0;
        const nextCount = Math.max(0, currentCount - 1);
        if (nextCount === 0) {
            this.referenceCounts.delete(key);
            this.release(key);
        } else {
            this.referenceCounts.set(key, nextCount);
        }
        return nextCount;
    }

    getReferenceCount(key: string): number {
        return this.referenceCounts.get(key) ?? 0;
    }

    release(key: string): void {
        this.cache.delete(key);
        this.referenceCounts.delete(key);
    }

    releaseAll(): void {
        this.cache.clear();
        this.referenceCounts.clear();
    }

    dispose(): void {
        this.releaseAll();
        this.manifest.clear();
    }

    private createAsyncLoadTask<T extends CachedResource>(key: string, worldContextObject: UE.Object, bIsClass: boolean, options: ResourceAsyncLoadOptions): ResourceAsyncLoadTask<T> {
        options.cancellationToken?.throwIfCancellationRequested();
        const entry = this.requireEntry(key);
        const cached = this.getUsableCache<T>(key, options, entry);
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
        const promise = new Promise<ResourceAsyncLoadResult<T>>((resolve, reject) => {
            const callback = (result: UE.UEHperAsyncLoadResult) => {
                if (result.RequestId !== requestId) {
                    return;
                }

                const status = subsystem.GetAsyncLoadStatus(requestId);
                this.cleanupAsyncRequest(requestId, true);

                if (status === UE.EUEHperAsyncLoadStatus.Canceled) {
                    reject(new OperationCanceledError(result.ErrorMessage || options.cancellationToken?.reason));
                    return;
                }

                const asset = (bIsClass ? result.Class : result.Object) as T | undefined;
                try {
                    this.assertLoaded(key, entry, asset, result.bSuccess, result.ErrorMessage);
                    this.remember(key, entry, options, asset as CachedResource);
                    resolve({ key, entry, asset: asset as T, fromCache: false, requestId, status });
                } catch (error) {
                    reject(error);
                }
            };
            const delegate = toManualReleaseDelegate(callback);

            subsystem.OnAsyncLoadCompleted.Add(delegate as any);
            const unsubscribeCancellation = options.cancellationToken?.onCancellationRequested(() => {
                this.cancelAsync(requestId);
            });
            this.activeAsyncRequests.set(requestId, { subsystem, callback, delegate, unsubscribeCancellation });

            const errorMessage = $ref('');
            const accepted = bIsClass ? subsystem.RequestAsyncLoadClass(requestId, entry.path, errorMessage) : subsystem.RequestAsyncLoadObject(requestId, entry.path, errorMessage);

            if (!accepted) {
                this.cleanupAsyncRequest(requestId, false);
                const detail = $unref(errorMessage) || `path=${entry.path}`;
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

    private requireResourceSubsystem(worldContextObject: UE.Object): UE.UEHperResourceSubsystem {
        if (!worldContextObject) {
            throw new Error('WorldContextObject is required for async resource loading.');
        }

        const subsystem = UE.UEHperBridgeLibrary.GetResourceSubsystem(worldContextObject);
        if (!subsystem || !UE.UEHperBridgeLibrary.IsValidObject(subsystem)) {
            throw new Error('UEHperResourceSubsystem is not available for the current world context.');
        }

        return subsystem;
    }

    private cleanupAsyncRequest(requestId: string, releaseHandle: boolean): void {
        const active = this.activeAsyncRequests.get(requestId);
        if (!active) {
            return;
        }

        active.subsystem.OnAsyncLoadCompleted.Remove(active.delegate as any);
        releaseManualReleaseDelegate(active.callback);
        active.unsubscribeCancellation?.();
        if (releaseHandle) {
            active.subsystem.ReleaseAsyncLoadHandle(requestId);
        }
        this.activeAsyncRequests.delete(requestId);
    }

    private createRequestId(key: string): string {
        this.asyncRequestSeed += 1;
        const normalizedKey = key.replace(/[^A-Za-z0-9_]/g, '_');
        return `resource_${normalizedKey}_${Date.now()}_${this.asyncRequestSeed}`;
    }

    private async runPreloadBatch(
        keys: string[],
        groupName: string | undefined,
        options: ResourceAsyncPreloadOptions,
        loader: (key: string) => Promise<ResourceAsyncLoadResult<CachedResource>>,
    ): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
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

    private async executePreloadItems(
        keys: string[],
        groupName: string | undefined,
        options: ResourceAsyncPreloadOptions,
        loader: (key: string) => Promise<ResourceAsyncLoadResult<CachedResource>>,
    ): Promise<ResourceAsyncPreloadItemResult<CachedResource>[]> {
        const itemResults: Array<ResourceAsyncPreloadItemResult<CachedResource> | undefined> = new Array(keys.length);
        const concurrency = this.normalizePreloadConcurrency(options, keys.length);
        let nextIndex = 0;
        let completed = 0;
        let inFlight = 0;
        let succeeded = 0;
        let failed = 0;
        let shouldStop = false;

        const worker = async (): Promise<void> => {
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
                } catch (error) {
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
        return itemResults.filter((item): item is ResourceAsyncPreloadItemResult<CachedResource> => item != null);
    }

    private normalizePreloadConcurrency(options: ResourceAsyncPreloadOptions, total: number): number {
        if (total <= 0) {
            return 1;
        }
        const requested = Math.floor(options.concurrency ?? 1);
        return Math.max(1, Math.min(total, requested));
    }

    private emitPreloadProgress(
        groupName: string | undefined,
        options: ResourceAsyncPreloadOptions,
        key: string,
        index: number,
        completed: number,
        total: number,
        inFlight: number,
        concurrency: number,
        succeeded: number,
        failed: number,
        phase: ResourceAsyncPreloadProgressPhase,
        success: boolean | undefined,
        result: ResourceAsyncLoadResult<CachedResource> | undefined,
        error: unknown,
    ): void {
        options.onProgress?.({ groupName, phase, key, index, completed, total, inFlight, concurrency, succeeded, failed, success, result, error });
    }

    private createPreloadBatch<T>(groupName: string | undefined, keys: string[], results: ResourceAsyncPreloadItemResult<T>[]): ResourceAsyncPreloadBatchResult<T> {
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

    private requireEntry(key: string): ResourceManifestEntry {
        const entry = this.manifest.get(key);
        if (!entry) {
            throw new Error(`Resource not registered: ${key}`);
        }
        return entry;
    }

    private requirePreloadGroup(groupName: string): string[] {
        const keys = this.preloadGroups.get(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }
        return [...keys];
    }

    private getUsableCache<T extends CachedResource>(key: string, options: ResourceLoadOptions, entry: ResourceManifestEntry): T | undefined {
        if (!this.shouldCache(entry, options)) {
            return undefined;
        }

        const cached = this.cache.get(key) as T | undefined;
        if (!cached) {
            return undefined;
        }

        if (cached instanceof UE.Object && !UE.UEHperBridgeLibrary.IsValidObject(cached)) {
            this.cache.delete(key);
            return undefined;
        }

        return cached;
    }

    private remember(key: string, entry: ResourceManifestEntry, options: ResourceLoadOptions, asset: CachedResource): void {
        if (this.shouldCache(entry, options)) {
            this.cache.set(key, asset);
        }
    }

    private shouldCache(entry: ResourceManifestEntry, options: ResourceLoadOptions): boolean {
        return options.cache ?? entry.cache ?? true;
    }

    private isClassEntry(entry: ResourceManifestEntry): boolean {
        const type = entry.type.toLowerCase();
        return type === 'class' || type.endsWith('class') || entry.path.endsWith('_C');
    }

    private assertLoaded(key: string, entry: ResourceManifestEntry, asset: CachedResource | undefined, bSuccess: boolean, errorMessage: string): void {
        if (bSuccess && asset) {
            return;
        }

        const detail = errorMessage || `path=${entry.path}`;
        UE.UEHperBridgeLibrary.ReportFrameworkError('Resource.LoadFailed', `Resource load failed: ${key}`, detail);
        throw new Error(`Resource load failed: ${key}. ${detail}`);
    }
}

export class ResourceFacade {
    constructor(
        private readonly resources: ResourceService,
        private readonly worldContextObject: UE.Object,
    ) {}

    get root(): ResourceService {
        return this.resources;
    }

    setManifest(manifest: ResourceManifest): void {
        this.resources.setManifest(manifest);
    }

    setPreloadGroups(groups: ResourcePreloadGroups): void {
        this.resources.setPreloadGroups(groups);
    }

    register(key: string, entry: ResourceManifestEntry): void {
        this.resources.register(key, entry);
    }

    has(key: string): boolean {
        return this.resources.has(key);
    }

    registerPreloadGroup(groupName: string, keys: string[]): void {
        this.resources.registerPreloadGroup(groupName, keys);
    }

    getPreloadGroup(groupName: string): string[] | undefined {
        return this.resources.getPreloadGroup(groupName);
    }

    getEntry(key: string): ResourceManifestEntry | undefined {
        return this.resources.getEntry(key);
    }

    getCached<T extends CachedResource = CachedResource>(key: string): T | undefined {
        return this.resources.getCached<T>(key);
    }

    load<T extends CachedResource = CachedResource>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        return this.resources.load<T>(key, options);
    }

    loadObject<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        return this.resources.loadObject<T>(key, options);
    }

    loadClass<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<UE.Class> {
        return this.resources.loadClass<T>(key, options);
    }

    loadAsync<T extends CachedResource = CachedResource>(key: string, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        return this.resources.loadAsync<T>(key, this.worldContextObject, options);
    }

    loadObjectAsync<T extends UE.Object = UE.Object>(key: string, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        return this.resources.loadObjectAsync<T>(key, this.worldContextObject, options);
    }

    loadClassAsync<T extends UE.Object = UE.Object>(key: string, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<UE.Class>> {
        return this.resources.loadClassAsync<T>(key, this.worldContextObject, options);
    }

    createLoadTask<T extends CachedResource = CachedResource>(key: string, options: ResourceAsyncLoadOptions = {}): ResourceAsyncLoadTask<T> {
        return this.resources.createLoadTask<T>(key, this.worldContextObject, options);
    }

    createObjectLoadTask<T extends UE.Object = UE.Object>(key: string, options: ResourceAsyncLoadOptions = {}): ResourceAsyncLoadTask<T> {
        return this.resources.createObjectLoadTask<T>(key, this.worldContextObject, options);
    }

    createClassLoadTask<T extends UE.Object = UE.Object>(key: string, options: ResourceAsyncLoadOptions = {}): ResourceAsyncLoadTask<UE.Class> {
        return this.resources.createClassLoadTask<T>(key, this.worldContextObject, options);
    }

    preload(keys?: string[]): void {
        this.resources.preload(keys);
    }

    preloadGroup(groupName: string): void {
        this.resources.preloadGroup(groupName);
    }

    preloadAsync(keys?: string[], options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        return this.resources.preloadAsync(keys, this.worldContextObject, options);
    }

    preloadGroupAsync(groupName: string, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        return this.resources.preloadGroupAsync(groupName, this.worldContextObject, options);
    }

    preloadBatchAsync(keys?: string[], options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
        return this.resources.preloadBatchAsync(keys, this.worldContextObject, options);
    }

    preloadGroupBatchAsync(groupName: string, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
        return this.resources.preloadGroupBatchAsync(groupName, this.worldContextObject, options);
    }

    createSession(name: string): ResourceSessionFacade {
        return new ResourceSessionFacade(this.resources.createSession(name), this.worldContextObject);
    }

    retain(key: string): number {
        return this.resources.retain(key);
    }

    releaseReference(key: string): number {
        return this.resources.releaseReference(key);
    }

    getReferenceCount(key: string): number {
        return this.resources.getReferenceCount(key);
    }

    release(key: string): void {
        this.resources.release(key);
    }

    releaseAll(): void {
        this.resources.releaseAll();
    }

    cancelAsync(requestId: string): boolean {
        return this.resources.cancelAsync(requestId);
    }
}

export class ResourceSession {
    private readonly retainedKeys = new Set<string>();

    constructor(
        readonly name: string,
        private readonly resources: ResourceService,
    ) {
        if (!name) {
            throw new Error('ResourceSession name is empty.');
        }
    }

    load<T extends CachedResource = CachedResource>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        const result = this.resources.load<T>(key, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }

    loadObject<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        const result = this.resources.loadObject<T>(key, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }

    loadClass<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<UE.Class> {
        const result = this.resources.loadClass<T>(key, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }

    async loadAsync<T extends CachedResource = CachedResource>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        const result = await this.resources.loadAsync<T>(key, worldContextObject, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }

    async loadObjectAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        const result = await this.resources.loadObjectAsync<T>(key, worldContextObject, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }

    async loadClassAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<UE.Class>> {
        const result = await this.resources.loadClassAsync<T>(key, worldContextObject, { ...options, cache: options.cache ?? true });
        this.retain(key);
        return result;
    }

    preload(keys: string[]): void {
        for (const key of keys) {
            this.load(key, { cache: true });
        }
    }

    preloadGroup(groupName: string): void {
        const keys = this.resources.getPreloadGroup(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }

        this.preload(keys);
    }

    async preloadAsync(keys: string[], worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        const batch = await this.preloadBatchAsync(keys, worldContextObject, { ...options, collectErrors: false });
        return batch.succeeded.map((item) => item.result as ResourceAsyncLoadResult<CachedResource>);
    }

    preloadGroupAsync(groupName: string, worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        const keys = this.resources.getPreloadGroup(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }

        return this.preloadAsync(keys, worldContextObject, options);
    }

    async preloadBatchAsync(keys: string[], worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
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

    async preloadGroupBatchAsync(groupName: string, worldContextObject: UE.Object, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
        const keys = this.resources.getPreloadGroup(groupName);
        if (!keys) {
            throw new Error(`Resource preload group not registered: ${groupName}`);
        }

        const batch = await this.preloadBatchAsync(keys, worldContextObject, options);
        return { ...batch, groupName };
    }

    release(key: string): void {
        if (!this.retainedKeys.delete(key)) {
            return;
        }

        this.resources.releaseReference(key);
    }

    releaseAll(): void {
        for (const key of Array.from(this.retainedKeys)) {
            this.release(key);
        }
    }

    dispose(): void {
        this.releaseAll();
    }

    getRetainedKeys(): string[] {
        return Array.from(this.retainedKeys);
    }

    private retain(key: string): void {
        if (this.retainedKeys.has(key)) {
            return;
        }

        this.retainedKeys.add(key);
        this.resources.retain(key);
    }

    private createPreloadBatch<T>(groupName: string | undefined, keys: string[], results: ResourceAsyncPreloadItemResult<T>[]): ResourceAsyncPreloadBatchResult<T> {
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

    private async executePreloadItems(
        keys: string[],
        groupName: string | undefined,
        options: ResourceAsyncPreloadOptions,
        loader: (key: string) => Promise<ResourceAsyncLoadResult<CachedResource>>,
    ): Promise<ResourceAsyncPreloadItemResult<CachedResource>[]> {
        const itemResults: Array<ResourceAsyncPreloadItemResult<CachedResource> | undefined> = new Array(keys.length);
        const concurrency = this.normalizePreloadConcurrency(options, keys.length);
        let nextIndex = 0;
        let completed = 0;
        let inFlight = 0;
        let succeeded = 0;
        let failed = 0;
        let shouldStop = false;

        const worker = async (): Promise<void> => {
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
                } catch (error) {
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
        return itemResults.filter((item): item is ResourceAsyncPreloadItemResult<CachedResource> => item != null);
    }

    private normalizePreloadConcurrency(options: ResourceAsyncPreloadOptions, total: number): number {
        if (total <= 0) {
            return 1;
        }
        const requested = Math.floor(options.concurrency ?? 1);
        return Math.max(1, Math.min(total, requested));
    }

    private emitPreloadProgress(
        groupName: string | undefined,
        options: ResourceAsyncPreloadOptions,
        key: string,
        index: number,
        completed: number,
        total: number,
        inFlight: number,
        concurrency: number,
        succeeded: number,
        failed: number,
        phase: ResourceAsyncPreloadProgressPhase,
        success: boolean | undefined,
        result: ResourceAsyncLoadResult<CachedResource> | undefined,
        error: unknown,
    ): void {
        options.onProgress?.({ groupName, phase, key, index, completed, total, inFlight, concurrency, succeeded, failed, success, result, error });
    }
}

export class ResourceSessionFacade {
    constructor(
        private readonly session: ResourceSession,
        private readonly worldContextObject: UE.Object,
    ) {}

    get name(): string {
        return this.session.name;
    }

    get root(): ResourceSession {
        return this.session;
    }

    load<T extends CachedResource = CachedResource>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        return this.session.load<T>(key, options);
    }

    loadObject<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<T> {
        return this.session.loadObject<T>(key, options);
    }

    loadClass<T extends UE.Object = UE.Object>(key: string, options: ResourceLoadOptions = {}): ResourceLoadResult<UE.Class> {
        return this.session.loadClass<T>(key, options);
    }

    loadAsync<T extends CachedResource = CachedResource>(key: string, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        return this.session.loadAsync<T>(key, this.worldContextObject, options);
    }

    loadObjectAsync<T extends UE.Object = UE.Object>(key: string, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<T>> {
        return this.session.loadObjectAsync<T>(key, this.worldContextObject, options);
    }

    loadClassAsync<T extends UE.Object = UE.Object>(key: string, options: ResourceAsyncLoadOptions = {}): Promise<ResourceAsyncLoadResult<UE.Class>> {
        return this.session.loadClassAsync<T>(key, this.worldContextObject, options);
    }

    preload(keys: string[]): void {
        this.session.preload(keys);
    }

    preloadGroup(groupName: string): void {
        this.session.preloadGroup(groupName);
    }

    preloadAsync(keys: string[], options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        return this.session.preloadAsync(keys, this.worldContextObject, options);
    }

    preloadGroupAsync(groupName: string, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncLoadResult<CachedResource>[]> {
        return this.session.preloadGroupAsync(groupName, this.worldContextObject, options);
    }

    preloadBatchAsync(keys: string[], options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
        return this.session.preloadBatchAsync(keys, this.worldContextObject, options);
    }

    preloadGroupBatchAsync(groupName: string, options: ResourceAsyncPreloadOptions = {}): Promise<ResourceAsyncPreloadBatchResult<CachedResource>> {
        return this.session.preloadGroupBatchAsync(groupName, this.worldContextObject, options);
    }

    release(key: string): void {
        this.session.release(key);
    }

    releaseAll(): void {
        this.session.releaseAll();
    }

    dispose(): void {
        this.session.dispose();
    }

    getRetainedKeys(): string[] {
        return this.session.getRetainedKeys();
    }
}
