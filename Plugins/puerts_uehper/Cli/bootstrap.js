const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const {
    info,
    fail,
    normalizePath,
    ensureDir,
    writeTextFile,
    writeTextFileIfMissing,
    materializeFrameworkDirectory,
    copyFolderRecursiveSync,
    readJson,
    writeJson,
} = require("./shared");
const {
    createCliOptions,
} = require("./args");
const { getDoctorReport } = require("./doctor");

const scriptRoot = path.resolve(__dirname, "..");

const rootPackageTemplate = `{
    "name": "puerts_uehper",
    "version": "1.0.0",
    "description": "",
    "main": "index.js",
    "dependencies": {
        "@types/lodash": "^4.14.198",
        "lodash": "^4.17.21",
        "property-watch-decorator": "^1.2.5",
        "reflect-metadata": "^0.1.13",
        "rxjs": "^7.5.7",
        "ts-singleton": "^1.0.2",
        "typescript": "^4.8.4"
    },
    "scripts": {
        "test": "echo \\\"Error: no test specified\\\" && exit 1"
    },
    "author": "",
    "license": "ISC",
    "devDependencies": {
        "@types/node": "^20.5.9"
    }
}
`;

function createRootTsConfigTemplate(sourceRoot = "TypeScript") {
    return `{
    "compilerOptions": {
        "target": "esnext",
        "module": "commonjs",
        "experimentalDecorators": true,
        "jsx": "react",
        "sourceMap": true,
        "typeRoots": ["Plugins/Puerts/Typing", "./node_modules/@types"],
        "outDir": "Content/JavaScript"
    },
    "include": ["${sourceRoot}/**/*"],
    "exclude": ["${sourceRoot}/puerts_uehper/IOToolkit/**/*", "Plugins/Puerts/Typing/**/*.d.ts"]
}
`;
}

function ensureArrayContains(items, requiredItems) {
    const existing = Array.isArray(items) ? [...items] : [];
    for (const requiredItem of requiredItems) {
        if (!existing.includes(requiredItem)) {
            existing.push(requiredItem);
        }
    }

    return existing;
}

function rewriteTsConfig(tsconfigPath, context, options) {
    const tsconfig = fs.existsSync(tsconfigPath) ? readJson(tsconfigPath) : {};
    tsconfig.compilerOptions = tsconfig.compilerOptions || {};
    tsconfig.compilerOptions.target = tsconfig.compilerOptions.target || "esnext";
    tsconfig.compilerOptions.module = tsconfig.compilerOptions.module || "commonjs";
    tsconfig.compilerOptions.experimentalDecorators = true;
    tsconfig.compilerOptions.useDefineForClassFields = false;
    tsconfig.compilerOptions.jsx = tsconfig.compilerOptions.jsx || "react";
    tsconfig.compilerOptions.sourceMap = true;
    const sourceRoot = context.projectLayout?.sourceRoot || "TypeScript";
    tsconfig.compilerOptions.baseUrl = tsconfig.compilerOptions.baseUrl || sourceRoot;
    tsconfig.compilerOptions.paths = tsconfig.compilerOptions.paths || {};
    if (context.projectLayout?.frameworkSource === "package") {
        const packageDistIndex = normalizePath(path.relative(context.projectTypescriptDir, path.join(context.projectFrameworkPackageDir, "dist", "index")));
        const packageDistWildcard = normalizePath(path.relative(context.projectTypescriptDir, path.join(context.projectFrameworkPackageDir, "dist", "*")));
        tsconfig.compilerOptions.paths["puerts_uehper"] = [packageDistIndex];
        tsconfig.compilerOptions.paths["puerts_uehper/*"] = [packageDistWildcard];
    } else {
        tsconfig.compilerOptions.paths["puerts_uehper"] = ["puerts_uehper/index"];
        tsconfig.compilerOptions.paths["puerts_uehper/*"] = ["puerts_uehper/*"];
    }
    const appDir = context.projectLayout?.appDir || "Game";
    if (appDir === ".") {
        delete tsconfig.compilerOptions.paths["Game/*"];
    } else {
        const appAlias = `${appDir}/*`;
        tsconfig.compilerOptions.paths[appAlias] = tsconfig.compilerOptions.paths[appAlias] || [`${appDir}/*`];
        if (appDir !== "Game") {
            delete tsconfig.compilerOptions.paths["Game/*"];
        }
    }
    tsconfig.compilerOptions.outDir = tsconfig.compilerOptions.outDir || "Content/JavaScript";
    tsconfig.compilerOptions.typeRoots = ensureArrayContains(tsconfig.compilerOptions.typeRoots, [
        "Typing",
        "./node_modules/@types",
    ]);

    tsconfig.include = ensureArrayContains(tsconfig.include, [`${sourceRoot}/**/*`]);
    const excludes = [
        `${sourceRoot}/puerts_uehper/IOToolkit/**/*`,
        "Typing/**/*.d.ts",
    ];
    if (context.projectLayout?.frameworkSource === "package") {
        excludes.push(`${sourceRoot}/puerts_uehper/**/*`);
    }
    tsconfig.exclude = ensureArrayContains(tsconfig.exclude, excludes);

    writeJson(tsconfigPath, tsconfig, { cliOptions: options });
}

