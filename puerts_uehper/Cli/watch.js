const fs = require("fs");
const { spawn } = require("child_process");
const {
    info,
    fail,
    normalizePath,
    quoteArg,
} = require("./shared");
const { createCliOptions } = require("./args");
const { runSyncRuntime } = require("./bootstrap");

function assertWatchPrerequisites(context) {
    if (!fs.existsSync(context.projectTypingUE) || !fs.existsSync(context.projectTypingUEBP)) {
        fail("Puerts typing files are not generated yet. Run `npx --no-install puerts_uehper gen-typings` first.");
    }

    if (!fs.existsSync(context.rootTypescriptCompiler)) {
        fail("Local TypeScript compiler is missing. Run bootstrap or npm install first.");
    }

    if (!fs.existsSync(context.rootTsConfigPath)) {
        fail(`Project tsconfig.json is missing: ${normalizePath(context.rootTsConfigPath)}`);
    }

    if (!fs.existsSync(context.projectTypescriptDir)) {
        fail(`Project TypeScript source directory is missing: ${normalizePath(context.projectTypescriptDir)}`);
    }
}

function formatWatchCommand(context) {
    return [
        quoteArg(process.execPath),
        quoteArg(context.rootTypescriptCompiler),
        "--build",
        quoteArg(context.rootTsConfigPath),
        "--watch",
        "--preserveWatchOutput",
    ].join(" ");
}

function runProjectWatch(context, options = createCliOptions()) {
    assertWatchPrerequisites(context);

    if (!options.hasOption("--no-sync-runtime")) {
        runSyncRuntime(context, options);
    }

    const sourceRoot = context.projectLayout?.sourceRoot || "TypeScript";
    info(`Watching business TypeScript: ${sourceRoot}/**/* -> Content/JavaScript`);
    info("Framework package source is not rebuilt by this watcher; run build:package for puerts_uehper changes.");

    const commandLine = formatWatchCommand(context);
    info(`Running: ${commandLine}`);
    if (options.isDryRun()) {
        return { success: true, exitCode: 0 };
    }

    const args = [
        context.rootTypescriptCompiler,
        "--build",
        context.rootTsConfigPath,
        "--watch",
        "--preserveWatchOutput",
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: context.projectRoot,
            stdio: "inherit",
            windowsHide: false,
        });

        child.on("error", reject);
        child.on("exit", (code) => {
            const exitCode = code || 0;
            resolve({ success: exitCode === 0, exitCode });
        });
    });
}

module.exports = {
    assertWatchPrerequisites,
    formatWatchCommand,
    runProjectWatch,
};