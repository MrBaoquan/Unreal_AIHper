import * as puerts from 'puerts';
import { toManualReleaseDelegate } from 'puerts';
import { FrameworkApp } from './FrameworkApp';

const runtimeSubsystem = puerts.argv.getByName('RuntimeSubsystem') as any;
const entryModule = runtimeSubsystem?.GetEntryModule?.() || 'Game/GameApp';

const app = new FrameworkApp();
(globalThis as any).__uehperApp = app;

const lifecycleDelegates: unknown[] = [];
(globalThis as any).__uehperLifecycleDelegates = lifecycleDelegates;

// Mirror of EUEHperRuntimeState (Plugins/Unreal.AIHper/UEHper/Source/UEHper/Public/UEHperRuntimeSubsystem.h).
// Keep order in sync; LexToString in C++ uses the same labels.
const RUNTIME_STATE_NAMES = ['Uninitialized', 'Initializing', 'RuntimeReady', 'FrameworkLoaded', 'AppCreated', 'Running', 'Failed', 'ShuttingDown', 'Shutdown'];

function nameOfRuntimeState(value: unknown): string {
    if (typeof value === 'number') {
        return RUNTIME_STATE_NAMES[value] ?? `Unknown(${value})`;
    }
    return value === undefined || value === null ? 'Unknown' : String(value);
}

let lastRuntimeState: unknown = undefined;
(globalThis as any).__uehperGetRuntimeState = () => ({
    raw: lastRuntimeState,
    name: nameOfRuntimeState(lastRuntimeState),
});

function bindRuntimeStateObserver(runtime: any): void {
    if (!runtime?.OnUEHperRuntimeStateChanged?.Add) {
        return;
    }
    const delegate = toManualReleaseDelegate((oldState: unknown, newState: unknown) => {
        lastRuntimeState = newState;
        console.log(`[uehper] RuntimeState ${nameOfRuntimeState(oldState)} -> ${nameOfRuntimeState(newState)}`);
    });
    lifecycleDelegates.push(delegate);
    runtime.OnUEHperRuntimeStateChanged.Add(delegate);
    try {
        if (typeof runtime.GetRuntimeState === 'function') {
            lastRuntimeState = runtime.GetRuntimeState();
        }
    } catch (error) {
        console.warn(`[uehper] GetRuntimeState() probe failed: ${error}`);
    }
}

bindRuntimeStateObserver(runtimeSubsystem);

function bindLifecycleDelegate(runtimeEvent: any, callback: (...args: any[]) => void): void {
    if (!runtimeEvent?.Add) {
        return;
    }

    const delegate = toManualReleaseDelegate(callback);
    lifecycleDelegates.push(delegate);
    runtimeEvent.Add(delegate);
}

function bindRuntimeLifecycle(runtime: any): void {
    if (!runtime) {
        console.warn('[uehper] RuntimeSubsystem is not available; world lifecycle bridge disabled');
        return;
    }

    bindLifecycleDelegate(runtime.OnUEHperWorldInitialized, (world: unknown, worldInfo: any) => {
        void app.notifyWorldInitialized(world, worldInfo).catch((error) => {
            console.error(`[uehper] notifyWorldInitialized failed: ${error}`);
        });
    });

    bindLifecycleDelegate(runtime.OnUEHperWorldBeginPlay, (world: unknown, worldInfo: any) => {
        void app.notifyWorldBeginPlay(world, worldInfo).catch((error) => {
            console.error(`[uehper] notifyWorldBeginPlay failed: ${error}`);
        });
    });

    bindLifecycleDelegate(runtime.OnUEHperWorldTick, (world: unknown, worldInfo: any, deltaSeconds: number) => {
        try {
            app.notifyWorldTick(world, worldInfo, deltaSeconds);
        } catch (error) {
            console.error(`[uehper] notifyWorldTick failed: ${error}`);
        }
    });

    bindLifecycleDelegate(runtime.OnUEHperWorldCleanup, (world: unknown, worldInfo: any) => {
        void app.notifyWorldCleanup(world, worldInfo).catch((error) => {
            console.error(`[uehper] notifyWorldCleanup failed: ${error}`);
        });
    });

    bindLifecycleDelegate(runtime.OnUEHperNetworkFailure, (world: unknown, failureInfo: any) => {
        void app.notifyNetworkFailure(world, failureInfo).catch((error) => {
            console.error(`[uehper] notifyNetworkFailure failed: ${error}`);
        });
    });

    bindLifecycleDelegate(runtime.OnUEHperRuntimeShutdown, () => {
        void app.shutdown().catch((error) => {
            console.error(`[uehper] shutdown failed: ${error}`);
        });
    });
}

app.initialize({
    runtimeSubsystem,
    entryModule,
})
    .then(() => {
        bindRuntimeLifecycle(runtimeSubsystem);
        try {
            runtimeSubsystem?.NotifyBootstrapResult?.(true, '');
        } catch (notifyError) {
            console.warn(`[uehper] NotifyBootstrapResult(true) failed: ${notifyError}`);
        }
        console.log('[uehper] Framework bootstrap completed');
    })
    .catch((error) => {
        const detail = (error && (error.stack || error.message)) || String(error);
        console.error(`[uehper] Framework bootstrap failed: ${detail}`);
        try {
            runtimeSubsystem?.NotifyBootstrapResult?.(false, detail);
        } catch (notifyError) {
            console.warn(`[uehper] NotifyBootstrapResult(false) failed: ${notifyError}`);
        }
    });

export default app;