function copyPackageFile(sourcePath, targetPath, options) {
    if (!fs.existsSync(sourcePath)) {
        return;
    }

    if (options.isDryRun()) {
        info(`[dry-run] Copy file: ${normalizePath(sourcePath)} -> ${normalizePath(targetPath)}`);
        return;
    }

    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
}

function writePackageBinShim(projectRoot, commandName, options) {
    const binDir = path.join(projectRoot, "node_modules", ".bin");
    const packageBin = path.join("..", "puerts_uehper", "uehper.js");
    const shellPath = path.join(binDir, commandName);
    const cmdPath = `${shellPath}.cmd`;
    const ps1Path = `${shellPath}.ps1`;

    if (options.isDryRun()) {
        info(`[dry-run] Write bin shim: ${normalizePath(shellPath)}`);
        info(`[dry-run] Write bin shim: ${normalizePath(cmdPath)}`);
        info(`[dry-run] Write bin shim: ${normalizePath(ps1Path)}`);
        return;
    }

    ensureDir(binDir);
    fs.writeFileSync(shellPath, `#!/usr/bin/env sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")
exec node "$basedir/${packageBin.replace(/\\/g, "/")}" "$@"
`, "utf-8");
    fs.chmodSync(shellPath, 0o755);
    fs.writeFileSync(cmdPath, `@ECHO off
SETLOCAL
node "%~dp0\\..\\puerts_uehper\\uehper.js" %*
`, "utf-8");
    fs.writeFileSync(ps1Path, `#!/usr/bin/env pwsh
& node "$PSScriptRoot/../puerts_uehper/uehper.js" @args
`, "utf-8");
}

function materializePackageBinShims(context, options) {
    writePackageBinShim(context.projectRoot, "puerts-uehper", options);
    writePackageBinShim(context.projectRoot, "puerts_uehper", options);
}

function materializePackageInstall(context, options) {
    const packageRoot = context.frameworkPackageRoot;
    const distDir = path.join(packageRoot, "dist");
    if (!hasRuntimePackageEntrypoints(distDir)) {
        fail(`Package dist is missing or incomplete: ${normalizePath(distDir)}. Run npm run build:package under the framework package first.`);
    }

    const targetDir = context.projectFrameworkPackageDir;
    info(`Materializing framework package into ${normalizePath(targetDir)}`);
    if (!options.isDryRun()) {
        ensureDir(targetDir);
    }
    copyFolderRecursiveSync(distDir, path.join(targetDir, "dist"), { cliOptions: options });

    for (const fileName of ["package.json", "README.md", "uehper.js", "enable_uehper.js"]) {
        const sourcePath = path.join(packageRoot, fileName);
        copyPackageFile(sourcePath, path.join(targetDir, fileName), options);
    }

    const sourceCliDir = path.join(packageRoot, "Cli");
    const targetCliDir = path.join(targetDir, "Cli");
    if (fs.existsSync(sourceCliDir)) {
        if (!options.isDryRun()) {
            ensureDir(targetCliDir);
        }
        for (const entry of fs.readdirSync(sourceCliDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith(".js")) {
                copyPackageFile(path.join(sourceCliDir, entry.name), path.join(targetCliDir, entry.name), options);
            }
        }
    }

    materializePackageBinShims(context, options);
}

