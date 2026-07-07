import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import type { FrameworkContext } from '../Framework/FrameworkContext';
import type { ResourceAsyncPreloadBatchResult, ResourceAsyncPreloadProgress, ResourceFacade } from './ResourceService';
import type { UIService } from './UIService';

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

export interface SceneOpenOptions extends ScenePrepareOpenOptions {}

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

function delay(ms: number): Promise<void> {
    if (ms <= 0) {
        return Promise.resolve();
    }

    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SceneService {
    private readonly manifest = new Map<string, SceneManifestEntry>();
    private latentActionId = 1;

    constructor(private readonly worldContextObject?: UE.Object) {}

    setManifest(manifest: SceneManifest): void {
        this.manifest.clear();
        for (const key of Object.keys(manifest)) {
            this.register(key, manifest[key]);
        }
    }

    register(key: string, entry: SceneManifestEntry): void {
        if (!key) {
            throw new Error('Scene key is empty.');
        }
        if (!entry?.levelName) {
            throw new Error(`Scene levelName is empty: ${key}`);
        }

        this.manifest.set(key, { ...entry });
    }

    has(key: string): boolean {
        return this.manifest.has(key);
    }

    getEntry(key: string): SceneManifestEntry | undefined {
        const entry = this.manifest.get(key);
        return entry ? { ...entry } : undefined;
    }

    open(context: FrameworkContext, key: string): void {
        const entry = this.requireEntry(key);
        this.openLevel(context, entry.levelName);
    }

    async transition(context: FrameworkContext, key: string, options: SceneOpenOptions = {}): Promise<void> {
        const preparation = await this.prepareOpen(context, key, options);
        try {
            this.openPrepared(context, preparation);
        } catch (error) {
            const loadingOptions = this.resolveLoadingOptions(preparation.entry, options.loadingUI);
            if (loadingOptions.closeOnFailure !== false) {
                await this.closeLoadingUI(context, preparation, loadingOptions.waitForTransition ?? true);
            }
            throw error;
        }
    }

    async transitionToLevel(context: FrameworkContext, levelName: string, options: SceneOpenOptions = {}): Promise<void> {
        const preparation = await this.prepareOpenLevel(context, levelName, options);
        try {
            this.openPrepared(context, preparation);
        } catch (error) {
            const loadingOptions = this.resolveLoadingOptions(undefined, options.loadingUI);
            if (loadingOptions.closeOnFailure !== false) {
                await this.closeLoadingUI(context, preparation, loadingOptions.waitForTransition ?? true);
            }
            throw error;
        }
    }

    async prepareOpen(context: FrameworkContext, key: string, options: ScenePrepareOpenOptions = {}): Promise<ScenePreparationResult> {
        const entry = this.requireEntry(key);
        return this.prepareOpenInternal(context, entry.levelName, key, entry, options);
    }

    async prepareOpenLevel(context: FrameworkContext, levelName: string, options: ScenePrepareOpenOptions = {}): Promise<ScenePreparationResult> {
        return this.prepareOpenInternal(context, levelName, undefined, undefined, options);
    }

    openPrepared(context: FrameworkContext, preparation: ScenePreparationResult): void {
        this.openLevel(context, preparation.levelName);
    }

    async closeLoadingUI(context: FrameworkContext, preparation: ScenePreparationResult, waitForTransition = true): Promise<void> {
        if (!preparation.loadingUiKey) {
            return;
        }

        const ui = context.services.get<UIService>('ui');
        await ui.closeAsync(preparation.loadingUiKey, { waitForTransition });
    }

    openLevel(context: FrameworkContext, levelName: string): void {
        if (!levelName) {
            throw new Error('Scene levelName is empty.');
        }

        const errorMessage = $ref('');
        const worldContextObject = this.worldContextObject ?? (context.world as UE.Object | undefined);
        const success = UE.UEHperBridgeLibrary.OpenLevelSafe(worldContextObject ?? null, levelName, errorMessage);
        if (!success) {
            const detail = $unref(errorMessage) || `levelName=${levelName}`;
            UE.UEHperBridgeLibrary.ReportFrameworkError('Scene.OpenLevelFailed', `Open level failed: ${levelName}`, detail);
            throw new Error(`Open level failed: ${levelName}. ${detail}`);
        }
    }

    getStreamingLevel(context: FrameworkContext, levelName: string): UE.LevelStreaming | undefined {
        const worldContextObject = this.resolveWorldContextObject(context);
        return UE.GameplayStatics.GetStreamingLevel(worldContextObject, levelName) as UE.LevelStreaming | undefined;
    }

    async loadStreamingLevel(context: FrameworkContext, levelName: string, options: SceneStreamingLevelOptions = {}): Promise<SceneStreamingLevelResult> {
        this.requireLevelName(levelName);
        const worldContextObject = this.resolveWorldContextObject(context);
        const makeVisibleAfterLoad = options.makeVisibleAfterLoad ?? true;
        const waitForLoaded = options.waitForLoaded ?? true;
        const waitForVisible = options.waitForVisible ?? makeVisibleAfterLoad;
        UE.GameplayStatics.LoadStreamLevel(worldContextObject, levelName, makeVisibleAfterLoad, options.shouldBlockOnLoad ?? false, this.createLatentActionInfo());

        if (!waitForLoaded && !waitForVisible) {
            return this.getStreamingLevelResult(context, levelName, false);
        }

        return this.waitForStreamingLevel(
            context,
            levelName,
            (streamingLevel) => {
                const loaded = streamingLevel?.IsLevelLoaded() ?? false;
                const visible = streamingLevel?.IsLevelVisible() ?? false;
                return (!waitForLoaded || loaded) && (!waitForVisible || visible);
            },
            options,
        );
    }

    async unloadStreamingLevel(context: FrameworkContext, levelName: string, options: SceneStreamingLevelOptions = {}): Promise<SceneStreamingLevelResult> {
        this.requireLevelName(levelName);
        const worldContextObject = this.resolveWorldContextObject(context);
        UE.GameplayStatics.UnloadStreamLevel(worldContextObject, levelName, this.createLatentActionInfo(), options.shouldBlockOnUnload ?? false);

        if (options.waitForLoaded === false) {
            return this.getStreamingLevelResult(context, levelName, false);
        }

        return this.waitForStreamingLevel(context, levelName, (streamingLevel) => !(streamingLevel?.IsLevelLoaded() ?? false), options);
    }

    async loadStreamingLevelInstance(context: FrameworkContext, levelName: string, options: SceneStreamingLevelInstanceOptions = {}): Promise<SceneStreamingLevelResult> {
        this.requireLevelName(levelName);
        const worldContextObject = this.resolveWorldContextObject(context);
        const success = $ref(false);
        const streamingLevel = UE.LevelStreamingDynamic.LoadLevelInstance(
            worldContextObject,
            levelName,
            options.location ?? UE.Vector.ZeroVector,
            options.rotation ?? UE.Rotator.ZeroRotator,
            success,
            options.instanceName ?? '',
            undefined,
            options.loadAsTempPackage ?? false,
        );

        if (!$unref(success)) {
            throw new Error(`Failed to create streaming level instance: ${levelName}`);
        }

        const waitForLoaded = options.waitForLoaded ?? true;
        const waitForVisible = options.waitForVisible ?? true;
        if (!waitForLoaded && !waitForVisible) {
            return this.getStreamingLevelObjectResult(levelName, streamingLevel, false);
        }

        return this.waitForStreamingLevelObject(
            levelName,
            streamingLevel,
            (currentStreamingLevel) => {
                const loaded = currentStreamingLevel?.IsLevelLoaded() ?? false;
                const visible = currentStreamingLevel?.IsLevelVisible() ?? false;
                return (!waitForLoaded || loaded) && (!waitForVisible || visible);
            },
            options,
        );
    }

    async unloadStreamingLevelInstance(context: FrameworkContext, streamingLevel: UE.LevelStreaming, options: SceneStreamingLevelOptions = {}): Promise<SceneStreamingLevelResult> {
        if (!streamingLevel) {
            throw new Error('SceneService requires a valid streaming level instance.');
        }

        const levelName = streamingLevel.GetWorldAssetPackageFName();
        streamingLevel.SetShouldBeVisible(false);
        streamingLevel.SetShouldBeLoaded(false);
        streamingLevel.SetIsRequestingUnloadAndRemoval(true);

        if (options.waitForLoaded === false) {
            return this.getStreamingLevelObjectResult(levelName, streamingLevel, false);
        }

        return this.waitForStreamingLevelObject(levelName, streamingLevel, (currentStreamingLevel) => !(currentStreamingLevel?.IsLevelLoaded() ?? false), options);
    }

    async loadStreamingForScene(context: FrameworkContext, key: string, options: SceneStreamingLevelOptions = {}): Promise<SceneStreamingLevelResult[]> {
        const entry = this.requireEntry(key);
        const streamingLevels = entry.streamingLevels ?? [];
        const results: SceneStreamingLevelResult[] = [];
        for (const streamingLevel of streamingLevels) {
            results.push(await this.loadStreamingLevel(context, streamingLevel.levelName, options));
        }
        return results;
    }

    async unloadStreamingForScene(context: FrameworkContext, key: string, options: SceneStreamingLevelOptions = {}): Promise<SceneStreamingLevelResult[]> {
        const entry = this.requireEntry(key);
        const streamingLevels = [...(entry.streamingLevels ?? [])].reverse();
        const results: SceneStreamingLevelResult[] = [];
        for (const streamingLevel of streamingLevels) {
            results.push(await this.unloadStreamingLevel(context, streamingLevel.levelName, options));
        }
        return results;
    }

    private async prepareOpenInternal(context: FrameworkContext, levelName: string, key: string | undefined, entry: SceneManifestEntry | undefined, options: ScenePrepareOpenOptions): Promise<ScenePreparationResult> {
        if (!levelName) {
            throw new Error('Scene levelName is empty.');
        }

        const loadingOptions = this.resolveLoadingOptions(entry, options.loadingUI);
        const loadingUiKey = loadingOptions.key;
        const startedAt = Date.now();
        if (loadingUiKey) {
            const ui = context.services.get<UIService>('ui');
            await ui.openAsync(context, loadingUiKey, { waitForTransition: loadingOptions.waitForTransition ?? true });
        }

        const preloadBatches = await this.preloadForScene(context, entry, options.preload);
        const elapsed = Date.now() - startedAt;
        await delay((loadingOptions.minDurationMs ?? 0) - elapsed);

        return {
            key,
            entry: entry ? { ...entry } : undefined,
            levelName,
            loadingUiKey,
            preloadedKeys: preloadBatches.flatMap((batch) => batch.succeeded.map((item) => item.key)),
            preloadBatches,
        };
    }

    private async preloadForScene(context: FrameworkContext, entry: SceneManifestEntry | undefined, options: ScenePreloadOptions | undefined): Promise<ResourceAsyncPreloadBatchResult<UE.Object | UE.Class>[]> {
        const resourceKeys = options?.resourceKeys ?? entry?.preloadResourceKeys ?? [];
        const groups = options?.groups ?? entry?.preloadGroups ?? [];
        if (resourceKeys.length === 0 && groups.length === 0) {
            return [];
        }

        const resources = context.services.get<ResourceFacade>('worldResources');
        const preloadOptions = {
            collectErrors: options?.collectErrors ?? true,
            concurrency: options?.concurrency ?? 1,
            onProgress: options?.onProgress,
        };
        const batches: ResourceAsyncPreloadBatchResult<UE.Object | UE.Class>[] = [];
        if (resourceKeys.length > 0) {
            batches.push(await resources.preloadBatchAsync(resourceKeys, preloadOptions));
        }
        for (const groupName of groups) {
            batches.push(await resources.preloadGroupBatchAsync(groupName, preloadOptions));
        }

        return batches;
    }

    private resolveLoadingOptions(entry: SceneManifestEntry | undefined, options: string | SceneLoadingUIOptions | undefined): SceneLoadingUIOptions {
        if (typeof options === 'string') {
            return { key: options };
        }

        return {
            key: options?.key ?? entry?.loadingUi,
            waitForTransition: options?.waitForTransition,
            minDurationMs: options?.minDurationMs,
            closeOnFailure: options?.closeOnFailure,
        };
    }

    private requireEntry(key: string): SceneManifestEntry {
        const entry = this.manifest.get(key);
        if (!entry) {
            throw new Error(`Scene is not registered: ${key}`);
        }
        return entry;
    }

    private requireLevelName(levelName: string): void {
        if (!levelName) {
            throw new Error('Scene levelName is empty.');
        }
    }

    private resolveWorldContextObject(context: FrameworkContext): UE.Object {
        const worldContextObject = this.worldContextObject ?? (context.world as UE.Object | undefined);
        if (!worldContextObject) {
            throw new Error('SceneService requires a valid World context.');
        }
        return worldContextObject;
    }

    private createLatentActionInfo(): UE.LatentActionInfo {
        const latentActionInfo = new UE.LatentActionInfo();
        latentActionInfo.Linkage = 0;
        latentActionInfo.UUID = this.latentActionId++;
        latentActionInfo.ExecutionFunction = '';
        return latentActionInfo;
    }

    private getStreamingLevelResult(context: FrameworkContext, levelName: string, timedOut: boolean): SceneStreamingLevelResult {
        const streamingLevel = this.getStreamingLevel(context, levelName);
        return {
            levelName,
            streamingLevel,
            loaded: streamingLevel?.IsLevelLoaded() ?? false,
            visible: streamingLevel?.IsLevelVisible() ?? false,
            timedOut,
        };
    }

    private getStreamingLevelObjectResult(levelName: string, streamingLevel: UE.LevelStreaming | undefined, timedOut: boolean): SceneStreamingLevelResult {
        return {
            levelName,
            streamingLevel,
            loaded: streamingLevel?.IsLevelLoaded() ?? false,
            visible: streamingLevel?.IsLevelVisible() ?? false,
            timedOut,
        };
    }

    private async waitForStreamingLevel(
        context: FrameworkContext,
        levelName: string,
        predicate: (streamingLevel: UE.LevelStreaming | undefined) => boolean,
        options: SceneStreamingLevelOptions,
    ): Promise<SceneStreamingLevelResult> {
        const timeoutMs = options.timeoutMs ?? 30000;
        const pollIntervalMs = options.pollIntervalMs ?? 50;
        const startedAt = Date.now();
        while (Date.now() - startedAt <= timeoutMs) {
            const streamingLevel = this.getStreamingLevel(context, levelName);
            if (predicate(streamingLevel)) {
                return this.getStreamingLevelResult(context, levelName, false);
            }
            await delay(pollIntervalMs);
        }

        return this.getStreamingLevelResult(context, levelName, true);
    }

    private async waitForStreamingLevelObject(
        levelName: string,
        streamingLevel: UE.LevelStreaming | undefined,
        predicate: (streamingLevel: UE.LevelStreaming | undefined) => boolean,
        options: SceneStreamingLevelOptions,
    ): Promise<SceneStreamingLevelResult> {
        const timeoutMs = options.timeoutMs ?? 30000;
        const pollIntervalMs = options.pollIntervalMs ?? 50;
        const startedAt = Date.now();
        while (Date.now() - startedAt <= timeoutMs) {
            if (predicate(streamingLevel)) {
                return this.getStreamingLevelObjectResult(levelName, streamingLevel, false);
            }
            await delay(pollIntervalMs);
        }

        return this.getStreamingLevelObjectResult(levelName, streamingLevel, true);
    }

    dispose(): void {
        this.manifest.clear();
    }
}
