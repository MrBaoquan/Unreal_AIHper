const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCliOptions } = require("../args");
const { ensureProjectManifests } = require("../scaffold");
const { findCurrentProjectRoot } = require("./testHelpers");
const {
    setManifestDependencies,
    runManifest,
    addResourceManifestEntry,
    addUiManifestEntry,
    addSceneManifestEntry,
} = require("../manifest");

const tests = [];
const projectRoot = findCurrentProjectRoot();

setManifestDependencies({ ensureProjectManifests });

function test(name, callback) {
    tests.push({ name, callback });
}

function createFixture() {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uehper-cli-"));
    return {
        fixtureRoot,
        context: {
            projectRoot: fixtureRoot,
            projectTypescriptDir: path.join(fixtureRoot, "TypeScript"),
            rootNodeModulesDir: path.join(projectRoot, "node_modules"),
        },
    };
}

function withFixture(callback) {
    const { fixtureRoot, context } = createFixture();
    try {
        callback(context);
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function readGameFile(context, relativePath) {
    return fs.readFileSync(path.join(context.projectTypescriptDir, "Game", relativePath), "utf-8");
}

function countOccurrences(content, value) {
    return content.split(value).length - 1;
}

test("ensureProjectManifests writes the base scaffold idempotently", () => {
    withFixture((context) => {
        ensureProjectManifests(context);

        const projectConfigPath = path.join(context.projectTypescriptDir, "Game", "ProjectConfig.ts");
        const modulesIndexPath = path.join(context.projectTypescriptDir, "Game", "Modules", "index.ts");
        assert.ok(fs.existsSync(projectConfigPath), "ProjectConfig.ts should be created");
        assert.ok(fs.existsSync(modulesIndexPath), "Modules/index.ts should be created");

        fs.appendFileSync(projectConfigPath, "\n// keep me\n");
        ensureProjectManifests(context);

        const projectConfig = fs.readFileSync(projectConfigPath, "utf-8");
        assert.ok(projectConfig.includes("// keep me"), "existing scaffold files should not be overwritten");
        assert.ok(projectConfig.includes("resourceManifest"), "ProjectConfig should wire resourceManifest");
        assert.ok(projectConfig.includes("uiManifest"), "ProjectConfig should wire uiManifest");
        assert.ok(projectConfig.includes("modules"), "ProjectConfig should wire modules");
    });
});

test("ensureProjectManifests honors explicit dry-run options", () => {
    withFixture((context) => {
        const options = createCliOptions(["node", "uehper.js", "init", "--dry-run"]);
        ensureProjectManifests(context, options);

        assert.ok(!fs.existsSync(path.join(context.projectTypescriptDir, "Game")), "dry-run scaffold should not write Game files");
    });
});

test("ensureProjectManifests supports app-dir at source root", () => {
    withFixture((context) => {
        context.projectAppDir = context.projectTypescriptDir;
        ensureProjectManifests(context);

        assert.ok(fs.existsSync(path.join(context.projectTypescriptDir, "ProjectConfig.ts")), "ProjectConfig.ts should be created at source root");
        assert.ok(fs.existsSync(path.join(context.projectTypescriptDir, "Modules", "index.ts")), "Modules/index.ts should be created at source root");
        assert.ok(!fs.existsSync(path.join(context.projectTypescriptDir, "Game", "ProjectConfig.ts")), "source-root layout should not create Game/ProjectConfig.ts");
    });
});

test("manifest helpers insert entries once", () => {
    withFixture((context) => {
        ensureProjectManifests(context);

        addResourceManifestEntry(context, "SugarMesh", "StaticMesh", "/Game/Props/SM_Sugar.SM_Sugar");
        addResourceManifestEntry(context, "SugarMesh", "StaticMesh", "/Game/Props/SM_Sugar.SM_Sugar");
        addUiManifestEntry(context, "HudMain", "HudMainClass", "Overlay");
        addUiManifestEntry(context, "HudMain", "HudMainClass", "Overlay");
        addSceneManifestEntry(context, "CandyRoom", "/Game/Maps/CandyRoom", "/Game/Maps/CandyRoom");
        addSceneManifestEntry(context, "CandyRoom", "/Game/Maps/CandyRoom", "/Game/Maps/CandyRoom");

        const resources = readGameFile(context, path.join("Manifests", "resources.ts"));
        const ui = readGameFile(context, path.join("Manifests", "ui.ts"));
        const scenes = readGameFile(context, path.join("Manifests", "scenes.ts"));

        assert.strictEqual(countOccurrences(resources, "SugarMesh:"), 1, "resource entry should be idempotent");
        assert.ok(resources.includes('type: "StaticMesh"'), "resource entry should include type");
        assert.ok(resources.includes('path: "/Game/Props/SM_Sugar.SM_Sugar"'), "resource entry should include asset path");
        assert.strictEqual(countOccurrences(ui, "HudMain:"), 1, "UI entry should be idempotent");
        assert.ok(ui.includes('widgetClass: "HudMainClass"'), "UI entry should include widget class key");
        assert.ok(ui.includes('layer: "Overlay"'), "UI entry should include layer");
        assert.strictEqual(countOccurrences(scenes, "CandyRoom:"), 1, "scene entry should be idempotent");
        assert.ok(scenes.includes('levelName: "/Game/Maps/CandyRoom"'), "scene entry should include level name");
        assert.ok(scenes.includes('mapPath: "/Game/Maps/CandyRoom"'), "scene entry should include map path");
    });
});

test("manifest selected imports scene widget and resource assets", () => {
    withFixture((context) => {
        const selectedAssetsPath = path.join(context.projectRoot, "selected-assets.json");
        fs.writeFileSync(selectedAssetsPath, JSON.stringify({
            assets: [
                {
                    packagePath: "/Game/Maps/MainLevel",
                    assetName: "MainLevel",
                    assetClassPath: "/Script/Engine.World",
                    suggestedKind: "scene",
                },
                {
                    objectPath: "/Game/UI/WBP_MainHud.WBP_MainHud",
                    packagePath: "/Game/UI/WBP_MainHud",
                    assetName: "WBP_MainHud",
                    assetClassPath: "/Script/UMGEditor.WidgetBlueprint",
                    generatedClassPath: "/Game/UI/WBP_MainHud.WBP_MainHud_C",
                    suggestedKind: "widget",
                },
                {
                    objectPath: "/Game/Props/SM_Candy.SM_Candy",
                    packagePath: "/Game/Props/SM_Candy",
                    assetName: "SM_Candy",
                    assetClassPath: "/Script/Engine.StaticMesh",
                },
                {
                    objectPath: "/Game/Blueprints/BP_Door.BP_Door",
                    packagePath: "/Game/Blueprints/BP_Door",
                    assetName: "BP_Door",
                    assetClassPath: "/Script/Engine.Blueprint",
                },
                {
                    objectPath: "/Game/Data/DA_ItemTable.DA_ItemTable",
                    packagePath: "/Game/Data/DA_ItemTable",
                    assetName: "DA_ItemTable",
                    assetClassPath: "/Script/Engine.DataAsset",
                },
                {
                    objectPath: "/Game/Cinematics/LS_Intro.LS_Intro",
                    packagePath: "/Game/Cinematics/LS_Intro",
                    assetName: "LS_Intro",
                    assetClassPath: "/Script/LevelSequence.LevelSequence",
                },
            ],
        }, null, 2));

        const options = createCliOptions(["node", "uehper.js", "manifest", "selected", "selected-assets.json", "--layer=Menu"]);
        runManifest(context, options);

        const resources = readGameFile(context, path.join("Manifests", "resources.ts"));
        const ui = readGameFile(context, path.join("Manifests", "ui.ts"));
        const scenes = readGameFile(context, path.join("Manifests", "scenes.ts"));

        assert.strictEqual(countOccurrences(scenes, "MainLevel:"), 1, "World asset should create a scene entry");
        assert.ok(scenes.includes('mapPath: "/Game/Maps/MainLevel"'), "scene entry should use package path as mapPath");
        assert.strictEqual(countOccurrences(resources, "MainHudClass:"), 1, "Widget asset should create a widget class resource");
        assert.ok(resources.includes('path: "/Game/UI/WBP_MainHud.WBP_MainHud_C"'), "widget resource should use generated class path");
        assert.strictEqual(countOccurrences(ui, "MainHud:"), 1, "Widget asset should create a UI entry");
        assert.ok(ui.includes('layer: "Menu"'), "UI entry should use selected import layer option");
        assert.strictEqual(countOccurrences(resources, "Candy:"), 1, "StaticMesh asset should create a resource entry");
        assert.ok(resources.includes('type: "StaticMesh"'), "StaticMesh resource should infer type");
        assert.ok(resources.includes('path: "/Game/Props/SM_Candy.SM_Candy"'), "StaticMesh resource should use object path");
        assert.strictEqual(countOccurrences(resources, "Door:"), 1, "Blueprint asset should create a resource entry");
        assert.ok(resources.includes('type: "Blueprint"'), "Blueprint resource should infer type");
        assert.strictEqual(countOccurrences(resources, "ItemTable:"), 1, "DataAsset should create a resource entry with DA_ stripped");
        assert.ok(resources.includes('type: "DataAsset"'), "DataAsset resource should infer type");
        assert.strictEqual(countOccurrences(resources, "Intro:"), 1, "LevelSequence should create a resource entry with LS_ stripped");
        assert.ok(resources.includes('type: "LevelSequence"'), "LevelSequence resource should infer type");
    });
});

for (const { name, callback } of tests) {
    callback();
    console.log(`[manifest-scaffold] ok ${name}`);
}

console.log(`[manifest-scaffold] ${tests.length} tests passed.`);