function run(commandLine, cwd, options) {
    info(`Running: ${commandLine}`);
    if (options.isDryRun()) {
        return false;
    }

    execSync(commandLine, {
        cwd,
        stdio: "inherit",
    });
    return true;
}

function ensurePuertsBootstrap(context, options) {
    const force = options.isForce();
    const jsSourcePath = path.join(context.puertsPath, "Content", "JavaScript");
    const puertsConfigPath = path.join(context.projectRoot, "Config", "DefaultPuerts.ini");
    const puertsConfig = `


[/Script/Puerts.PuertsSetting]
AutoModeEnable=True

`;

    if (!fs.existsSync(jsSourcePath)) {
        fail(`Puerts JavaScript templates are missing: ${jsSourcePath}`);
    }

    if (!fs.existsSync(context.contentJavascriptDir) || force) {
        info("Syncing Puerts JavaScript templates into Content/JavaScript");
        copyFolderRecursiveSync(jsSourcePath, context.contentJavascriptDir, { cliOptions: options });
    }

    if (!fs.existsSync(puertsConfigPath) || force) {
        info("Writing DefaultPuerts.ini");
        writeTextFile(puertsConfigPath, puertsConfig, { force, cliOptions: options });
    }

    ensureDir(context.projectTypescriptDir);

    if (!fs.existsSync(context.puertsEditorTypescriptPath) || force) {
        const puertsEditorDir = path.join(context.contentJavascriptDir, "PuertsEditor");
        if (!fs.existsSync(puertsEditorDir)) {
            fail(`Missing PuertsEditor directory: ${puertsEditorDir}`);
        }

        run("npm install .", puertsEditorDir, options);
    }
}

function ensureProjectBootstrap(context, options) {
    const force = options.isForce();
    writeTextFileIfMissing(context.rootPackagePath, rootPackageTemplate, { cliOptions: options });
    writeTextFileIfMissing(context.rootTsConfigPath, createRootTsConfigTemplate(context.projectLayout?.sourceRoot || "TypeScript"), { cliOptions: options });
    rewriteTsConfig(context.rootTsConfigPath, context, options);

    ensureDir(context.projectTypescriptDir);
    if (context.projectLayout?.frameworkSource === "source" && !context.isFrameworkInProjectTypescript) {
        info(`Materializing framework files into ${normalizePath(context.frameworkDir)}`);
        materializeFrameworkDirectory(scriptRoot, context.frameworkDir, { cliOptions: options });
    }

    if (!fs.existsSync(context.rootTypescriptCompiler) || force) {
        run("npm install .", context.projectRoot, options);
    }

    if (context.projectLayout?.frameworkSource === "package") {
        materializePackageInstall(context, options);
    }

    writeTextFile(path.join(context.contentJavascriptDir, "package.json"), rootPackageTemplate, { force: true, cliOptions: options });
    if (!fs.existsSync(context.runtimeNodeModulesDir) || force) {
        run("npm install .", context.contentJavascriptDir, options);
    }
}

