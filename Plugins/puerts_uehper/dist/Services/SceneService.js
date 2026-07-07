"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneService = void 0;
const UE = require("ue");
const puerts_1 = require("puerts");
function delay(ms) {
    if (ms <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
}
class SceneService {
    constructor(worldContextObject) {
        this.worldContextObject = worldContextObject;
        this.manifest = new Map();
        this.latentActionId = 1;
    }
    setManifest(manifest) {
        this.manifest.clear();
        for (const key of Object.keys(manifest)) {
            this.register(key, manifest[key]);
        }
    }
    register(key, entry) {
        if (!key) {
            throw new Error('Scene key is empty.');
        }
        if (!entry?.levelName) {
            throw new Error(`Scene levelName is empty: ${key}`);
        }
        this.manifest.set(key, { ...entry });
    }
    has(key) {
        return this.manifest.has(key);
    }
    getEntry(key) {
        const entry = this.manifest.get(key);
        return entry ? { ...entry } : undefined;
    }
    open(context, key) {
        const entry = this.requireEntry(key);
        this.openLevel(context, entry.levelName);
    }
    async transition(context, key, options = {}) {
        const preparation = await this.prepareOpen(context, key, options);
        try {
            this.openPrepared(context, preparation);
        }
        catch (error) {
            const loadingOptions = this.resolveLoadingOptions(preparation.entry, options.loadingUI);
            if (loadingOptions.closeOnFailure !== false) {
                await this.closeLoadingUI(context, preparation, loadingOptions.waitForTransition ?? true);
            }
            throw error;
        }
    }
    async transitionToLevel(context, levelName, options = {}) {
        const preparation = await this.prepareOpenLevel(context, levelName, options);
        try {
            this.openPrepared(context, preparation);
        }
        catch (error) {
            const loadingOptions = this.resolveLoadingOptions(undefined, options.loadingUI);
            if (loadingOptions.closeOnFailure !== false) {
                await this.closeLoadingUI(context, preparation, loadingOptions.waitForTransition ?? true);
            }
            throw error;
        }
    }
    async prepareOpen(context, key, options = {}) {
        const entry = this.requireEntry(key);
        return this.prepareOpenInternal(context, entry.levelName, key, entry, options);
    }
    async prepareOpenLevel(context, levelName, options = {}) {
        return this.prepareOpenInternal(context, levelName, undefined, undefined, options);
    }
    openPrepared(context, preparation) {
        this.openLevel(context, preparation.levelName);
    }
    async closeLoadingUI(context, preparation, waitForTransition = true) {
        if (!preparation.loadingUiKey) {
            return;
        }
        const ui = context.services.get('ui');
        await ui.closeAsync(preparation.loadingUiKey, { waitForTransition });
    }
    openLevel(context, levelName) {
        if (!levelName) {
            throw new Error('Scene levelName is empty.');
        }
        const errorMessage = (0, puerts_1.$ref)('');
        const worldContextObject = this.worldContextObject ?? context.world;
        const success = UE.UEHperBridgeLibrary.OpenLevelSafe(worldContextObject ?? null, levelName, errorMessage);
        if (!success) {
            const detail = (0, puerts_1.$unref)(errorMessage) || `levelName=${levelName}`;
            UE.UEHperBridgeLibrary.ReportFrameworkError('Scene.OpenLevelFailed', `Open level failed: ${levelName}`, detail);
            throw new Error(`Open level failed: ${levelName}. ${detail}`);
        }
    }
    getStreamingLevel(context, levelName) {
        const worldContextObject = this.resolveWorldContextObject(context);
        return UE.GameplayStatics.GetStreamingLevel(worldContextObject, levelName);
    }
    async loadStreamingLevel(context, levelName, options = {}) {
        this.requireLevelName(levelName);
        const worldContextObject = this.resolveWorldContextObject(context);
        const makeVisibleAfterLoad = options.makeVisibleAfterLoad ?? true;
        const waitForLoaded = options.waitForLoaded ?? true;
        const waitForVisible = options.waitForVisible ?? makeVisibleAfterLoad;
        UE.GameplayStatics.LoadStreamLevel(worldContextObject, levelName, makeVisibleAfterLoad, options.shouldBlockOnLoad ?? false, this.createLatentActionInfo());
        if (!waitForLoaded && !waitForVisible) {
            return this.getStreamingLevelResult(context, levelName, false);
        }
        return this.waitForStreamingLevel(context, levelName, (streamingLevel) => {
            const loaded = streamingLevel?.IsLevelLoaded() ?? false;
            const visible = streamingLevel?.IsLevelVisible() ?? false;
            return (!waitForLoaded || loaded) && (!waitForVisible || visible);
        }, options);
    }
    async unloadStreamingLevel(context, levelName, options = {}) {
        this.requireLevelName(levelName);
        const worldContextObject = this.resolveWorldContextObject(context);
        UE.GameplayStatics.UnloadStreamLevel(worldContextObject, levelName, this.createLatentActionInfo(), options.shouldBlockOnUnload ?? false);
        if (options.waitForLoaded === false) {
            return this.getStreamingLevelResult(context, levelName, false);
        }
        return this.waitForStreamingLevel(context, levelName, (streamingLevel) => !(streamingLevel?.IsLevelLoaded() ?? false), options);
    }
    async loadStreamingLevelInstance(context, levelName, options = {}) {
        this.requireLevelName(levelName);
        const worldContextObject = this.resolveWorldContextObject(context);
        const success = (0, puerts_1.$ref)(false);
        const streamingLevel = UE.LevelStreamingDynamic.LoadLevelInstance(worldContextObject, levelName, options.location ?? UE.Vector.ZeroVector, options.rotation ?? UE.Rotator.ZeroRotator, success, options.instanceName ?? '', undefined, options.loadAsTempPackage ?? false);
        if (!(0, puerts_1.$unref)(success)) {
            throw new Error(`Failed to create streaming level instance: ${levelName}`);
        }
        const waitForLoaded = options.waitForLoaded ?? true;
        const waitForVisible = options.waitForVisible ?? true;
        if (!waitForLoaded && !waitForVisible) {
            return this.getStreamingLevelObjectResult(levelName, streamingLevel, false);
        }
        return this.waitForStreamingLevelObject(levelName, streamingLevel, (currentStreamingLevel) => {
            const loaded = currentStreamingLevel?.IsLevelLoaded() ?? false;
            const visible = currentStreamingLevel?.IsLevelVisible() ?? false;
            return (!waitForLoaded || loaded) && (!waitForVisible || visible);
        }, options);
    }
    async unloadStreamingLevelInstance(context, streamingLevel, options = {}) {
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
    async loadStreamingForScene(context, key, options = {}) {
        const entry = this.requireEntry(key);
        const streamingLevels = entry.streamingLevels ?? [];
        const results = [];
        for (const streamingLevel of streamingLevels) {
            results.push(await this.loadStreamingLevel(context, streamingLevel.levelName, options));
        }
        return results;
    }
    async unloadStreamingForScene(context, key, options = {}) {
        const entry = this.requireEntry(key);
        const streamingLevels = [...(entry.streamingLevels ?? [])].reverse();
        const results = [];
        for (const streamingLevel of streamingLevels) {
            results.push(await this.unloadStreamingLevel(context, streamingLevel.levelName, options));
        }
        return results;
    }
    async prepareOpenInternal(context, levelName, key, entry, options) {
        if (!levelName) {
            throw new Error('Scene levelName is empty.');
        }
        const loadingOptions = this.resolveLoadingOptions(entry, options.loadingUI);
        const loadingUiKey = loadingOptions.key;
        const startedAt = Date.now();
        if (loadingUiKey) {
            const ui = context.services.get('ui');
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
    async preloadForScene(context, entry, options) {
        const resourceKeys = options?.resourceKeys ?? entry?.preloadResourceKeys ?? [];
        const groups = options?.groups ?? entry?.preloadGroups ?? [];
        if (resourceKeys.length === 0 && groups.length === 0) {
            return [];
        }
        const resources = context.services.get('worldResources');
        const preloadOptions = {
            collectErrors: options?.collectErrors ?? true,
            concurrency: options?.concurrency ?? 1,
            onProgress: options?.onProgress,
        };
        const batches = [];
        if (resourceKeys.length > 0) {
            batches.push(await resources.preloadBatchAsync(resourceKeys, preloadOptions));
        }
        for (const groupName of groups) {
            batches.push(await resources.preloadGroupBatchAsync(groupName, preloadOptions));
        }
        return batches;
    }
    resolveLoadingOptions(entry, options) {
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
    requireEntry(key) {
        const entry = this.manifest.get(key);
        if (!entry) {
            throw new Error(`Scene is not registered: ${key}`);
        }
        return entry;
    }
    requireLevelName(levelName) {
        if (!levelName) {
            throw new Error('Scene levelName is empty.');
        }
    }
    resolveWorldContextObject(context) {
        const worldContextObject = this.worldContextObject ?? context.world;
        if (!worldContextObject) {
            throw new Error('SceneService requires a valid World context.');
        }
        return worldContextObject;
    }
    createLatentActionInfo() {
        const latentActionInfo = new UE.LatentActionInfo();
        latentActionInfo.Linkage = 0;
        latentActionInfo.UUID = this.latentActionId++;
        latentActionInfo.ExecutionFunction = '';
        return latentActionInfo;
    }
    getStreamingLevelResult(context, levelName, timedOut) {
        const streamingLevel = this.getStreamingLevel(context, levelName);
        return {
            levelName,
            streamingLevel,
            loaded: streamingLevel?.IsLevelLoaded() ?? false,
            visible: streamingLevel?.IsLevelVisible() ?? false,
            timedOut,
        };
    }
    getStreamingLevelObjectResult(levelName, streamingLevel, timedOut) {
        return {
            levelName,
            streamingLevel,
            loaded: streamingLevel?.IsLevelLoaded() ?? false,
            visible: streamingLevel?.IsLevelVisible() ?? false,
            timedOut,
        };
    }
    async waitForStreamingLevel(context, levelName, predicate, options) {
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
    async waitForStreamingLevelObject(levelName, streamingLevel, predicate, options) {
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
    dispose() {
        this.manifest.clear();
    }
}
exports.SceneService = SceneService;
//# sourceMappingURL=SceneService.js.map