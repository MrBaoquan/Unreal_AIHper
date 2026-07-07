import * as UE from 'ue';
import { type CancellationToken } from '../Framework/Cancellation';
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
export declare class ResourceAsyncPreloadError<T> extends Error {
    readonly batch: ResourceAsyncPreloadBatchResult<T>;
    constructor(batch: ResourceAsyncPreloadBatchResult<T>);
}
type CachedResource = UE.Object | UE.Class;
export declare class ResourceService {
    private readonly manifest;
    private readonly preloadGroups;
    private readonly cache;
    private readonly referenceCounts;
    private readonly activeAsyncRequests;
    private asyncRequestSeed;
    setManifest(manifest: ResourceManifest): void;
    setPreloadGroups(groups: ResourcePreloadGroups): void;
    register(key: string, entry: ResourceManifestEntry): void;
    has(key: string): boolean;
    registerPreloadGroup(groupName: string, keys: string[]): void;
    getPreloadGroup(groupName: string): string[] | undefined;
    getEntry(key: string): ResourceManifestEntry | undefined;
    getCached<T extends CachedResource = CachedResource>(key: string): T | undefined;
    load<T extends CachedResource = CachedResource>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadObject<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadAsync<T extends CachedResource = CachedResource>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadObjectAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadClassAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<UE.Class>>;
    createLoadTask<T extends CachedResource = CachedResource>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): ResourceAsyncLoadTask<T>;
    createObjectLoadTask<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): ResourceAsyncLoadTask<T>;
    createClassLoadTask<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): ResourceAsyncLoadTask<UE.Class>;
    loadClass<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<UE.Class>;
    preload(keys?: string[]): void;
    preloadGroup(groupName: string): void;
    preloadAsync(keys: string[] | undefined, worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadGroupAsync(groupName: string, worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadBatchAsync(keys: string[] | undefined, worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    preloadGroupBatchAsync(groupName: string, worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    cancelAsync(requestId: string): boolean;
    createSession(name: string): ResourceSession;
    retain(key: string): number;
    releaseReference(key: string): number;
    getReferenceCount(key: string): number;
    release(key: string): void;
    releaseAll(): void;
    dispose(): void;
    private createAsyncLoadTask;
    private requireResourceSubsystem;
    private cleanupAsyncRequest;
    private createRequestId;
    private runPreloadBatch;
    private executePreloadItems;
    private normalizePreloadConcurrency;
    private emitPreloadProgress;
    private createPreloadBatch;
    private requireEntry;
    private requirePreloadGroup;
    private getUsableCache;
    private remember;
    private shouldCache;
    private isClassEntry;
    private assertLoaded;
}
export declare class ResourceFacade {
    private readonly resources;
    private readonly worldContextObject;
    constructor(resources: ResourceService, worldContextObject: UE.Object);
    get root(): ResourceService;
    setManifest(manifest: ResourceManifest): void;
    setPreloadGroups(groups: ResourcePreloadGroups): void;
    register(key: string, entry: ResourceManifestEntry): void;
    has(key: string): boolean;
    registerPreloadGroup(groupName: string, keys: string[]): void;
    getPreloadGroup(groupName: string): string[] | undefined;
    getEntry(key: string): ResourceManifestEntry | undefined;
    getCached<T extends CachedResource = CachedResource>(key: string): T | undefined;
    load<T extends CachedResource = CachedResource>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadObject<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadClass<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<UE.Class>;
    loadAsync<T extends CachedResource = CachedResource>(key: string, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadObjectAsync<T extends UE.Object = UE.Object>(key: string, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadClassAsync<T extends UE.Object = UE.Object>(key: string, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<UE.Class>>;
    createLoadTask<T extends CachedResource = CachedResource>(key: string, options?: ResourceAsyncLoadOptions): ResourceAsyncLoadTask<T>;
    createObjectLoadTask<T extends UE.Object = UE.Object>(key: string, options?: ResourceAsyncLoadOptions): ResourceAsyncLoadTask<T>;
    createClassLoadTask<T extends UE.Object = UE.Object>(key: string, options?: ResourceAsyncLoadOptions): ResourceAsyncLoadTask<UE.Class>;
    preload(keys?: string[]): void;
    preloadGroup(groupName: string): void;
    preloadAsync(keys?: string[], options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadGroupAsync(groupName: string, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadBatchAsync(keys?: string[], options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    preloadGroupBatchAsync(groupName: string, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    createSession(name: string): ResourceSessionFacade;
    retain(key: string): number;
    releaseReference(key: string): number;
    getReferenceCount(key: string): number;
    release(key: string): void;
    releaseAll(): void;
    cancelAsync(requestId: string): boolean;
}
export declare class ResourceSession {
    readonly name: string;
    private readonly resources;
    private readonly retainedKeys;
    constructor(name: string, resources: ResourceService);
    load<T extends CachedResource = CachedResource>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadObject<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadClass<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<UE.Class>;
    loadAsync<T extends CachedResource = CachedResource>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadObjectAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadClassAsync<T extends UE.Object = UE.Object>(key: string, worldContextObject: UE.Object, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<UE.Class>>;
    preload(keys: string[]): void;
    preloadGroup(groupName: string): void;
    preloadAsync(keys: string[], worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadGroupAsync(groupName: string, worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadBatchAsync(keys: string[], worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    preloadGroupBatchAsync(groupName: string, worldContextObject: UE.Object, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    release(key: string): void;
    releaseAll(): void;
    dispose(): void;
    getRetainedKeys(): string[];
    private retain;
    private createPreloadBatch;
    private executePreloadItems;
    private normalizePreloadConcurrency;
    private emitPreloadProgress;
}
export declare class ResourceSessionFacade {
    private readonly session;
    private readonly worldContextObject;
    constructor(session: ResourceSession, worldContextObject: UE.Object);
    get name(): string;
    get root(): ResourceSession;
    load<T extends CachedResource = CachedResource>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadObject<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<T>;
    loadClass<T extends UE.Object = UE.Object>(key: string, options?: ResourceLoadOptions): ResourceLoadResult<UE.Class>;
    loadAsync<T extends CachedResource = CachedResource>(key: string, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadObjectAsync<T extends UE.Object = UE.Object>(key: string, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<T>>;
    loadClassAsync<T extends UE.Object = UE.Object>(key: string, options?: ResourceAsyncLoadOptions): Promise<ResourceAsyncLoadResult<UE.Class>>;
    preload(keys: string[]): void;
    preloadGroup(groupName: string): void;
    preloadAsync(keys: string[], options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadGroupAsync(groupName: string, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncLoadResult<CachedResource>[]>;
    preloadBatchAsync(keys: string[], options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    preloadGroupBatchAsync(groupName: string, options?: ResourceAsyncPreloadOptions): Promise<ResourceAsyncPreloadBatchResult<CachedResource>>;
    release(key: string): void;
    releaseAll(): void;
    dispose(): void;
    getRetainedKeys(): string[];
}
export {};
//# sourceMappingURL=ResourceService.d.ts.map