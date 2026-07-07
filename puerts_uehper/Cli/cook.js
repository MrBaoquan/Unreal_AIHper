const path = require("path");
const fs = require("fs");
const {
    info,
    warn,
    fail,
    normalizePath,
    quoteArg,
} = require("./shared");
const {
    createCliOptions,
} = require("./args");
const { runChildProcess } = require("./processRunner");
const {
    findUnrealEditor,
    findUnrealEditorCmd,
} = require("./context");
const {
    normalizeUnrealPackagePath,
    getGamePackageFilePath,
} = require("./unrealPaths");

function readProjectConfigText(context) {
    return ["DefaultEngine.ini", "DefaultGame.ini"]
        .map((fileName) => path.join(context.projectRoot, "Config", fileName))
        .filter((filePath) => fs.existsSync(filePath))
        .map((filePath) => fs.readFileSync(filePath, "utf-8"))
        .join("\n");
}

function readConfigValue(content, key) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escapedKey}=([^\r\n]+)$`, "im");
    const match = content.match(pattern);
    return match ? match[1].trim() : "";
}

function getDefaultCookSmokeMapPath() {
    return "/Game/UEHper/CookSmoke";
}

function cookSmokeMapFileExists(context, mapPath) {
    const filePath = getGamePackageFilePath(context, mapPath, ".umap");
    return !!filePath && fs.existsSync(filePath);
}

function getDefaultCookMap(context, options) {
    const content = readProjectConfigText(context);
    if (options.hasOption("--cook-smoke")) {
        return normalizeUnrealPackagePath(options.getOptionValue("--cook-smoke-map") || options.getOptionValue("--cook-map") || getDefaultCookSmokeMapPath());
    }
    return normalizeUnrealPackagePath(options.getOptionValue("--cook-map") || readConfigValue(content, "GameDefaultMap") || readConfigValue(content, "EditorStartupMap"));
}

function buildCookCommandletArgs(context, options = createCliOptions()) {
    const targetPlatform = options.getOptionValue("--cook-platform") || "Windows";
    const timeoutMs = Number(options.getOptionValue("--cook-timeout-ms") || options.getOptionValue("--timeout-ms") || 1200000);
    const isSmokeCook = options.hasOption("--cook-smoke");
    const mapPath = getDefaultCookMap(context, options);
    if (!mapPath) {
        fail("Unable to determine Cook map. Set GameDefaultMap in Config/DefaultEngine.ini or pass --cook-map=/Game/...");
    }

    const args = [
        context.uprojectPath,
        "-run=Cook",
        `-TargetPlatform=${targetPlatform}`,
        `-Map=${mapPath}`,
        "-unattended",
        "-nop4",
        "-NullRHI",
        "-NoLogTimes",
        "-UTF8Output",
    ];
    if (isSmokeCook) {
        args.push("-CookSinglePackage", "-iterate", "-SkipCookingEditorContent");
    }

    return {
        targetPlatform,
        mapPath,
        timeoutMs,
        args,
    };
}

async function runCookDoctor(context, options = createCliOptions()) {
    const editorCmdPath = findUnrealEditorCmd(context.engineAssociation, options);
    if (!editorCmdPath) {
        fail("Unable to locate UnrealEditor-Cmd.exe. Pass --editor-cmd=E:\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe or set UE_EDITOR_CMD.");
    }

    const cookCommand = buildCookCommandletArgs(context, options);
    if (options.hasOption("--cook-smoke") && cookCommand.mapPath.startsWith("/Game/") && !cookSmokeMapFileExists(context, cookCommand.mapPath)) {
        await runEnsureCookSmokeMap(context, cookCommand.mapPath, options);
    }

    const smokeLabel = options.hasOption("--cook-smoke") ? " mode=smoke" : "";
    info(`Cook commandlet:${smokeLabel} platform=${cookCommand.targetPlatform} map=${cookCommand.mapPath} timeoutMs=${cookCommand.timeoutMs}`);
    info(`Running: ${quoteArg(editorCmdPath)} ${cookCommand.args.map(quoteArg).join(" ")}`);
    if (options.isDryRun()) {
        return { success: true, exitCode: 0, targetPlatform: cookCommand.targetPlatform, mapPath: cookCommand.mapPath };
    }

    const exitCode = await runChildProcess(editorCmdPath, cookCommand.args, context.projectRoot, cookCommand.timeoutMs, { cleanupShaderCompileWorkersOnTimeout: true });
    const success = exitCode === 0;
    if (success) {
        info(`Cook commandlet finished: ExitCode=${exitCode}`);
    } else {
        warn(`Cook commandlet failed: ExitCode=${exitCode}`);
    }
    return { success, exitCode, targetPlatform: cookCommand.targetPlatform, mapPath: cookCommand.mapPath };
}

async function runEnsureCookSmokeMap(context, explicitMapPath, options = createCliOptions()) {
    const editorPath = findUnrealEditor(context.engineAssociation, options);
    if (!editorPath) {
        fail("Unable to locate UnrealEditor.exe. Pass --editor=E:\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor.exe or set UE_EDITOR.");
    }

    const mapPath = normalizeUnrealPackagePath(explicitMapPath || options.getOptionValue("--cook-smoke-map") || options.getOptionValue("--cook-map") || getDefaultCookSmokeMapPath());
    const timeoutMs = Number(options.getOptionValue("--ensure-cook-smoke-timeout-ms") || options.getOptionValue("--timeout-ms") || 300000);
    const mapFilePath = getGamePackageFilePath(context, mapPath, ".umap");
    if (!mapPath.startsWith("/Game/")) {
        fail(`CookSmoke map must be a /Game package path. Received: ${mapPath}`);
    }

    if (mapFilePath && fs.existsSync(mapFilePath)) {
        info(`CookSmoke map exists: ${normalizePath(path.relative(context.projectRoot, mapFilePath))}`);
        return { success: true, mapPath, filePath: mapFilePath, exitCode: 0 };
    }

    const args = [
        context.uprojectPath,
        "-NullRHI",
        "-Unattended",
        "-NoSplash",
        `-UEHperEnsureCookSmokeMap=${mapPath}`,
        "-log",
    ];

    info(`Ensuring CookSmoke map: ${mapPath}`);
    info(`Running: ${quoteArg(editorPath)} ${args.map(quoteArg).join(" ")}`);
    if (options.isDryRun()) {
        return { success: true, mapPath, filePath: mapFilePath, exitCode: 0 };
    }

    const exitCode = await runChildProcess(editorPath, args, context.projectRoot, timeoutMs, { cleanupShaderCompileWorkersOnTimeout: true });
    const existsAfterRun = mapFilePath && fs.existsSync(mapFilePath);
    if (exitCode !== 0 || !existsAfterRun) {
        fail(`CookSmoke map ensure failed. ExitCode=${exitCode} MapFile=${normalizePath(mapFilePath || "")}`);
    }

    info(`CookSmoke map ready: ${normalizePath(path.relative(context.projectRoot, mapFilePath))}`);
    return { success: true, mapPath, filePath: mapFilePath, exitCode };
}

module.exports = {
    buildCookCommandletArgs,
    runCookDoctor,
    runEnsureCookSmokeMap,
};