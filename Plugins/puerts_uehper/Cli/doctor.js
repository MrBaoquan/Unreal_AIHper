const path = require("path");
const fs = require("fs");
const {
    info,
    warn,
    fail,
    normalizePath,
    ensureDir,
    readJson,
    writeJson,
    quoteArg,
} = require("./shared");
const {
    createCliOptions,
} = require("./args");
const {
    runPollingProcess,
} = require("./processRunner");
const {
    findUnrealEditor,
    getGameDir,
} = require("./context");
const {
    normalizeUnrealAssetPath,
    normalizeUnrealCookPath,
    getAssetPackagePath,
} = require("./unrealPaths");
const {
    RUNTIME_STATE_PATTERN,
    parseUeLogPrefix,
    pickLatestLog,
    readRuntimeStateLastKnown: readRuntimeStateLastKnownShared,
    readRuntimeBootstrapReadiness,
} = require("./runtimeLog");

function getDoctorReport(context) {
    const relativeFrameworkImports = findRelativeFrameworkImports(context);
    const resourceDiagnostics = analyzeResourceManifest(context);
    const sceneDiagnostics = analyzeSceneManifest(context);
    const uiDiagnostics = analyzeUiManifest(context, resourceDiagnostics);
    const serviceGraph = getDefaultServiceGraph();
    const serviceGraphAnalysis = analyzeServiceGraph(serviceGraph);
    const runtimeStateLastKnown = readRuntimeStateLastKnown(context);
    const runtimeBootstrapReadiness = readRuntimeBootstrapReadiness(context);
    const runtimePackage = analyzeRuntimePackage(context);
    const frameworkSource = context.projectLayout?.frameworkSource || "package";
    const projectFrameworkPackageDir = context.projectFrameworkPackageDir
        || path.join(context.rootNodeModulesDir || path.join(context.projectRoot, "node_modules"), "puerts_uehper");
    const projectFrameworkPackageReady = fs.existsSync(path.join(projectFrameworkPackageDir, "dist", "index.js"))
        && fs.existsSync(path.join(projectFrameworkPackageDir, "dist", "index.d.ts"));
    const sourceFrameworkAvailable = context.isFrameworkInProjectTypescript && fs.existsSync(path.join(context.frameworkDir, "Framework", "bootstrap.ts"));
    const frameworkSourceAvailable = frameworkSource === "source" ? sourceFrameworkAvailable : projectFrameworkPackageReady;

    return {
        projectRoot: context.projectRoot,
        puertsPath: context.puertsPath,
        backendType: context.jsEnvConfig.backendType,
        expectedBackendDir: context.jsEnvConfig.expectedBackendDir,
        relativeFrameworkImports,
        resourceDiagnostics,
        sceneDiagnostics,
        uiDiagnostics,
        serviceGraph,
        serviceGraphAnalysis,
        runtimeStateLastKnown,
        runtimeBootstrapReadiness,
        runtimePackage,
        checks: {
            puertsPlugin: fs.existsSync(path.join(context.puertsPath, "Puerts.uplugin")),
            backendReady: context.backendPath ? fs.existsSync(context.backendPath) : true,
            typingsReady: fs.existsSync(context.projectTypingUE) && fs.existsSync(context.projectTypingUEBP),
            rootPackageJson: fs.existsSync(context.rootPackagePath),
            rootTsConfig: fs.existsSync(context.rootTsConfigPath),
            rootNodeModules: fs.existsSync(context.rootNodeModulesDir),
            rootTypescriptCompiler: fs.existsSync(context.rootTypescriptCompiler),
            puertsEditorTypescript: fs.existsSync(context.puertsEditorTypescriptPath),
            runtimeNodeModules: fs.existsSync(context.runtimeNodeModulesDir),
            runtimePackageReady: runtimePackage.ready,
            frameworkDirectory: frameworkSource === "source" ? fs.existsSync(context.frameworkDir) : true,
            frameworkSourceAvailable,
            projectUsesPackageFrameworkImports: relativeFrameworkImports.length === 0,
            resourceManifestValid: resourceDiagnostics.errors.length === 0,
            sceneManifestValid: sceneDiagnostics.errors.length === 0,
            uiManifestValid: uiDiagnostics.errors.length === 0,
            serviceGraphValid: serviceGraphAnalysis.isValid,
        },
    };
}

function analyzeRuntimePackage(context) {
    const packageDir = path.join(context.runtimeNodeModulesDir, "puerts_uehper");
    const packageJsonPath = path.join(packageDir, "package.json");
    const indexPath = path.join(packageDir, "index.js");
    const bootstrapPath = path.join(packageDir, "Framework", "bootstrap.js");
    const missing = [];

    for (const filePath of [packageJsonPath, indexPath, bootstrapPath]) {
        if (!fs.existsSync(filePath)) {
            missing.push(filePath);
        }
    }

    return {
        packageDir,
        packageJsonPath,
        indexPath,
        bootstrapPath,
        missing,
        ready: missing.length === 0,
    };
}

// Stage 7.5: 实际实现迁移到 ./runtimeLog.js，本地保留薄包装以兼容现有调用方。
function readRuntimeStateLastKnown(context) {
    return readRuntimeStateLastKnownShared(context);
}

function getDefaultServiceGraph() {
    // Stage 6.17: 优先从已编译的 Framework/DefaultServices.js 读取，与 FrameworkApp 共享同一数据源；
    // 编译产物缺失时回退到内联快照，doctor 仍可独立运行。
    try {
        const compiledPaths = [
            path.resolve(__dirname, "..", "..", "..", "Content", "JavaScript", "node_modules", "puerts_uehper", "Framework", "DefaultServices.js"),
            path.resolve(__dirname, "..", "..", "..", "Content", "JavaScript", "puerts_uehper", "Framework", "DefaultServices.js"),
        ];
        for (const compiledPath of compiledPaths) {
            if (!fs.existsSync(compiledPath)) {
                continue;
            }
            const mod = require(compiledPath);
            const ds = mod && mod.DEFAULT_SERVICES;
            if (ds && Array.isArray(ds.root) && Array.isArray(ds.world)) {
                const out = [];
                for (const entry of ds.root) {
                    out.push({ name: entry.name, scopeName: "root", dependencies: [...entry.dependencies], lifecycle: [...entry.lifecycle] });
                }
                for (const entry of ds.world) {
                    out.push({ name: entry.name, scopeName: "world", dependencies: [...entry.dependencies], lifecycle: [...entry.lifecycle] });
                }
                return out;
            }
        }
    } catch (error) {
        // 落到回退快照
        console.warn(`[uehper] doctor failed to read compiled DefaultServices.js; falling back to inline snapshot. ${error && error.message ? error.message : error}`);
    }
    return [
        { name: "events", scopeName: "root", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "commands", scopeName: "root", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "resources", scopeName: "root", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "events", scopeName: "world", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "modules", scopeName: "world", dependencies: [], lifecycle: ["register", "initialize", "start", "stop", "dispose"] },
        { name: "scenes", scopeName: "world", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "saveGames", scopeName: "world", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "timers", scopeName: "world", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "playerInput", scopeName: "world", dependencies: [], lifecycle: ["register", "dispose"] },
        { name: "worldResources", scopeName: "world", dependencies: ["resources"], lifecycle: ["register", "dispose"] },
        { name: "ui", scopeName: "world", dependencies: ["worldResources", "playerInput"], lifecycle: ["register", "dispose"] },
        // 多人能力包（opt-in）：actorRegistry / playerRegistry。
        // 默认不在 world 核心腰带图内，由 ProjectConfig.multiplayer = true 触发 ConfiguredProjectGameApp
        // 调用 registerMultiplayerCapabilityPack 装入；doctor 不强制其存在于 world 列表。
    ];
}

