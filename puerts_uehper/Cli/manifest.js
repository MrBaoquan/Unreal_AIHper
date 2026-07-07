const path = require("path");
const fs = require("fs");
const {
    info,
    warn,
    fail,
    normalizePath,
    readJson,
    writeTextFile,
} = require("./shared");
const {
    createCliOptions,
} = require("./args");
const { getGameDir } = require("./context");
const { normalizeUnrealAssetPath } = require("./unrealPaths");

let ensureProjectManifests = () => fail("Manifest helpers require ensureProjectManifests to be configured.");

function setManifestDependencies(dependencies) {
    if (dependencies.ensureProjectManifests) {
        ensureProjectManifests = dependencies.ensureProjectManifests;
    }
}

function requireArg(options, index, label) {
    const value = options.getArg(index);
    if (!value || value.startsWith("--")) {
        fail(`Missing required argument: ${label}`);
    }
    return value;
}

function toPascalCase(value) {
    return String(value)
        .replace(/[^A-Za-z0-9]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

function findVariableObjectLiteral(ts, source, variableName) {
    let result;
    function visit(node) {
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

function createManifestSource(variableName) {
    return `export const ${variableName} = {\n};\n`;
}

function manifestObjectHasKey(ts, objectLiteral, key) {
    return objectLiteral.properties.some((property) => ts.isPropertyAssignment(property) && propertyNameToString(ts, property.name) === key);
}

function createManifestValueNode(factory, value) {
    if (typeof value === "number") {
        return factory.createNumericLiteral(value);
    }
    if (typeof value === "boolean") {
        return value ? factory.createTrue() : factory.createFalse();
    }
    return factory.createStringLiteral(String(value));
}

function createManifestObjectLiteral(factory, fields) {
    const properties = [];
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
        if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
            continue;
        }
        properties.push(factory.createPropertyAssignment(factory.createIdentifier(fieldName), createManifestValueNode(factory, fieldValue)));
    }
    return factory.createObjectLiteralExpression(properties, false);
}

function insertManifestEntry(context, filePath, variableName, key, fields, options = createCliOptions()) {
    const ts = require(path.join(context.rootNodeModulesDir, "typescript"));
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : createManifestSource(variableName);

    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const manifestObject = findVariableObjectLiteral(ts, source, variableName);
    if (!manifestObject) {
        fail(`Unable to find static object literal ${variableName} in ${normalizePath(filePath)}.`);
    }

    if (manifestObjectHasKey(ts, manifestObject, key)) {
        info(`Manifest entry exists: ${key}`);
        return;
    }

    const transformer = (transformContext) => {
        const visit = (node) => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName && node.initializer) {
                const initializer = unwrapExpression(ts, node.initializer);
                if (initializer && ts.isObjectLiteralExpression(initializer)) {
                    const propertyName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? transformContext.factory.createIdentifier(key) : transformContext.factory.createStringLiteral(key);
                    const property = transformContext.factory.createPropertyAssignment(propertyName, createManifestObjectLiteral(transformContext.factory, fields));
                    const nextInitializer = transformContext.factory.updateObjectLiteralExpression(initializer, [...initializer.properties, property]);
                    return transformContext.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, nextInitializer);
                }
            }
            return ts.visitEachChild(node, visit, transformContext);
        };
        return (node) => ts.visitNode(node, visit);
    };

    const transformResult = ts.transform(source, [transformer]);
    const transformedSource = transformResult.transformed[0];
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const nextContent = printer.printFile(transformedSource);
    transformResult.dispose();
    writeTextFile(filePath, nextContent, { force: true, cliOptions: options });
}

function addResourceManifestEntry(context, key, type, assetPath, options = createCliOptions()) {
    const resourcePath = path.join(getGameDir(context), "Manifests", "resources.ts");
    if (!fs.existsSync(resourcePath)) {
        ensureProjectManifests(context, options);
    }
    insertManifestEntry(context, resourcePath, "resourceManifest", key, { type, path: assetPath }, options);
}

function addUiManifestEntry(context, key, widgetClass, layer = "HUD", options = createCliOptions()) {
    const uiPath = path.join(getGameDir(context), "Manifests", "ui.ts");
    if (!fs.existsSync(uiPath)) {
        ensureProjectManifests(context, options);
    }
    insertManifestEntry(context, uiPath, "uiManifest", key, { widgetClass, layer }, options);
}

function addSceneManifestEntry(context, key, levelName, mapPath, options = createCliOptions()) {
    const scenePath = path.join(getGameDir(context), "Manifests", "scenes.ts");
    if (!fs.existsSync(scenePath)) {
        ensureProjectManifests(context, options);
    }

    const resolvedMapPath = mapPath || (normalizeUnrealAssetPath(levelName).startsWith("/Game/") ? levelName : "");
    insertManifestEntry(context, scenePath, "sceneManifest", key, { levelName, mapPath: resolvedMapPath }, options);
}

function getExportedAssetObjectPath(asset) {
    if (asset.objectPath) {
        return asset.objectPath;
    }
    if (asset.packagePath && asset.assetName) {
        return `${asset.packagePath}.${asset.assetName}`;
    }
    return "";
}

function getExportedAssetPackagePath(asset) {
    if (asset.packagePath) {
        return asset.packagePath;
    }
    const objectPath = getExportedAssetObjectPath(asset);
    return objectPath.includes(".") ? objectPath.slice(0, objectPath.indexOf(".")) : objectPath;
}

function getExportedAssetKey(asset) {
    const assetName = asset.assetName || path.basename(getExportedAssetPackagePath(asset));
    return toPascalCase(String(assetName).replace(/^(WBP|BP|SM|SK|MI|M|T|DA|PDA|LS)_/i, "")) || assetName;
}

