const path = require("path");
const { createCliOptions } = require("./args");
const {
    warn,
    fail,
    normalizePath,
} = require("./shared");
const {
    runDoctor,
    runAssetRegistryDoctor,
    runWatchRuntimeState,
} = require("./doctor");
const {
    runBootstrap,
    runBuild,
    runSyncRuntime,
} = require("./bootstrap");
const { runProjectWatch } = require("./watch");
const {
    setManifestDependencies,
    runManifest,
} = require("./manifest");
const {
    setScaffoldDependencies,
    ensureProjectManifests,
    runInit,
    runMake,
} = require("./scaffold");
const {
    runCookDoctor,
    runEnsureCookSmokeMap,
} = require("./cook");
const {
    runEnsureUIValidationWidget,
    runGenTypings,
} = require("./editorAutomation");
const { runSmoke } = require("./smoke");

const commandHandlers = {
    install(context, options) {
        const report = runDoctor(context);
        if (!report.checks.backendReady) {
            fail(`Puerts backend is missing. Expected ${report.expectedBackendDir} under ${normalizePath(path.join(context.puertsPath, "ThirdParty"))}`);
        }

        runBootstrap(context, options);

        if (report.checks.typingsReady) {
            runBuild(context, options);
        } else {
            warn("Bootstrap completed, but Typing/ue declarations are still missing. Run: node uehper.js gen-typings");
        }
    },

    async doctor(context, options) {
        // Stage 7.0: --watch-runtime-state 进入实时监控模式，跳过常规 doctor 报告。
        if (options.hasOption("--watch-runtime-state")) {
            return await runWatchRuntimeState(context, options);
        }
        const report = runDoctor(context);
        let assetRegistryResult = { success: true };
        let cookResult = { success: true };
        if (options.hasOption("--asset-registry")) {
            assetRegistryResult = await runAssetRegistryDoctor(context, report, options);
        }
        if (options.hasOption("--cook")) {
            cookResult = await runCookDoctor(context, options);
        }
        const success = Object.values(report.checks).every(Boolean) && assetRegistryResult.success && cookResult.success;
        return { success, exitCode: success ? 0 : 1 };
    },

    bootstrap(context, options) {
        runBootstrap(context, options);
    },

    init(context, options) {
        runInit(context, options);
    },

    make(context, options) {
        runMake(context, options);
    },

    manifest(context, options) {
        runManifest(context, options);
    },

    async "ensure-cook-smoke-map"(context, options) {
        await runEnsureCookSmokeMap(context, undefined, options);
    },

    async "ensure-ui-validation-widget"(context, options) {
        await runEnsureUIValidationWidget(context, undefined, options);
    },

    smoke(context) {
        runSmoke(context);
    },

    build(context, options) {
        runBuild(context, options);
    },

    async watch(context, options) {
        return await runProjectWatch(context, options);
    },

    "sync-runtime"(context, options) {
        runSyncRuntime(context, options);
    },

    async "gen-typings"(context, options) {
        await runGenTypings(context, options);
    },
};

const supportedCommands = new Set(["help", ...Object.keys(commandHandlers)]);

function configureCommandDependencies() {
    setManifestDependencies({ ensureProjectManifests });
    setScaffoldDependencies({ runBootstrap });
}

function isSupportedCommand(command) {
    return supportedCommands.has(command);
}

function canDispatchCommand(command) {
    return Object.prototype.hasOwnProperty.call(commandHandlers, command);
}

function normalizeCommandResult(result) {
    if (result === false) {
        return { success: false, exitCode: 1 };
    }

    if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "success")) {
        const success = result.success !== false;
        return {
            ...result,
            success,
            exitCode: Number.isInteger(result.exitCode) ? result.exitCode : (success ? 0 : 1),
        };
    }

    return { success: true, exitCode: 0 };
}

async function runCommand(command, context, options = createCliOptions()) {
    const handler = commandHandlers[command];
    if (!handler) {
        return { success: false, exitCode: 1 };
    }
    return normalizeCommandResult(await handler(context, options));
}

module.exports = {
    configureCommandDependencies,
    isSupportedCommand,
    canDispatchCommand,
    normalizeCommandResult,
    runCommand,
};