function analyzeServiceGraph(graph) {
    const byName = new Map();
    for (const item of graph) {
        byName.set(item.name, item);
    }

    const missing = [];
    for (const item of graph) {
        for (const dep of item.dependencies) {
            if (!byName.has(dep)) {
                missing.push({ name: item.name, dependency: dep });
            }
        }
    }

    const cycles = [];
    const visited = new Set();
    const onStack = new Set();
    const stack = [];
    const dfs = (name) => {
        if (onStack.has(name)) {
            const start = stack.indexOf(name);
            if (start >= 0) {
                cycles.push(stack.slice(start).concat(name));
            }
            return;
        }
        if (visited.has(name) || !byName.has(name)) {
            return;
        }
        visited.add(name);
        onStack.add(name);
        stack.push(name);
        for (const dep of byName.get(name).dependencies) {
            if (byName.has(dep)) {
                dfs(dep);
            }
        }
        stack.pop();
        onStack.delete(name);
    };
    for (const name of byName.keys()) {
        dfs(name);
    }

    const order = [];
    const seen = new Set();
    const visit = (name) => {
        if (seen.has(name) || !byName.has(name)) {
            return;
        }
        seen.add(name);
        for (const dep of byName.get(name).dependencies) {
            visit(dep);
        }
        order.push(name);
    };
    for (const name of byName.keys()) {
        visit(name);
    }

    return { missing, cycles, order, isValid: missing.length === 0 && cycles.length === 0 };
}

function listTypeScriptFiles(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listTypeScriptFiles(entryPath));
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
            files.push(entryPath);
        }
    }
    return files;
}

