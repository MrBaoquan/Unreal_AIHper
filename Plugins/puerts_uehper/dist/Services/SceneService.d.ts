import * as UE from 'ue';
import type { FrameworkContext } from '../Framework/FrameworkContext';
import type { ResourceAsyncPreloadBatchResult, ResourceAsyncPreloadProgress } from './ResourceService';
export interface SceneManifestEntry {
    levelName: string;
    mapPath?: string;
    displayName?: string;
    loadingUi?: string;
    preloadResourceKeys?: string[];
    preloadGroups?: string[];
    streamingLevels?: SceneStreamingLevelEntry[];
}
export interface SceneStreamingLevelEntry {
    levelName: string;
    displayName?: string;
}
export type SceneManifest = Record<string, SceneManifestEntry>;
export interface SceneLoadingUIOptions {
    key?: string;
    waitForTransition?: boolean;
    minDurationMs?: number;
    closeOnFailure?: boolean;
}
export interface ScenePreloadOptions {
    resourceKeys?: string[];
    groups?: string[];
    concurrency?: number;
    collectErrors?: boolean;
    onProgress?: (progress: ResourceAsyncPreloadProgress<UE.Object | UE.Class>) => void;
}
export interface ScenePrepareOpenOptions {
    loadingUI?: string | SceneLoadingUIOptions;
    preload?: ScenePreloadOptions;
}
export interface SceneOpenOptions extends ScenePrepareOpenOptions {
}
export interface ScenePreparationResult {
    key?: string;
    entry?: SceneManifestEntry;
    levelName: string;
    loadingUiKey?: string;
    preloadedKeys: string[];
    preloadBatches: ResourceAsyncPreloadBatchResult<UE.Object | UE.Class>[];
}
export interface SceneStreamingLevelOptions {
    makeVisibleAfterLoad?: boolean;
    shouldBlockOnLoad?: boolean;
    shouldBlockOnUnload?: boolean;
    waitForLoaded?: boolean;
    waitForVisible?: boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
}
export interface SceneStreamingLevelInstanceOptions extends SceneStreamingLevelOptions {
    location?: UE.Vector;
    rotation?: UE.Rotator;
    instanceName?: string;
    loadAsTempPackage?: boolean;
}
export interface SceneStreamingLevelResult {
    levelName: string;
    streamingLevel?: UE.LevelStreaming;
    loaded: boolean;
    visible: boolean;
    timedOut: boolean;
}
export declare class SceneService {
    private readonly worldContextObject?;
    private readonly manifest;
    private latentActionId;
    constructor(worldContextObject?: UE.Object);
    setManifest(manifest: SceneManifest): void;
    register(key: string, entry: SceneManifestEntry): void;
    has(key: string): boolean;
    getEntry(key: string): SceneManifestEntry | undefined;
    open(context: FrameworkContext, key: string): void;
    transition(context: FrameworkContext, key: string, options?: SceneOpenOptions): Promise<void>;
    transitionToLevel(context: FrameworkContext, levelName: string, options?: SceneOpenOptions): Promise<void>;
    prepareOpen(context: FrameworkContext, key: string, options?: ScenePrepareOpenOptions): Promise<ScenePreparationResult>;
    prepareOpenLevel(context: FrameworkContext, levelName: string, options?: ScenePrepareOpenOptions): Promise<ScenePreparationResult>;
    openPrepared(context: FrameworkContext, preparation: ScenePreparationResult): void;
    closeLoadingUI(context: FrameworkContext, preparation: ScenePreparationResult, waitForTransition?: boolean): Promise<void>;
    openLevel(context: FrameworkContext, levelName: string): void;
    getStreamingLevel(context: FrameworkContext, levelName: string): UE.LevelStreaming | undefined;
    loadStreamingLevel(context: FrameworkContext, levelName: string, options?: SceneStreamingLevelOptions): Promise<SceneStreamingLevelResult>;
    unloadStreamingLevel(context: FrameworkContext, levelName: string, options?: SceneStreamingLevelOptions): Promise<SceneStreamingLevelResult>;
    loadStreamingLevelInstance(context: FrameworkContext, levelName: string, options?: SceneStreamingLevelInstanceOptions): Promise<SceneStreamingLevelResult>;
    unloadStreamingLevelInstance(context: FrameworkContext, streamingLevel: UE.LevelStreaming, options?: SceneStreamingLevelOptions): Promise<SceneStreamingLevelResult>;
    loadStreamingForScene(context: FrameworkContext, key: string, options?: SceneStreamingLevelOptions): Promise<SceneStreamingLevelResult[]>;
    unloadStreamingForScene(context: FrameworkContext, key: string, options?: SceneStreamingLevelOptions): Promise<SceneStreamingLevelResult[]>;
    private prepareOpenInternal;
    private preloadForScene;
    private resolveLoadingOptions;
    private requireEntry;
    private requireLevelName;
    private resolveWorldContextObject;
    private createLatentActionInfo;
    private getStreamingLevelResult;
    private getStreamingLevelObjectResult;
    private waitForStreamingLevel;
    private waitForStreamingLevelObject;
    dispose(): void;
}
//# sourceMappingURL=SceneService.d.ts.map