function runBootstrap(context, options = createCliOptions()) {
    const report = getDoctorReport(context);
    if (!report.checks.backendReady) {
        fail(`Puerts backend is missing. Expected ${report.expectedBackendDir} under ${normalizePath(path.join(context.puertsPath, "ThirdParty"))}`);
    }

    ensurePuertsBootstrap(context, options);
    ensureProjectBootstrap(context, options);
    info("Bootstrap finished.");
}

function runBuild(context, options = createCliOptions()) {
    if (!fs.existsSync(context.projectTypingUE) || !fs.existsSync(context.projectTypingUEBP)) {
        fail("Puerts typing files are not generated yet. Run `node ./TypeScript/puerts_uehper/uehper.js gen-typings` first.");
    }

    if (!fs.existsSync(context.rootTypescriptCompiler)) {
        fail("Local TypeScript compiler is missing. Run bootstrap first.");
    }

    if (run("node ./node_modules/typescript/bin/tsc --build ./tsconfig.json", context.projectRoot, options)) {
        info("TypeScript build finished.");
        runSyncRuntime(context, options);
    }
}

function hasRuntimePackageEntrypoints(sourceDir) {
    return fs.existsSync(path.join(sourceDir, "index.js"))
        && fs.existsSync(path.join(sourceDir, "Framework", "bootstrap.js"));
}

function resolveRuntimePackageSource(context, options = createCliOptions()) {
    const compiledFrameworkDir = path.join(context.contentJavascriptDir, "puerts_uehper");
    const packageDistDir = path.join(context.frameworkPackageRoot, "dist");
    const projectPackageDistDir = path.join(context.projectFrameworkPackageDir || path.join(context.projectRoot, "node_modules", "puerts_uehper"), "dist");
    const runtimeSource = (options.getOptionValue("--runtime-source") || "auto").toLowerCase();
    const candidates = {
        compiled: { name: "compiled", dir: compiledFrameworkDir, hint: "Run build first." },
        dist: { name: "dist", dir: packageDistDir, hint: "Run npm run build:package under TypeScript/puerts_uehper first." },
        package: { name: "package", dir: projectPackageDistDir, hint: "Run bootstrap or install first." },
    };

    if (!["auto", "compiled", "dist", "package"].includes(runtimeSource)) {
        fail(`Unsupported --runtime-source=${runtimeSource}. Expected auto, compiled, dist, or package.`);
    }

    const orderedCandidates = runtimeSource === "auto"
        ? (context.projectLayout?.frameworkSource === "package"
            ? [candidates.package, candidates.dist, candidates.compiled]
            : [candidates.compiled, candidates.dist, candidates.package])
        : [candidates[runtimeSource]];

    for (const candidate of orderedCandidates) {
        if (hasRuntimePackageEntrypoints(candidate.dir)) {
            return candidate;
        }
    }

    const expected = orderedCandidates.map((candidate) => `${candidate.name}: ${normalizePath(candidate.dir)}`).join(", ");
    const hints = orderedCandidates.map((candidate) => candidate.hint).join(" ");
    fail(`No usable puerts_uehper runtime source found (${expected}). ${hints}`);
}

function runSyncRuntime(context, options = createCliOptions()) {
    const runtimeSource = resolveRuntimePackageSource(context, options);
    const runtimePackageDir = path.join(context.runtimeNodeModulesDir, "puerts_uehper");

    info(`Syncing runtime package (${runtimeSource.name}): ${normalizePath(runtimeSource.dir)} -> ${normalizePath(runtimePackageDir)}`);
    copyFolderRecursiveSync(runtimeSource.dir, runtimePackageDir, { cliOptions: options });
    if (!options.isDryRun()) {
        writeTextFile(path.join(runtimePackageDir, "package.json"), `{
    "name": "puerts_uehper",
    "version": "0.1.0",
    "main": "index.js"
}
`, { force: true, cliOptions: options });
    }
    info("Runtime package sync finished.");
}

module.exports = {
    runBootstrap,
    runBuild,
    runSyncRuntime,
    resolveRuntimePackageSource,
    rewriteTsConfig,
    materializePackageBinShims,
};