function getWidgetClassPathFromExportedAsset(asset) {
    if (asset.generatedClassPath) {
        return asset.generatedClassPath;
    }
    const objectPath = getExportedAssetObjectPath(asset);
    return objectPath ? `${objectPath}_C` : "";
}

function getExportedAssetClassLeaf(asset) {
    return getUnrealTypeLeaf(asset.assetClassPath || asset.assetClass || asset.classPath || "");
}

function isExportedSceneAsset(asset) {
    return String(asset.suggestedKind || "").toLowerCase() === "scene" || getExportedAssetClassLeaf(asset).toLowerCase() === "world";
}

function isExportedWidgetAsset(asset) {
    const suggestedKind = String(asset.suggestedKind || "").toLowerCase();
    const classLeaf = getExportedAssetClassLeaf(asset).toLowerCase();
    return suggestedKind === "widget" || classLeaf === "widgetblueprint";
}

function inferResourceTypeFromExportedAsset(asset) {
    const classLeaf = getExportedAssetClassLeaf(asset).toLowerCase();
    const typeMap = new Map([
        ["staticmesh", "StaticMesh"],
        ["skeletalmesh", "SkeletalMesh"],
        ["material", "Material"],
        ["materialinstanceconstant", "Material"],
        ["texture2d", "Texture2D"],
        ["soundwave", "SoundWave"],
        ["soundcue", "SoundCue"],
        ["datatable", "DataTable"],
        ["curvetable", "CurveTable"],
        ["blueprint", "Blueprint"],
        ["dataasset", "DataAsset"],
        ["primarydataasset", "DataAsset"],
        ["levelsequence", "LevelSequence"],
        ["niagarasystem", "NiagaraSystem"],
        ["niagaraemitter", "NiagaraEmitter"],
    ]);
    return typeMap.get(classLeaf) || getExportedAssetClassLeaf(asset) || "Object";
}

function runManifestSelected(context, options) {
    const selectedAssetsPath = path.resolve(context.projectRoot, requireArg(options, 4, "selected assets json path"));
    const payload = readJson(selectedAssetsPath);
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    if (assets.length === 0) {
        warn(`No selected assets found in ${normalizePath(selectedAssetsPath)}.`);
        return;
    }

    for (const asset of assets) {
        const key = getExportedAssetKey(asset);
        if (isExportedSceneAsset(asset)) {
            const mapPath = getExportedAssetPackagePath(asset);
            addSceneManifestEntry(context, key, mapPath, mapPath, options);
            continue;
        }

        if (isExportedWidgetAsset(asset)) {
            const resourceKey = `${key}Class`;
            addResourceManifestEntry(context, resourceKey, "WidgetClass", getWidgetClassPathFromExportedAsset(asset), options);
            addUiManifestEntry(context, key, resourceKey, options.getOptionValue("--layer") || "HUD", options);
            continue;
        }

        addResourceManifestEntry(context, key, inferResourceTypeFromExportedAsset(asset), getExportedAssetObjectPath(asset), options);
    }
}

function makeUI(context, options = createCliOptions()) {
    const key = requireArg(options, 4, "UI key");
    const widgetClass = requireArg(options, 5, "widget class path");
    addUiManifestEntry(context, key, widgetClass, options.getOptionValue("--layer") || "HUD", options);
}

function makeResource(context, options = createCliOptions()) {
    const key = requireArg(options, 4, "resource key");
    const type = requireArg(options, 5, "resource type");
    const assetPath = requireArg(options, 6, "asset path");
    addResourceManifestEntry(context, key, type, assetPath, options);
}

function makeScene(context, options = createCliOptions()) {
    const key = requireArg(options, 4, "scene key");
    const levelName = requireArg(options, 5, "level name");
    const mapPath = options.getPositionalArg(6) || (normalizeUnrealAssetPath(levelName).startsWith("/Game/") ? levelName : "");
    addSceneManifestEntry(context, key, levelName, mapPath, options);
}

function runManifest(context, options = createCliOptions()) {
    const manifestTarget = options.getTarget();
    if (manifestTarget === "resource") {
        const key = requireArg(options, 4, "resource key");
        const type = requireArg(options, 5, "resource type");
        const assetPath = requireArg(options, 6, "asset path");
        addResourceManifestEntry(context, key, type, assetPath, options);
        return;
    }

    if (manifestTarget === "scene") {
        const key = requireArg(options, 4, "scene key");
        const levelName = requireArg(options, 5, "level name");
        const mapPath = options.getPositionalArg(6);
        addSceneManifestEntry(context, key, levelName, mapPath, options);
        return;
    }

    if (manifestTarget === "widget") {
        const key = requireArg(options, 4, "UI key");
        const widgetClassPath = requireArg(options, 5, "widget class path");
        const resourceKey = options.getOptionValue("--resource-key") || `${key}Class`;
        const layer = options.getOptionValue("--layer") || "HUD";
        addResourceManifestEntry(context, resourceKey, "WidgetClass", widgetClassPath, options);
        addUiManifestEntry(context, key, resourceKey, layer, options);
        return;
    }

    if (manifestTarget === "selected") {
        runManifestSelected(context, options);
        return;
    }

    fail("Unsupported manifest target. Use resource, scene, widget, or selected.");
}

module.exports = {
    setManifestDependencies,
    addResourceManifestEntry,
    addUiManifestEntry,
    addSceneManifestEntry,
    makeUI,
    makeResource,
    makeScene,
    runManifest,
};
