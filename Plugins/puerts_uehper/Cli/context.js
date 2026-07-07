const path = require("path");
const fs = require("fs");
const { createCliOptions } = require("./args");
const {
    fail,
    findProjectRoot,
    findPuertsPath,
    readJson,
} = require("./shared");

const defaultScriptRoot = path.resolve(__dirname, "..");
const DEFAULT_SOURCE_ROOT = "TypeScript";
const DEFAULT_APP_DIR = "Game";
const DEFAULT_FRAMEWORK_SOURCE = "package";

function normalizeModulePath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function readProjectLayoutConfig(projectRoot) {
    const packagePath = path.join(projectRoot, "package.json");
    if (!fs.existsSync(packagePath)) {
        return {};
    }

    try {
        const packageJson = readJson(packagePath);
        return packageJson.uehper && typeof packageJson.uehper === "object" ? packageJson.uehper : {};
    } catch (_) {
        return {};
    }
}

function resolveProjectLayout(projectRoot, options = createCliOptions()) {
    const config = readProjectLayoutConfig(projectRoot);
    const sourceRoot = normalizeModulePath(options.getOptionValue("--source-root") || config.sourceRoot || DEFAULT_SOURCE_ROOT) || DEFAULT_SOURCE_ROOT;
    const appDir = normalizeModulePath(options.getOptionValue("--app-dir") || options.getOptionValue("--game-dir") || config.appDir || DEFAULT_APP_DIR);
    const appModulePrefix = appDir && appDir !== "." ? appDir : "";
    const defaultEntryModule = appModulePrefix ? `${appModulePrefix}/GameApp` : "GameApp";
    const entryModule = normalizeModulePath(options.getOptionValue("--entry-module") || config.entryModule || defaultEntryModule);
    const frameworkDirName = normalizeModulePath(config.frameworkDirName || "puerts_uehper");
    const frameworkSource = String(options.getOptionValue("--framework-source") || config.frameworkSource || DEFAULT_FRAMEWORK_SOURCE).toLowerCase();
    if (!["package", "source"].includes(frameworkSource)) {
        fail(`Unsupported frameworkSource=${frameworkSource}. Expected package or source.`);
    }

    return {
        sourceRoot,
        appDir,
        entryModule,
        frameworkDirName,
        frameworkSource,
        sourceDir: path.join(projectRoot, sourceRoot),
        appDirPath: appDir && appDir !== "." ? path.join(projectRoot, sourceRoot, appDir) : path.join(projectRoot, sourceRoot),
    };
}

function findUprojectPath(projectRoot) {
    const projectFiles = fs.readdirSync(projectRoot).filter((entry) => entry.endsWith(".uproject"));
    if (projectFiles.length === 0) {
        fail(`Unable to locate .uproject under ${projectRoot}`);
    }
    return path.join(projectRoot, projectFiles[0]);
}

function readEngineAssociation(uprojectPath) {
    const uproject = readJson(uprojectPath);
    return uproject.EngineAssociation || "";
}

function candidateEditorPaths(engineAssociation, options = createCliOptions()) {
    const candidates = [];
    const editorOverride = options.getOptionValue("--editor");
    if (editorOverride) {
        candidates.push(editorOverride);
    }

    for (const envName of ["UE_EDITOR", "UNREAL_EDITOR", "UEHper_UnrealEditor"]) {
        if (process.env[envName]) {
            candidates.push(process.env[envName]);
        }
    }

    const normalizedAssociation = engineAssociation ? engineAssociation.replace(/\./g, ".") : "";
    const rootNames = normalizedAssociation ? [`UE_${normalizedAssociation}`, `UE-${normalizedAssociation}`] : [];
    for (const rootName of rootNames) {
        candidates.push(path.join("E:\\", rootName, "Engine", "Binaries", "Win64", "UnrealEditor.exe"));
        candidates.push(path.join("D:\\", rootName, "Engine", "Binaries", "Win64", "UnrealEditor.exe"));
        candidates.push(path.join("C:\\Program Files\\Epic Games", rootName, "Engine", "Binaries", "Win64", "UnrealEditor.exe"));
    }

    candidates.push(path.join("E:\\UE_5.5", "Engine", "Binaries", "Win64", "UnrealEditor.exe"));

    return Array.from(new Set(candidates));
}

