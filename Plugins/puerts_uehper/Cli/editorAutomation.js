const path = require("path");
const fs = require("fs");
const {
    info,
    fail,
    normalizePath,
    quoteArg,
} = require("./shared");
const {
    createCliOptions,
} = require("./args");
const {
    runChildProcess,
    runPollingProcess,
} = require("./processRunner");
const { findUnrealEditor } = require("./context");
const {
    addResourceManifestEntry,
    addUiManifestEntry,
} = require("./manifest");
const {
    normalizeUnrealPackagePath,
    getGamePackageFilePath,
} = require("./unrealPaths");

function getDefaultUIValidationWidgetPath() {
    return "/Game/UEHper/UI/WBP_UIValidation";
}

async function runEnsureUIValidationWidget(context, explicitWidgetPath, options = createCliOptions()) {
    const editorPath = findUnrealEditor(context.engineAssociation, options);
    if (!editorPath) {
        fail("Unable to locate UnrealEditor.exe. Pass --editor=E:\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor.exe or set UE_EDITOR.");
    }

    const widgetPath = normalizeUnrealPackagePath(explicitWidgetPath || options.getOptionValue("--ui-validation-widget") || getDefaultUIValidationWidgetPath());
    const timeoutMs = Number(options.getOptionValue("--ensure-ui-validation-timeout-ms") || options.getOptionValue("--timeout-ms") || 300000);
    const widgetFilePath = getGamePackageFilePath(context, widgetPath, ".uasset");
    if (!widgetPath.startsWith("/Game/")) {
        fail(`UI validation widget must be a /Game package path. Received: ${widgetPath}`);
    }

    const args = [
        context.uprojectPath,
        "-NullRHI",
        "-Unattended",
        "-NoSplash",
        `-UEHperEnsureUIValidationWidget=${widgetPath}`,
        "-log",
    ];

    info(`Ensuring UI validation widget: ${widgetPath}`);
    info(`Running: ${quoteArg(editorPath)} ${args.map(quoteArg).join(" ")}`);
    if (!options.isDryRun()) {
        const exitCode = await runChildProcess(editorPath, args, context.projectRoot, timeoutMs, { cleanupShaderCompileWorkersOnTimeout: true });
        const existsAfterRun = widgetFilePath && fs.existsSync(widgetFilePath);
        if (exitCode !== 0 || !existsAfterRun) {
            fail(`UI validation widget ensure failed. ExitCode=${exitCode} WidgetFile=${normalizePath(widgetFilePath || "")}`);
        }
        info(`UI validation widget ready: ${normalizePath(path.relative(context.projectRoot, widgetFilePath))}`);
    }

    addResourceManifestEntry(context, "UEHperUIValidationClass", "WidgetClass", `${widgetPath}.${path.posix.basename(widgetPath)}_C`, options);
    addUiManifestEntry(context, "UEHperUIValidation", "UEHperUIValidationClass", "Diagnostics", options);

    return { success: true, widgetPath, filePath: widgetFilePath };
}

function readLatestProjectLog(context) {
    const logsDir = path.join(context.projectRoot, "Saved", "Logs");
    if (!fs.existsSync(logsDir)) {
        return "";
    }

    const latestLog = fs.readdirSync(logsDir)
        .filter((entry) => entry.endsWith(".log"))
        .map((entry) => path.join(logsDir, entry))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];

    return latestLog && fs.existsSync(latestLog) ? fs.readFileSync(latestLog, "utf-8") : "";
}

async function runGenTypings(context, options = createCliOptions()) {
    const editorPath = findUnrealEditor(context.engineAssociation, options);
    if (!editorPath) {
        fail("Unable to locate UnrealEditor.exe. Pass --editor=E:\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor.exe or set UE_EDITOR.");
    }

    const mode = (options.getOptionValue("--mode") || "FULL").toUpperCase();
    const keepEditor = options.hasOption("--keep-editor");
    const timeoutMs = Number(options.getOptionValue("--timeout-ms") || 600000);
    const beforeTypingMtime = fs.existsSync(context.projectTypingUE) ? fs.statSync(context.projectTypingUE).mtimeMs : 0;
    const args = [
        context.uprojectPath,
        "-NullRHI",
        "-Unattended",
        "-NoSplash",
        `-UEHperRunPuertsGen=${mode}`,
        "-log",
    ];

    if (keepEditor) {
        args.push("-UEHperNoExitAfterPuertsGen");
    }

    info(`Running: ${quoteArg(editorPath)} ${args.map(quoteArg).join(" ")}`);
    if (options.isDryRun()) {
        return;
    }

    await runPollingProcess(editorPath, args, context.projectRoot, timeoutMs, async (processState) => {
        const typingsReady = fs.existsSync(context.projectTypingUE) && fs.existsSync(context.projectTypingUEBP);
        const afterTypingMtime = typingsReady ? fs.statSync(context.projectTypingUE).mtimeMs : 0;
        const latestLog = readLatestProjectLog(context);

        if (typingsReady && afterTypingMtime > beforeTypingMtime && latestLog.includes("Puerts.Gen execution result: true")) {
            info("Puerts typings generation finished.");
            if (!keepEditor) {
                processState.kill();
            }
            return { done: true };
        }

        if (latestLog.includes("Puerts.Gen was not available")) {
            processState.kill();
            fail("Puerts.Gen was not available after editor startup. Check plugin load state and Saved/Logs.");
        }

        if (processState.exited && !typingsReady) {
            fail(`UnrealEditor exited before typings were generated. ExitCode=${processState.exitCode}`);
        }

        return undefined;
    }, {
        killOnTimeout: !keepEditor,
        timeoutMessage: `Timed out waiting for Puerts typings generation after ${timeoutMs}ms. Check Saved/Logs for UEHper and Puerts.Gen output.`,
    });
}

module.exports = {
    runEnsureUIValidationWidget,
    runGenTypings,
};