function findRelativeFrameworkImports(context) {
    const gameDir = getGameDir(context);
    const pattern = /(?:from\s+['"]|require\(\s*['"]|import\(\s*['"])(?:\.\.?[\\/])+puerts_uehper(?:[\\/][^'"]*)?['"]/g;
    const results = [];

    for (const filePath of listTypeScriptFiles(gameDir)) {
        const content = fs.readFileSync(filePath, "utf-8");
        let match;
        while ((match = pattern.exec(content)) != null) {
            results.push({
                filePath,
                line: content.slice(0, match.index).split(/\r?\n/).length,
                importText: match[0],
            });
        }
    }

    return results;
}

function analyzeResourceManifest(context) {
    const filePath = path.join(getGameDir(context), "Manifests", "resources.ts");
    const diagnostics = {
        filePath,
        entries: [],
        preloadGroups: [],
        errors: [],
        warnings: [],
    };

    if (!fs.existsSync(filePath)) {
        diagnostics.warnings.push({ message: `Resource manifest file is missing; run init or make app to create ${normalizePath(filePath)}.` });
        return diagnostics;
    }

    const ts = loadTypeScriptCompiler(context, diagnostics);
    if (!ts) {
        return diagnostics;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const manifestObject = findVariableObjectLiteral(ts, source, "resourceManifest");
    const preloadGroupsObject = findVariableObjectLiteral(ts, source, "resourcePreloadGroups");

    if (!manifestObject) {
        diagnostics.errors.push({ message: "resourceManifest must be a static object literal." });
        return diagnostics;
    }

    const manifestKeys = new Set();
    for (const property of manifestObject.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }

        const key = propertyNameToString(ts, property.name);
        if (!key) {
            diagnostics.errors.push({ message: "resourceManifest contains an entry with unsupported key syntax." });
            continue;
        }
        manifestKeys.add(key);

        if (!ts.isObjectLiteralExpression(property.initializer)) {
            diagnostics.errors.push({ key, message: "resourceManifest entry must be an object literal." });
            continue;
        }

        const type = readStringProperty(ts, property.initializer, "type");
        const assetPath = readStringProperty(ts, property.initializer, "path");
        diagnostics.entries.push({ key, type, path: assetPath });

        if (!type) {
            diagnostics.errors.push({ key, message: "resourceManifest entry is missing string property: type." });
        }
        if (!assetPath) {
            diagnostics.errors.push({ key, message: "resourceManifest entry is missing string property: path." });
            continue;
        }

        validateAssetPath(context, diagnostics, key, assetPath);
    }

    if (preloadGroupsObject) {
        for (const property of preloadGroupsObject.properties) {
            if (!ts.isPropertyAssignment(property)) {
                continue;
            }

            const groupName = propertyNameToString(ts, property.name);
            if (!groupName) {
                diagnostics.errors.push({ message: "resourcePreloadGroups contains an entry with unsupported key syntax." });
                continue;
            }

            if (!ts.isArrayLiteralExpression(property.initializer)) {
                diagnostics.errors.push({ groupName, message: "resourcePreloadGroups entry must be a string array." });
                continue;
            }

            const keys = [];
            for (const element of property.initializer.elements) {
                if (!ts.isStringLiteralLike(element)) {
                    diagnostics.errors.push({ groupName, message: "resourcePreloadGroups entries must contain only string keys." });
                    continue;
                }
                keys.push(element.text);
                if (!manifestKeys.has(element.text)) {
                    diagnostics.errors.push({ groupName, key: element.text, message: "resourcePreloadGroups references a key that is not registered in resourceManifest." });
                }
            }
            diagnostics.preloadGroups.push({ groupName, keys });
        }
    }

    return diagnostics;
}

function analyzeSceneManifest(context) {
    const filePath = path.join(getGameDir(context), "Manifests", "scenes.ts");
    const diagnostics = {
        filePath,
        entries: [],
        errors: [],
        warnings: [],
    };

    if (!fs.existsSync(filePath)) {
        diagnostics.warnings.push({ message: `Scene manifest file is missing; run init or make app to create ${normalizePath(filePath)}.` });
        return diagnostics;
    }

    const ts = loadTypeScriptCompiler(context, diagnostics);
    if (!ts) {
        return diagnostics;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const manifestObject = findVariableObjectLiteral(ts, source, "sceneManifest");

    if (!manifestObject) {
        diagnostics.errors.push({ message: "sceneManifest must be a static object literal." });
        return diagnostics;
    }

    for (const property of manifestObject.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }

        const key = propertyNameToString(ts, property.name);
        if (!key) {
            diagnostics.errors.push({ message: "sceneManifest contains an entry with unsupported key syntax." });
            continue;
        }

        if (!ts.isObjectLiteralExpression(property.initializer)) {
            diagnostics.errors.push({ key, message: "sceneManifest entry must be an object literal." });
            continue;
        }

        const levelName = readStringProperty(ts, property.initializer, "levelName");
        const mapPath = readStringProperty(ts, property.initializer, "mapPath");
        diagnostics.entries.push({ key, levelName, mapPath, assetPath: getSceneAssetPath(levelName, mapPath) });
        validateSceneManifestEntryOptions(ts, diagnostics, key, property.initializer);

        if (!levelName) {
            diagnostics.errors.push({ key, message: "sceneManifest entry is missing string property: levelName." });
            continue;
        }

        validateSceneManifestEntry(context, diagnostics, key, levelName, mapPath);
    }

    return diagnostics;
}

function validateSceneManifestEntryOptions(ts, diagnostics, key, entryObject) {
    validateOptionalSceneStringProperty(ts, diagnostics, key, entryObject, "mapPath");
    validateOptionalSceneStringProperty(ts, diagnostics, key, entryObject, "displayName");
}

function validateOptionalSceneStringProperty(ts, diagnostics, key, entryObject, propertyName) {
    const initializer = getPropertyInitializer(ts, entryObject, propertyName);
    if (initializer && !ts.isStringLiteralLike(initializer)) {
        diagnostics.errors.push({ key, message: `sceneManifest.${propertyName} must be a string when provided.` });
    }
}

function analyzeUiManifest(context, resourceDiagnostics) {
    const filePath = path.join(getGameDir(context), "Manifests", "ui.ts");
    const diagnostics = {
        filePath,
        entries: [],
        errors: [],
        warnings: [],
    };

    if (!fs.existsSync(filePath)) {
        diagnostics.warnings.push({ message: `UI manifest file is missing; run init or make app to create ${normalizePath(filePath)}.` });
        return diagnostics;
    }

    const ts = loadTypeScriptCompiler(context, diagnostics);
    if (!ts) {
        return diagnostics;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const manifestObject = findVariableObjectLiteral(ts, source, "uiManifest");
    if (!manifestObject) {
        diagnostics.errors.push({ message: "uiManifest must be a static object literal." });
        return diagnostics;
    }

    const resourceKeys = new Set(resourceDiagnostics.entries.map((entry) => entry.key));
    const uiKeys = new Set();
    for (const property of manifestObject.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }
        const key = propertyNameToString(ts, property.name);
        if (key) {
            uiKeys.add(key);
        }
    }

    for (const property of manifestObject.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }

        const key = propertyNameToString(ts, property.name);
        if (!key) {
            diagnostics.errors.push({ message: "uiManifest contains an entry with unsupported key syntax." });
            continue;
        }

        if (!ts.isObjectLiteralExpression(property.initializer)) {
            diagnostics.errors.push({ key, message: "uiManifest entry must be an object literal." });
            continue;
        }

        const widgetClass = readStringProperty(ts, property.initializer, "widgetClass");
        diagnostics.entries.push({ key, widgetClass });
        if (!widgetClass) {
            diagnostics.errors.push({ key, message: "uiManifest entry is missing string property: widgetClass." });
            continue;
        }

        validateUiManifestEntryOptions(ts, diagnostics, key, property.initializer);
        const modalMask = readStringProperty(ts, property.initializer, "modalMask");
        if (modalMask && !uiKeys.has(modalMask)) {
            diagnostics.errors.push({ key, message: `uiManifest.modalMask references a UI key that is not registered: ${modalMask}.` });
        }
        validateWidgetClassReference(context, diagnostics, key, widgetClass, resourceKeys);
    }

    return diagnostics;
}

function loadTypeScriptCompiler(context, diagnostics) {
    try {
        return require(path.join(context.rootNodeModulesDir, "typescript"));
    } catch (error) {
        diagnostics.warnings.push({ message: `Cannot load TypeScript compiler for resource manifest AST checks: ${error}` });
        return null;
    }
}

function findVariableObjectLiteral(ts, source, variableName) {
    let result;
    function visit(node) {
        if (result) {
            return;
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName && node.initializer) {
            result = unwrapExpression(ts, node.initializer);
            return;
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return result && ts.isObjectLiteralExpression(result) ? result : undefined;
}

function unwrapExpression(ts, expression) {
    let current = expression;
    while (ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

function propertyNameToString(ts, name) {
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return undefined;
}

function readStringProperty(ts, objectLiteral, propertyName) {
    const initializer = getPropertyInitializer(ts, objectLiteral, propertyName);
    return initializer && ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
}

function getPropertyInitializer(ts, objectLiteral, propertyName) {
    for (const property of objectLiteral.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }
        if (propertyNameToString(ts, property.name) !== propertyName) {
            continue;
        }
        return unwrapExpression(ts, property.initializer);
    }
    return undefined;
}

function validateUiManifestEntryOptions(ts, diagnostics, key, entryObject) {
    validateOptionalStringProperty(ts, diagnostics, key, entryObject, "layer");
    validateOptionalNumberProperty(ts, diagnostics, key, entryObject, "zOrder");
    validateOptionalBooleanProperty(ts, diagnostics, key, entryObject, "cache");
    validateOptionalBooleanProperty(ts, diagnostics, key, entryObject, "exclusive");
    validateOptionalBooleanProperty(ts, diagnostics, key, entryObject, "modal");
    validateOptionalBooleanProperty(ts, diagnostics, key, entryObject, "showMouseCursor");
    validateOptionalStringProperty(ts, diagnostics, key, entryObject, "modalMask");
    validateOptionalStringArrayProperty(ts, diagnostics, key, entryObject, "closeLayers");
}

function validateOptionalStringProperty(ts, diagnostics, key, entryObject, propertyName) {
    const initializer = getPropertyInitializer(ts, entryObject, propertyName);
    if (initializer && !ts.isStringLiteralLike(initializer)) {
        diagnostics.errors.push({ key, message: `uiManifest.${propertyName} must be a string when provided.` });
    }
}

function validateOptionalNumberProperty(ts, diagnostics, key, entryObject, propertyName) {
    const initializer = getPropertyInitializer(ts, entryObject, propertyName);
    if (initializer && !ts.isNumericLiteral(initializer)) {
        diagnostics.errors.push({ key, message: `uiManifest.${propertyName} must be a number when provided.` });
    }
}

function validateOptionalBooleanProperty(ts, diagnostics, key, entryObject, propertyName) {
    const initializer = getPropertyInitializer(ts, entryObject, propertyName);
    if (initializer && initializer.kind !== ts.SyntaxKind.TrueKeyword && initializer.kind !== ts.SyntaxKind.FalseKeyword) {
        diagnostics.errors.push({ key, message: `uiManifest.${propertyName} must be a boolean when provided.` });
    }
}

function validateOptionalStringArrayProperty(ts, diagnostics, key, entryObject, propertyName) {
    const initializer = getPropertyInitializer(ts, entryObject, propertyName);
    if (!initializer) {
        return;
    }
    if (!ts.isArrayLiteralExpression(initializer)) {
        diagnostics.errors.push({ key, message: `uiManifest.${propertyName} must be a string array when provided.` });
        return;
    }
    for (const element of initializer.elements) {
        if (!ts.isStringLiteralLike(element)) {
            diagnostics.errors.push({ key, message: `uiManifest.${propertyName} entries must be strings.` });
        }
    }
}

function validateAssetPath(context, diagnostics, key, assetPath) {
    const normalizedAssetPath = normalizeUnrealAssetPath(assetPath);
    if (!normalizedAssetPath.startsWith("/")) {
        diagnostics.errors.push({ key, path: assetPath, message: "Resource path should be an Unreal absolute path such as /Game/... or /Script/...." });
        return;
    }

    if (normalizedAssetPath.startsWith("/Script/")) {
        return;
    }

    if (!normalizedAssetPath.startsWith("/Game/")) {
        diagnostics.warnings.push({ key, path: assetPath, message: "Resource path is not under /Game; doctor cannot verify cooked asset existence." });
        return;
    }

    const packagePath = normalizedAssetPath.includes(".") ? normalizedAssetPath.slice(0, normalizedAssetPath.indexOf(".")) : normalizedAssetPath;
    const relativePackagePath = packagePath.slice("/Game/".length);
    const uassetPath = path.join(context.projectRoot, "Content", `${relativePackagePath}.uasset`);
    if (!fs.existsSync(uassetPath)) {
        diagnostics.errors.push({ key, path: assetPath, expectedFile: uassetPath, message: "Resource package file does not exist under Content." });
    }
}

function getSceneAssetPath(levelName, mapPath) {
    if (mapPath) {
        return normalizeUnrealAssetPath(mapPath);
    }
    if (levelName && normalizeUnrealAssetPath(levelName).startsWith("/Game/")) {
        return normalizeUnrealAssetPath(levelName);
    }
    return undefined;
}

function validateSceneManifestEntry(context, diagnostics, key, levelName, mapPath) {
    const assetPath = getSceneAssetPath(levelName, mapPath);
    if (!assetPath) {
        diagnostics.warnings.push({ key, levelName, message: "Scene levelName is not an absolute /Game map path; add mapPath for AssetRegistry and Cook diagnostics." });
        return;
    }

    if (!assetPath.startsWith("/Game/")) {
        diagnostics.errors.push({ key, levelName, mapPath, message: "Scene mapPath should be an Unreal map package path under /Game, such as /Game/Levels/MainLevel." });
        return;
    }

    const packagePath = assetPath.includes(".") ? assetPath.slice(0, assetPath.indexOf(".")) : assetPath;
    const relativePackagePath = packagePath.slice("/Game/".length);
    const umapPath = path.join(context.projectRoot, "Content", `${relativePackagePath}.umap`);
    if (!fs.existsSync(umapPath)) {
        diagnostics.errors.push({ key, levelName, mapPath, expectedFile: umapPath, message: "Scene map package file does not exist under Content." });
    }
}

function validateWidgetClassReference(context, diagnostics, key, widgetClass, resourceKeys) {
    if (resourceKeys.has(widgetClass)) {
        return;
    }

    const normalizedWidgetClass = normalizeUnrealAssetPath(widgetClass);
    if (!normalizedWidgetClass.startsWith("/")) {
        diagnostics.errors.push({ key, widgetClass, message: "UI widgetClass should be a resourceManifest key or an Unreal class path such as /Game/..._C or /Script/...." });
        return;
    }

    if (normalizedWidgetClass.startsWith("/Script/")) {
        return;
    }

    if (!normalizedWidgetClass.startsWith("/Game/")) {
        diagnostics.warnings.push({ key, widgetClass, message: "UI widgetClass is not under /Game; doctor cannot verify cooked asset existence." });
        return;
    }

    if (!widgetClass.endsWith("_C")) {
        diagnostics.warnings.push({ key, widgetClass, message: "Widget Blueprint class paths usually end with _C. Prefer a resourceManifest WidgetClass key for async preload and stronger validation." });
    }

    const packagePath = normalizedWidgetClass.includes(".") ? normalizedWidgetClass.slice(0, normalizedWidgetClass.indexOf(".")) : normalizedWidgetClass;
    const relativePackagePath = packagePath.slice("/Game/".length);
    const uassetPath = path.join(context.projectRoot, "Content", `${relativePackagePath}.uasset`);
    if (!fs.existsSync(uassetPath)) {
        diagnostics.errors.push({ key, widgetClass, expectedFile: uassetPath, message: "UI widget package file does not exist under Content." });
    }
}

function printDoctorReport(report) {
    info(`Project root: ${normalizePath(report.projectRoot)}`);
    info(`Puerts path: ${normalizePath(report.puertsPath)}`);
    info(`Configured backend: ${report.backendType}`);
    if (report.expectedBackendDir) {
        info(`Expected backend directory: ${report.expectedBackendDir}`);
    }

    for (const [checkName, result] of Object.entries(report.checks)) {
        const label = result ? "OK" : "MISSING";
        info(`${label.padEnd(7, " ")} ${checkName}`);
    }

    info("Service graph:");
    for (const service of report.serviceGraph) {
        const dependencies = service.dependencies.length > 0 ? service.dependencies.join(",") : "none";
        info(`  ${service.name.padEnd(11, " ")} scope=${service.scopeName.padEnd(5, " ")} deps=${dependencies} lifecycle=${service.lifecycle.join(",")}`);
    }
    const analysis = report.serviceGraphAnalysis;    if (analysis) {
        if (analysis.order.length > 0) {
            info(`  init order: ${analysis.order.join(" -> ")}`);
        }
        if (analysis.cycles.length > 0) {
            for (const cycle of analysis.cycles) {
                warn(`  Service dependency cycle: ${cycle.join(" -> ")}`);
            }
        }
        if (analysis.missing.length > 0) {
            for (const item of analysis.missing) {
                warn(`  Missing dependency '${item.dependency}' required by '${item.name}'`);
            }
        }
    }

    if (report.runtimeStateLastKnown) {
        const last = report.runtimeStateLastKnown;
        if (last.available) {
            info(`Runtime state (last known): ${last.state}  [source ${normalizePath(path.relative(report.projectRoot, last.sourceLog))} @ ${last.mtime}]`);
        } else {
            info("Runtime state (last known): unknown (no Saved/Logs entry with 'RuntimeState X -> Y' yet -- launch the editor at least once)");
        }
    }

    if (report.runtimeBootstrapReadiness) {
        const readiness = report.runtimeBootstrapReadiness;
        if (readiness.available) {
            const entry = readiness.entryModule ? ` entryModule=${readiness.entryModule}` : "";
            info(`Runtime bootstrap readiness: ${readiness.status}${entry}  [source ${normalizePath(path.relative(report.projectRoot, readiness.sourceLog))} @ ${readiness.mtime}]`);
            if (readiness.ignoredBootstrapResult) {
                warn(`Runtime bootstrap ignored NotifyBootstrapResult: ${readiness.ignoredLine}`);
            }
        } else {
            info("Runtime bootstrap readiness: unknown (no Saved/Logs entry yet -- launch the editor at least once)");
        }
    }

    // Stage 7.8: 在报告尾部固定打印 BlueprintLibrary 推荐用法片段，新成员可直接照抄 BP 调用流。
    info("BlueprintLibrary tips:");
    info("  - Get UEHper Runtime Subsystem (WorldContext=self)  -> Assign On UEHper Runtime State Changed");
    info("  - Get Current Runtime State / Get Current Runtime State Name (WorldContext=self)  for status badges");
    info("  - Is Runtime Running / Is Runtime Failed (WorldContext=self)  for branch gates");
    info("  - For non-BP code, prefer GEngine->GetWorldFromContextObject + GameInstance->GetSubsystem<UUEHperRuntimeSubsystem>().");

    if (!report.checks.backendReady && report.expectedBackendDir) {
        warn(`Missing Puerts backend directory. Expected ${report.expectedBackendDir} under ThirdParty.`);
    }
    if (!report.checks.typingsReady) {
        warn("Missing Typing/ue/ue.d.ts or Typing/ue/ue_bp.d.ts. Open the Unreal Editor, compile the project, then run Puerts.Gen.");
    }
    if (!report.checks.frameworkSourceAvailable) {
        warn("puerts_uehper framework source is unavailable for the configured frameworkSource. In package mode run npm install/bootstrap; in source mode run from the materialized source package.");
    }
    if (!report.checks.runtimePackageReady) {
        warn(`Runtime package is not ready under ${normalizePath(path.relative(report.projectRoot, report.runtimePackage.packageDir))}. Run build or sync-runtime.`);
        for (const filePath of report.runtimePackage.missing) {
            warn(`  missing ${normalizePath(path.relative(report.projectRoot, filePath))}`);
        }
    }
    if (!report.checks.projectUsesPackageFrameworkImports) {
        warn("Project code should import the framework as 'puerts_uehper', not through relative paths:");
        for (const violation of report.relativeFrameworkImports) {
            warn(`  ${normalizePath(path.relative(report.projectRoot, violation.filePath))}:${violation.line} ${violation.importText}`);
        }
    }
    if (report.resourceDiagnostics.warnings.length > 0) {
        warn("Resource manifest warnings:");
        for (const item of report.resourceDiagnostics.warnings) {
            warn(`  ${formatResourceDiagnostic(report.projectRoot, item)}`);
        }
    }
    if (!report.checks.resourceManifestValid) {
        warn("Resource manifest errors:");
        for (const item of report.resourceDiagnostics.errors) {
            warn(`  ${formatResourceDiagnostic(report.projectRoot, item)}`);
        }
    }
    if (report.sceneDiagnostics.warnings.length > 0) {
        warn("Scene manifest warnings:");
        for (const item of report.sceneDiagnostics.warnings) {
            warn(`  ${formatSceneDiagnostic(report.projectRoot, item)}`);
        }
    }
    if (!report.checks.sceneManifestValid) {
        warn("Scene manifest errors:");
        for (const item of report.sceneDiagnostics.errors) {
            warn(`  ${formatSceneDiagnostic(report.projectRoot, item)}`);
        }
    }
    if (report.uiDiagnostics.warnings.length > 0) {
        warn("UI manifest warnings:");
        for (const item of report.uiDiagnostics.warnings) {
            warn(`  ${formatUiDiagnostic(report.projectRoot, item)}`);
        }
    }
    if (!report.checks.uiManifestValid) {
        warn("UI manifest errors:");
        for (const item of report.uiDiagnostics.errors) {
            warn(`  ${formatUiDiagnostic(report.projectRoot, item)}`);
        }
    }
}

function formatSceneDiagnostic(projectRoot, item) {
    const parts = [];
    if (item.key) {
        parts.push(`key=${item.key}`);
    }
    if (item.levelName) {
        parts.push(`levelName=${item.levelName}`);
    }
    if (item.mapPath) {
        parts.push(`mapPath=${item.mapPath}`);
    }
    if (item.expectedFile) {
        parts.push(`expected=${normalizePath(path.relative(projectRoot, item.expectedFile))}`);
    }
    parts.push(item.message);
    return parts.join(" ");
}

function formatResourceDiagnostic(projectRoot, item) {
    const parts = [];
    if (item.groupName) {
        parts.push(`group=${item.groupName}`);
    }
    if (item.key) {
        parts.push(`key=${item.key}`);
    }
    if (item.path) {
        parts.push(`path=${item.path}`);
    }
    if (item.expectedFile) {
        parts.push(`expected=${normalizePath(path.relative(projectRoot, item.expectedFile))}`);
    }
    parts.push(item.message);
    return parts.join(" ");
}

function formatUiDiagnostic(projectRoot, item) {
    const parts = [];
    if (item.key) {
        parts.push(`key=${item.key}`);
    }
    if (item.widgetClass) {
        parts.push(`widgetClass=${item.widgetClass}`);
    }
    if (item.expectedFile) {
        parts.push(`expected=${normalizePath(path.relative(projectRoot, item.expectedFile))}`);
    }
    parts.push(item.message);
    return parts.join(" ");
}

function runDoctor(context) {
    const report = getDoctorReport(context);
    printDoctorReport(report);
    return report;
}

// Stage 7.0: --watch-runtime-state — tail Saved/Logs/*.log，实时打印 'RuntimeState X -> Y' 行。
// 设计要点：
//  - 持续选取 Saved/Logs 目录下 mtime 最新的 .log（UE 每次 PIE/Editor 启动会切换 log 文件名），
//    每 1s 重新评估一次"当前最新 log"；切换时打印 [uehper] watch: switched to <log>。
//  - 通过维护文件读取偏移量 lastSize/lastInode 实现增量读取，不会因为文件被滚动而读丢内容。
//  - 输出格式：[uehper] <ISO 时间戳> <log basename>: <state-line trimmed>。
//  - Ctrl+C / SIGINT 退出；启动时立即打印一次 last-known state 作为基线。
//  - 选项：--watch-runtime-state-poll-ms=<n> 调节轮询间隔，默认 1000ms；最小 250ms。
async function runWatchRuntimeState(context, options) {
    const logsDir = path.join(context.projectRoot, "Saved", "Logs");
    if (!fs.existsSync(logsDir)) {
        warn(`Saved/Logs not found at ${normalizePath(logsDir)}; launch the editor at least once before --watch-runtime-state.`);
        return { success: false, exitCode: 1 };
    }
    const pollMsRaw = options && typeof options.getOptionValue === "function"
        ? options.getOptionValue("--watch-runtime-state-poll-ms")
        : undefined;
    let pollMs = Number.parseInt(pollMsRaw, 10);
    if (!Number.isFinite(pollMs) || pollMs < 250) {
        pollMs = 1000;
    }
    // Stage 7.2: --watch-runtime-state-json — 以 NDJSON 输出，便于脚本/外部工具消费。
    const jsonMode = options && typeof options.hasOption === "function" && options.hasOption("--watch-runtime-state-json");
    // Stage 7.5: 复用 ./runtimeLog.js 中的正则与 log 挑选逻辑。
    const pattern = RUNTIME_STATE_PATTERN;

    // Stage 7.4: watch 模式的所有元信息行（baseline / switched / watching）走 stderr，
    // 保证 stdout 在文本与 JSON 两种模式下都只包含匹配行，便于 `| jq` 或日志管道消费。
    const notify = (message) => { process.stderr.write(`[uehper] ${message}\n`); };

    const baseline = readRuntimeStateLastKnown(context);
    if (baseline.available) {
        notify(`watch baseline (most recent transition): ${baseline.state} from ${normalizePath(baseline.sourceLog)} @ ${baseline.mtime}`);
    } else {
        notify("watch baseline: no RuntimeState transition found yet — waiting for new entries.");
    }
    notify(`Watching ${normalizePath(logsDir)} (poll ${pollMs}ms). Press Ctrl+C to stop.`);

    let activeLogPath = null;
    let activeOffset = 0;
    let activeMtime = 0;
    let stopped = false;

    function pickLatestLogLocal() {
        return pickLatestLog(logsDir);
    }

    function emitMatchesFromChunk(chunk, logBasename) {
        const lines = chunk.split(/\r?\n/);
        for (const line of lines) {
            const match = line.match(pattern);
            if (!match) {
                continue;
            }
            if (jsonMode) {
                // Stage 7.7: 当 UE 日志行带标准前缀时，附加 ueTs/frame/category 字段；
                // 缺前缀（纯转换行或自定义 logger）则字段为 null，消费方可按需 fallback 到 ts。
                const prefix = parseUeLogPrefix(line);
                process.stdout.write(JSON.stringify({
                    ts: new Date().toISOString(),
                    log: logBasename,
                    from: match[1],
                    to: match[2],
                    ueTs: prefix ? prefix.ueTs : null,
                    frame: prefix ? prefix.frame : null,
                    category: prefix ? prefix.category : null,
                    line: line.trim(),
                }) + "\n");
            } else {
                process.stdout.write(`[uehper] ${new Date().toISOString()} ${logBasename}: ${line.trim()}\n`);
            }
        }
    }

    function readNewBytes() {
        if (!activeLogPath) {
            return;
        }
        let stat;
        try {
            stat = fs.statSync(activeLogPath);
        } catch (_error) {
            return;
        }
        // 文件被截断或替换（size 缩小）→ 从头重读。
        if (stat.size < activeOffset) {
            activeOffset = 0;
        }
        if (stat.size === activeOffset) {
            return;
        }
        const fd = fs.openSync(activeLogPath, "r");
        try {
            const length = stat.size - activeOffset;
            const buffer = Buffer.alloc(length);
            const bytesRead = fs.readSync(fd, buffer, 0, length, activeOffset);
            activeOffset += bytesRead;
            const chunk = buffer.slice(0, bytesRead).toString("utf8");
            emitMatchesFromChunk(chunk, path.basename(activeLogPath));
        } finally {
            fs.closeSync(fd);
        }
        activeMtime = stat.mtimeMs;
    }

    function tick() {
        if (stopped) {
            return;
        }
        const latest = pickLatestLogLocal();
        if (!latest) {
            return;
        }
        if (latest.full !== activeLogPath) {
            // 切换到更新的 log；新文件从头读，避免漏 PIE 启动初期的状态行。
            if (activeLogPath !== null) {
                notify(`watch: switched to ${path.basename(latest.full)}`);
            }
            activeLogPath = latest.full;
            activeOffset = 0;
            activeMtime = latest.mtime;
        }
        readNewBytes();
    }

    return await new Promise((resolve) => {
        const interval = setInterval(tick, pollMs);
        function shutdown() {
            if (stopped) {
                return;
            }
            stopped = true;
            clearInterval(interval);
            process.removeListener("SIGINT", shutdown);
            process.removeListener("SIGTERM", shutdown);
            info("watch stopped.");
            resolve({ success: true, exitCode: 0 });
        }
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        tick();
    });
}

function collectAssetRegistryRequests(report) {
    const requests = [];
    const resourceEntriesByKey = new Map();

    for (const entry of report.resourceDiagnostics.entries) {
        if (!entry.key || !entry.path) {
            continue;
        }

        resourceEntriesByKey.set(entry.key, entry);
        requests.push({
            source: "resource",
            key: entry.key,
            path: entry.path,
            expectedType: entry.type || "",
        });
    }

    for (const entry of report.uiDiagnostics.entries) {
        if (!entry.key || !entry.widgetClass) {
            continue;
        }

        const resourceEntry = resourceEntriesByKey.get(entry.widgetClass);
        requests.push({
            source: "ui",
            key: entry.key,
            path: resourceEntry ? resourceEntry.path : entry.widgetClass,
            expectedType: "WidgetClass",
        });
    }

    for (const entry of report.sceneDiagnostics.entries) {
        if (!entry.key || !entry.assetPath) {
            continue;
        }

        requests.push({
            source: "scene",
            key: entry.key,
            path: entry.assetPath,
            expectedType: "World",
        });
    }

    return requests;
}

const assetTypeRules = new Map([
    ["staticmesh", { label: "StaticMesh", assetClasses: ["StaticMesh"] }],
    ["mesh", { label: "StaticMesh", assetClasses: ["StaticMesh"] }],
    ["skeletalmesh", { label: "SkeletalMesh", assetClasses: ["SkeletalMesh"] }],
    ["skelmesh", { label: "SkeletalMesh", assetClasses: ["SkeletalMesh"] }],
    ["material", { label: "Material", assetClasses: ["Material", "MaterialInstance", "MaterialInstanceConstant", "MaterialInstanceDynamic"] }],
    ["materialinterface", { label: "MaterialInterface", assetClasses: ["Material", "MaterialInstance", "MaterialInstanceConstant", "MaterialInstanceDynamic"] }],
    ["texture", { label: "Texture", assetClasses: ["Texture", "Texture2D", "TextureCube", "Texture2DArray", "VolumeTexture", "TextureRenderTarget", "TextureRenderTarget2D", "TextureRenderTargetCube"] }],
    ["texture2d", { label: "Texture2D", assetClasses: ["Texture2D"] }],
    ["sound", { label: "Sound", assetClasses: ["SoundBase", "SoundWave", "SoundCue", "DialogueWave"] }],
    ["soundbase", { label: "SoundBase", assetClasses: ["SoundBase", "SoundWave", "SoundCue", "DialogueWave"] }],
    ["soundwave", { label: "SoundWave", assetClasses: ["SoundWave"] }],
    ["soundcue", { label: "SoundCue", assetClasses: ["SoundCue"] }],
    ["animation", { label: "Animation", assetClasses: ["AnimationAsset", "AnimSequence", "AnimMontage", "BlendSpace", "BlendSpace1D", "AimOffsetBlendSpace", "AimOffsetBlendSpace1D", "AnimBlueprint"] }],
    ["animationasset", { label: "AnimationAsset", assetClasses: ["AnimationAsset", "AnimSequence", "AnimMontage", "BlendSpace", "BlendSpace1D", "AimOffsetBlendSpace", "AimOffsetBlendSpace1D"] }],
    ["animsequence", { label: "AnimSequence", assetClasses: ["AnimSequence"] }],
    ["animmontage", { label: "AnimMontage", assetClasses: ["AnimMontage"] }],
    ["blendspace", { label: "BlendSpace", assetClasses: ["BlendSpace", "BlendSpace1D", "AimOffsetBlendSpace", "AimOffsetBlendSpace1D"] }],
    ["animblueprint", { label: "AnimBlueprint", assetClasses: ["AnimBlueprint"] }],
    ["dataasset", { label: "DataAsset", assetClasses: ["DataAsset", "PrimaryDataAsset", "Blueprint"], parentClasses: ["DataAsset", "PrimaryDataAsset"] }],
    ["primarydataasset", { label: "PrimaryDataAsset", assetClasses: ["PrimaryDataAsset", "Blueprint"], parentClasses: ["PrimaryDataAsset"] }],
    ["datatable", { label: "DataTable", assetClasses: ["DataTable"] }],
    ["curvetable", { label: "CurveTable", assetClasses: ["CurveTable"] }],
    ["levelsequence", { label: "LevelSequence", assetClasses: ["LevelSequence"] }],
    ["sequence", { label: "LevelSequence", assetClasses: ["LevelSequence"] }],
    ["map", { label: "World", assetClasses: ["World"] }],
    ["world", { label: "World", assetClasses: ["World"] }],
    ["niagara", { label: "Niagara", assetClasses: ["NiagaraSystem", "NiagaraEmitter"] }],
    ["niagarasystem", { label: "NiagaraSystem", assetClasses: ["NiagaraSystem"] }],
    ["niagaraemitter", { label: "NiagaraEmitter", assetClasses: ["NiagaraEmitter"] }],
]);

function normalizeAssetTypeName(value) {
    return String(value || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function getUnrealTypeLeaf(value) {
    const normalized = String(value || "").replace(/'/g, "");
    if (!normalized) {
        return "";
    }
    const slashIndex = normalized.lastIndexOf("/");
    const dotIndex = normalized.lastIndexOf(".");
    const separatorIndex = Math.max(slashIndex, dotIndex);
    return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

function leafMatchesAny(value, expectedLeaves) {
    const leaf = getUnrealTypeLeaf(value).toLowerCase();
    return expectedLeaves.some((expectedLeaf) => leaf === expectedLeaf.toLowerCase());
}

function getAssetTypeRule(expectedType) {
    return assetTypeRules.get(normalizeAssetTypeName(expectedType));
}

function getExpectedTypeError(item) {
    const rule = getAssetTypeRule(item.expectedType);
    if (!rule || !item.success) {
        return undefined;
    }

    if (rule.assetClasses && leafMatchesAny(item.assetClassPath, rule.assetClasses)) {
        return undefined;
    }
    if (rule.parentClasses && leafMatchesAny(item.nativeParentClassPath, rule.parentClasses)) {
        return undefined;
    }

    const details = [];
    if (item.assetClassPath) {
        details.push(`actual=${item.assetClassPath}`);
    }
    if (item.nativeParentClassPath) {
        details.push(`parent=${item.nativeParentClassPath}`);
    }
    const detail = details.length > 0 ? ` ${details.join(" ")}` : "";
    return `Expected ${rule.label} asset for resource type ${item.expectedType}.${detail}`;
}

function getAssetRegistrySemanticErrors(item) {
    const errors = [];
    const expectedType = normalizeAssetTypeName(item.expectedType);
    const expectedTypeError = getExpectedTypeError(item);
    if (expectedTypeError) {
        errors.push(expectedTypeError);
    }
    if (item.success && expectedType === "widgetclass" && item.isGameAsset && !item.isWidgetBlueprint) {
        errors.push("Expected WidgetBlueprint asset for WidgetClass reference.");
    }
    if (item.success && expectedType === "widgetclass" && !item.isUserWidgetClass) {
        const detail = item.classLoadErrorMessage ? ` ${item.classLoadErrorMessage}` : "";
        errors.push(`WidgetClass must resolve to a UUserWidget subclass.${detail}`);
    }
    if (item.success && expectedType === "dataasset" && !item.isDataAsset && !item.generatedClassIsDataAsset) {
        const detail = getDeepAssetDetail(item);
        errors.push(`DataAsset must be a UDataAsset instance or Blueprint generated class.${detail}`);
    }
    if (item.success && expectedType === "primarydataasset" && !item.isPrimaryDataAsset && !item.generatedClassIsPrimaryDataAsset) {
        const detail = getDeepAssetDetail(item);
        errors.push(`PrimaryDataAsset must be a UPrimaryDataAsset instance or Blueprint generated class.${detail}`);
    }
    if (item.success && expectedType === "animblueprint") {
        if (!item.isAnimBlueprint) {
            const detail = getDeepAssetDetail(item);
            errors.push(`AnimBlueprint resource must reference an AnimBlueprint asset.${detail}`);
        }
        if (!item.generatedClassIsAnimInstance) {
            const detail = item.classLoadErrorMessage ? ` ${item.classLoadErrorMessage}` : getDeepAssetDetail(item);
            errors.push(`AnimBlueprint generated class must derive from UAnimInstance.${detail}`);
        }
    }
    return errors;
}

function getDeepAssetDetail(item) {
    const details = [];
    if (item.loadedObjectClassPath) {
        details.push(`loadedObject=${item.loadedObjectClassPath}`);
    }
    if (item.blueprintParentClassPath) {
        details.push(`blueprintParent=${item.blueprintParentClassPath}`);
    }
    if (item.loadedClassPath) {
        details.push(`loadedClass=${item.loadedClassPath}`);
    }
    if (item.objectLoadErrorMessage) {
        details.push(item.objectLoadErrorMessage);
    }
    return details.length > 0 ? ` ${details.join(" ")}` : "";
}

function readCookRiskContext(context) {
    const configFiles = [
        path.join(context.projectRoot, "Config", "DefaultGame.ini"),
        path.join(context.projectRoot, "Config", "DefaultEngine.ini"),
    ];
    const content = configFiles
        .filter((filePath) => fs.existsSync(filePath))
        .map((filePath) => fs.readFileSync(filePath, "utf-8"))
        .join("\n");

    return {
        hasPackagingSettings: content.includes("[/Script/UnrealEd.ProjectPackagingSettings]"),
        bCookAll: /^bCookAll=True$/im.test(content),
        bCookMapsOnly: /^bCookMapsOnly=True$/im.test(content),
        directoriesToAlwaysCook: extractCookConfigPaths(content, "DirectoriesToAlwaysCook"),
        directoriesToNeverCook: extractCookConfigPaths(content, "DirectoriesToNeverCook"),
        assetManagerScanDirectories: extractAssetManagerScanDirectories(content),
    };
}

function extractCookConfigPaths(content, key) {
    const paths = [];
    const pattern = new RegExp(`${key}=\\(Path=(?:\"([^\"]+)\"|([^\\)]+))\\)`, "gi");
    let match;
    while ((match = pattern.exec(content)) != null) {
        const value = (match[1] || match[2] || "").trim();
        if (value) {
            paths.push(normalizeUnrealCookPath(value));
        }
    }
    return paths;
}

function extractAssetManagerScanDirectories(content) {
    const paths = [];
    for (const line of content.split(/\r?\n/)) {
        if (!line.includes("PrimaryAssetTypesToScan")) {
            continue;
        }
        const pathPattern = /Path="([^"]+)"/g;
        let match;
        while ((match = pathPattern.exec(line)) != null) {
            paths.push(normalizeUnrealCookPath(match[1]));
        }
    }
    return Array.from(new Set(paths));
}

function isUnderUnrealDirectory(assetPackagePath, directories) {
    return directories.some((directory) => assetPackagePath === directory || assetPackagePath.startsWith(`${directory}/`));
}

function findContainingUnrealDirectory(assetPackagePath, directories) {
    return directories.find((directory) => assetPackagePath === directory || assetPackagePath.startsWith(`${directory}/`));
}

function getCookCoverageReasons(item, cookContext) {
    const coverage = [];
    if (!item.success || !item.isGameAsset) {
        return coverage;
    }

    const assetPackagePath = getAssetPackagePath(item);
    if (cookContext.bCookAll && !cookContext.bCookMapsOnly) {
        coverage.push("bCookAll");
    }

    const alwaysCookDirectory = findContainingUnrealDirectory(assetPackagePath, cookContext.directoriesToAlwaysCook);
    if (alwaysCookDirectory) {
        coverage.push(`DirectoriesToAlwaysCook=${alwaysCookDirectory}`);
    }

    const assetManagerDirectory = findContainingUnrealDirectory(assetPackagePath, cookContext.assetManagerScanDirectories);
    if (assetManagerDirectory) {
        coverage.push(`AssetManagerScan=${assetManagerDirectory}`);
    }

    return coverage;
}

function getCookRiskWarnings(item, cookContext, cookCoverage) {
    const warnings = [];
    if (!item.success || !item.isGameAsset) {
        return warnings;
    }

    const assetPackagePath = getAssetPackagePath(item);
    if (isUnderUnrealDirectory(assetPackagePath, cookContext.directoriesToNeverCook)) {
        warnings.push("Asset is under DirectoriesToNeverCook and may be excluded from packaged builds.");
        return warnings;
    }

    if (cookContext.bCookAll && !cookContext.bCookMapsOnly) {
        return warnings;
    }
    if (cookCoverage.length > 0) {
        return warnings;
    }

    const coverage = [];
    if (!cookContext.hasPackagingSettings) {
        coverage.push("ProjectPackagingSettings is not configured");
    }
    coverage.push("manifest references are TS strings and may not be discovered by the cooker");
    coverage.push("add a hard asset reference, PrimaryAssetLabel, AssetManager scan rule, or DirectoriesToAlwaysCook entry");
    warnings.push(coverage.join("; "));
    return warnings;
}

function normalizeAssetRegistryResult(result, context) {
    const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
    const cookContext = readCookRiskContext(context);
    let failureCount = 0;
    let cookWarningCount = 0;

    for (const item of diagnostics) {
        item.semanticErrors = getAssetRegistrySemanticErrors(item);
        item.cookCoverage = getCookCoverageReasons(item, cookContext);
        item.cookWarnings = getCookRiskWarnings(item, cookContext, item.cookCoverage);
        if (!item.success || item.semanticErrors.length > 0) {
            failureCount += 1;
        }
        cookWarningCount += item.cookWarnings.length;
    }

    result.diagnostics = diagnostics;
    result.failureCount = failureCount;
    result.cookWarningCount = cookWarningCount;
    result.success = result.success === true && failureCount === 0;
    return result;
}

function printAssetRegistryDiagnostics(context, result) {
    const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
    info(`AssetRegistry diagnostics: checked=${diagnostics.length} failures=${result.failureCount || 0}`);

    for (const item of diagnostics) {
        if (item.success && (!item.semanticErrors || item.semanticErrors.length === 0)) {
            continue;
        }

        const parts = [];
        if (item.source) {
            parts.push(`source=${item.source}`);
        }
        if (item.key) {
            parts.push(`key=${item.key}`);
        }
        if (item.path) {
            parts.push(`path=${item.path}`);
        }
        if (item.objectPath) {
            parts.push(`object=${item.objectPath}`);
        }
        if (item.assetClassPath) {
            parts.push(`class=${item.assetClassPath}`);
        }
        if (item.generatedClassPath) {
            parts.push(`generatedClass=${item.generatedClassPath}`);
        }
        if (item.loadedClassPath) {
            parts.push(`loadedClass=${item.loadedClassPath}`);
        }
        if (item.loadedObjectClassPath) {
            parts.push(`loadedObject=${item.loadedObjectClassPath}`);
        }
        if (item.blueprintParentClassPath) {
            parts.push(`blueprintParent=${item.blueprintParentClassPath}`);
        }
        if (item.errorMessage) {
            parts.push(item.errorMessage);
        }
        if (item.objectLoadErrorMessage) {
            parts.push(item.objectLoadErrorMessage);
        }
        if (item.semanticErrors && item.semanticErrors.length > 0) {
            parts.push(item.semanticErrors.join(" "));
        }

        warn(`  ${parts.join(" ")}`);
    }

    const cookWarningItems = diagnostics.filter((item) => item.cookWarnings && item.cookWarnings.length > 0);
    if (cookWarningItems.length > 0) {
        warn("AssetRegistry cook warnings:");
        for (const item of cookWarningItems) {
            const parts = [];
            if (item.source) {
                parts.push(`source=${item.source}`);
            }
            if (item.key) {
                parts.push(`key=${item.key}`);
            }
            if (item.path) {
                parts.push(`path=${item.path}`);
            }
            parts.push(item.cookWarnings.join(" "));
            warn(`  ${parts.join(" ")}`);
        }
    }

    const cookCoverageCounts = new Map();
    for (const item of diagnostics) {
        if (!item.success || !item.isGameAsset || !Array.isArray(item.cookCoverage)) {
            continue;
        }
        for (const coverage of item.cookCoverage) {
            cookCoverageCounts.set(coverage, (cookCoverageCounts.get(coverage) || 0) + 1);
        }
    }
    if (cookCoverageCounts.size > 0) {
        const summary = Array.from(cookCoverageCounts.entries()).map(([coverage, count]) => `${coverage} items=${count}`).join(", ");
        info(`AssetRegistry cook coverage: ${summary}`);
    }

    if (result.outputPath) {
        info(`AssetRegistry diagnostics output: ${normalizePath(path.relative(context.projectRoot, result.outputPath))}`);
    }
}

async function runAssetRegistryDoctor(context, report, options = createCliOptions()) {
    const editorPath = findUnrealEditor(context.engineAssociation, options);
    if (!editorPath) {
        fail("Unable to locate UnrealEditor.exe. Pass --editor=E:\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor.exe or set UE_EDITOR.");
    }

    const requests = collectAssetRegistryRequests(report);
    if (requests.length === 0 && !options.isDryRun()) {
        const result = { success: true, requestCount: 0, failureCount: 0, diagnostics: [] };
        printAssetRegistryDiagnostics(context, result);
        return result;
    }

    const diagnosticsDir = path.join(context.projectRoot, "Intermediate", "UEHper", "AssetDiagnostics");
    const requestPath = path.join(diagnosticsDir, "request.json");
    const outputPath = path.join(diagnosticsDir, "result.json");
    const timeoutMs = Number(options.getOptionValue("--asset-registry-timeout-ms") || options.getOptionValue("--timeout-ms") || 300000);

    ensureDir(diagnosticsDir);
    writeJson(requestPath, {
        generatedAt: new Date().toISOString(),
        requests,
    }, { cliOptions: options });
    if (fs.existsSync(outputPath)) {
        fs.rmSync(outputPath, { force: true });
    }

    const args = [
        context.uprojectPath,
        "-NullRHI",
        "-Unattended",
        "-NoSplash",
        `-UEHperRunAssetDiagnostics=${requestPath}`,
        `-UEHperAssetDiagnosticsOutput=${outputPath}`,
        "-log",
    ];

    info(`Running: ${quoteArg(editorPath)} ${args.map(quoteArg).join(" ")}`);
    if (options.isDryRun()) {
        return { success: true, requestCount: requests.length, failureCount: 0, diagnostics: [] };
    }

    return await runPollingProcess(editorPath, args, context.projectRoot, timeoutMs, async (processState) => {
        if (fs.existsSync(outputPath)) {
            const result = normalizeAssetRegistryResult(readJson(outputPath), context);
            result.outputPath = outputPath;
            processState.kill();
            printAssetRegistryDiagnostics(context, result);
            return { done: true, value: result };
        }

        if (processState.exited) {
            fail(`UnrealEditor exited before AssetRegistry diagnostics were written. ExitCode=${processState.exitCode}`);
        }

        return undefined;
    }, {
        timeoutMessage: `Timed out waiting for AssetRegistry diagnostics after ${timeoutMs}ms. Check Saved/Logs for UEHper output.`,
    });
}

module.exports = {
    getDoctorReport,
    runDoctor,
    runAssetRegistryDoctor,
    runWatchRuntimeState,
    analyzeRuntimePackage,
    analyzeServiceGraph,
};