function findUnrealEditor(engineAssociation, options = createCliOptions()) {
    for (const candidate of candidateEditorPaths(engineAssociation, options)) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function candidateEditorCmdPaths(engineAssociation, options = createCliOptions()) {
    const candidates = [];
    const editorCmdOverride = options.getOptionValue("--editor-cmd");
    if (editorCmdOverride) {
        candidates.push(editorCmdOverride);
    }
    for (const envName of ["UE_EDITOR_CMD", "UNREAL_EDITOR_CMD", "UEHper_UnrealEditorCmd"]) {
        if (process.env[envName]) {
            candidates.push(process.env[envName]);
        }
    }
    for (const editorPath of candidateEditorPaths(engineAssociation, options)) {
        if (editorPath) {
            candidates.push(editorPath.replace(/UnrealEditor\.exe$/i, "UnrealEditor-Cmd.exe"));
        }
    }
    return Array.from(new Set(candidates));
}

function findUnrealEditorCmd(engineAssociation, options = createCliOptions()) {
    for (const candidate of candidateEditorCmdPaths(engineAssociation, options)) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function readJsEnvConfig(puertsDir) {
    const jsEnvBuildPath = path.join(puertsDir, "Source", "JsEnv", "JsEnv.Build.cs");
    const content = fs.readFileSync(jsEnvBuildPath, "utf-8");
    const useNodejs = /private bool UseNodejs = true;/.test(content);
    const useQuickjs = /private bool UseQuickjs = true;/.test(content);
    const useV8VersionMatch = content.match(/private SupportedV8Versions UseV8Version =\s*[\s\S]*?SupportedV8Versions\.(V[0-9_]+)/);

    let expectedBackendDir = null;
    let backendType = "unknown";
    if (useNodejs) {
        backendType = "nodejs";
    } else if (useQuickjs) {
        backendType = "quickjs";
        expectedBackendDir = "quickjs";
    } else if (useV8VersionMatch) {
        backendType = "v8";
        expectedBackendDir = `v8_${useV8VersionMatch[1].replace(/^V/, "").replace(/_/g, ".")}`;
    }

    return {
        backendType,
        expectedBackendDir,
    };
}

function buildContext(projectStartDir = process.cwd(), options = createCliOptions(), packageRoot = defaultScriptRoot) {
    const projectOverride = options.getOptionValue("--project");
    const projectRoot = findProjectRoot(path.resolve(projectOverride || projectStartDir));
    const uprojectPath = findUprojectPath(projectRoot);
    const engineAssociation = readEngineAssociation(uprojectPath);
    const puertsPath = findPuertsPath(projectRoot);
    const jsEnvConfig = readJsEnvConfig(puertsPath);
    const projectLayout = resolveProjectLayout(projectRoot, options);
    const contentJavascriptDir = path.join(projectRoot, "Content", "JavaScript");
    const rootPackagePath = path.join(projectRoot, "package.json");
    const rootTsConfigPath = path.join(projectRoot, "tsconfig.json");
    const rootNodeModulesDir = path.join(projectRoot, "node_modules");
    const projectTypescriptDir = projectLayout.sourceDir;
    const projectAppDir = projectLayout.appDirPath;
    const frameworkDir = path.join(projectTypescriptDir, projectLayout.frameworkDirName);
    const isFrameworkInProjectTypescript = path.resolve(packageRoot) === path.resolve(frameworkDir);
    const scriptRootStat = fs.existsSync(packageRoot) ? fs.lstatSync(packageRoot) : null;
    const typingsDir = path.join(projectRoot, "Typing", "ue");
    const thirdPartyDir = path.join(puertsPath, "ThirdParty");
    const puertsEditorTypescriptPath = path.join(contentJavascriptDir, "PuertsEditor", "node_modules", "typescript");
    const runtimeNodeModulesDir = path.join(contentJavascriptDir, "node_modules");
    const projectFrameworkPackageDir = path.join(rootNodeModulesDir, "puerts_uehper");
    const projectTypingUE = path.join(typingsDir, "ue.d.ts");
    const projectTypingUEBP = path.join(typingsDir, "ue_bp.d.ts");
    const backendPath = jsEnvConfig.expectedBackendDir ? path.join(thirdPartyDir, jsEnvConfig.expectedBackendDir) : null;
    const rootTypescriptCompiler = path.join(rootNodeModulesDir, "typescript", "bin", "tsc");

    return {
        projectRoot,
        uprojectPath,
        engineAssociation,
        puertsPath,
        jsEnvConfig,
        contentJavascriptDir,
        rootPackagePath,
        rootTsConfigPath,
        rootNodeModulesDir,
        frameworkPackageRoot: packageRoot,
        projectLayout,
        projectTypescriptDir,
        projectSourceDir: projectTypescriptDir,
        projectAppDir,
        entryModule: projectLayout.entryModule,
        frameworkDir,
        isFrameworkInProjectTypescript,
        scriptRootIsSymlink: scriptRootStat ? scriptRootStat.isSymbolicLink() : false,
        typingsDir,
        thirdPartyDir,
        puertsEditorTypescriptPath,
        runtimeNodeModulesDir,
        projectFrameworkPackageDir,
        projectTypingUE,
        projectTypingUEBP,
        backendPath,
        rootTypescriptCompiler,
    };
}

function getGameDir(context) {
    return context.projectAppDir || path.join(context.projectTypescriptDir, "Game");
}

module.exports = {
    findUnrealEditor,
    findUnrealEditorCmd,
    buildContext,
    getGameDir,
    resolveProjectLayout,
};
