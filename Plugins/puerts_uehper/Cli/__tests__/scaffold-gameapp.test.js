const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCliOptions } = require("../args");
const { makeApp, makeService, ensureUEHperConfig, ensureProjectManifests } = require("../scaffold");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function withFixture(callback) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uehper-gameapp-"));
    const context = {
        projectRoot: fixtureRoot,
        projectTypescriptDir: path.join(fixtureRoot, "TypeScript"),
        rootNodeModulesDir: path.join(fixtureRoot, "node_modules"),
    };
    try {
        callback(context, fixtureRoot);
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

test("makeApp emits direct lifecycle entry class", () => {
    withFixture((context) => {
        makeApp(context);
        const content = fs.readFileSync(path.join(context.projectTypescriptDir, "Game", "GameApp.ts"), "utf-8");
        assert.ok(content.includes("export default class GameApp extends ConfiguredProjectGameApp"), "template exports a concrete GameApp class");
        assert.ok(content.includes("constructor()"), "template includes constructor for projectConfig wiring");
        assert.ok(content.includes("async initializeRoot(rootContext: FrameworkContext)"), "template includes initializeRoot entry point");
        assert.ok(content.includes("async initializeWorld(context: FrameworkContext)"), "template includes initializeWorld entry point");
        assert.ok(content.includes("async onWorldBeginPlay(context: FrameworkContext)"), "template includes BeginPlay entry point");
        assert.ok(content.includes("async onWorldCleanup(context: FrameworkContext)"), "template includes Cleanup entry point");
        assert.ok(!content.includes("createProjectGameApp"), "template no longer uses shortcut export");
        assert.ok(!content.includes("// export default class GameApp"), "template no longer comments out the lifecycle class");
    });
});

test("ensureProjectManifests emits examples and editor-generation notes", () => {
    withFixture((context) => {
        ensureProjectManifests(context);
        const ui = fs.readFileSync(path.join(context.projectTypescriptDir, "Game", "Manifests", "ui.ts"), "utf-8");
        const resources = fs.readFileSync(path.join(context.projectTypescriptDir, "Game", "Manifests", "resources.ts"), "utf-8");
        const scenes = fs.readFileSync(path.join(context.projectTypescriptDir, "Game", "Manifests", "scenes.ts"), "utf-8");
        assert.ok(ui.includes("Generate UEHper Manifest from Selection"), "ui manifest explains editor one-step workflow");
        assert.ok(resources.includes("manifest selected"), "resources manifest explains selected-assets import");
        assert.ok(scenes.includes("manifest scene"), "scenes manifest explains manual scene command");
        assert.ok(ui.includes("GameHUD"), "ui manifest includes example entry");
        assert.ok(resources.includes("CandyMesh"), "resources manifest includes example entry");
        assert.ok(scenes.includes("LEVELgame"), "scenes manifest includes example entry");
    });
});

test("makeService emits dispose + lifecycle registration hint", () => {
    withFixture((context) => {
        const options = createCliOptions(["node", "uehper.js", "make", "service", "Combat"]);
        makeService(context, options);
        const content = fs.readFileSync(path.join(context.projectTypescriptDir, "Game", "Services", "Combat.ts"), "utf-8");
        assert.ok(content.includes("export default class Combat"), "service class is generated");
        assert.ok(content.includes("dispose()"), "service template includes dispose()");
        assert.ok(content.includes("services.register('combat'"), "service template documents lower-cased registration key");
        assert.ok(content.includes("lifecycle: ['register', 'initialize', 'dispose']"), "service template documents lifecycle metadata");
    });
});

test("ensureUEHperConfig writes BootstrapTimeoutSeconds default", () => {
    withFixture((context) => {
        ensureUEHperConfig(context);
        const content = fs.readFileSync(path.join(context.projectRoot, "Config", "DefaultUEHper.ini"), "utf-8");
        assert.ok(content.includes("BootstrapTimeoutSeconds=30.000000"), "scaffold ini includes BootstrapTimeoutSeconds default");
        assert.ok(content.includes("EntryModule=Game/GameApp"), "scaffold ini keeps EntryModule");
    });
});

test("ensureUEHperConfig honors resolved entryModule", () => {
    withFixture((context) => {
        context.entryModule = "GameApp";
        ensureUEHperConfig(context);
        const content = fs.readFileSync(path.join(context.projectRoot, "Config", "DefaultUEHper.ini"), "utf-8");
        assert.ok(content.includes("EntryModule=GameApp"), "scaffold ini uses context entryModule");
    });
});

test("makeApp can write directly into the configured source root", () => {
    withFixture((context) => {
        context.projectAppDir = context.projectTypescriptDir;
        makeApp(context);
        const content = fs.readFileSync(path.join(context.projectTypescriptDir, "GameApp.ts"), "utf-8");
        assert.ok(content.includes("export default class GameApp extends ConfiguredProjectGameApp"), "app scaffold can live at source root");
        assert.ok(!fs.existsSync(path.join(context.projectTypescriptDir, "Game", "GameApp.ts")), "source-root layout does not create Game/GameApp.ts");
    });
});

test("makeApp is idempotent: skips overwriting existing GameApp.ts without --force", () => {
    withFixture((context) => {
        makeApp(context);
        const gameAppPath = path.join(context.projectTypescriptDir, "Game", "GameApp.ts");
        const customMarker = "// CUSTOM USER CODE -- DO NOT OVERWRITE";
        fs.writeFileSync(gameAppPath, customMarker);

        // Default options (no --force) must keep user content intact.
        makeApp(context);
        const after = fs.readFileSync(gameAppPath, "utf-8");
        assert.equal(after, customMarker, "make app without --force must not overwrite existing file");
    });
});

test("makeApp --force overwrites existing GameApp.ts", () => {
    withFixture((context) => {
        const gameAppPath = path.join(context.projectTypescriptDir, "Game", "GameApp.ts");
        fs.mkdirSync(path.dirname(gameAppPath), { recursive: true });
        fs.writeFileSync(gameAppPath, "// stale content");

        const forced = createCliOptions(["node", "uehper.js", "make", "app", "--force"]);
        makeApp(context, forced);
        const after = fs.readFileSync(gameAppPath, "utf-8");
        assert.ok(after.includes("export default class GameApp extends ConfiguredProjectGameApp"), "--force regenerates GameApp.ts from template");
        assert.ok(!after.includes("stale content"), "--force overwrites stale content");
    });
});

test("makeService is idempotent: refuses to overwrite without --force, accepts --force", () => {
    withFixture((context) => {
        const baseArgs = ["node", "uehper.js", "make", "service", "Combat"];
        makeService(context, createCliOptions(baseArgs));
        const servicePath = path.join(context.projectTypescriptDir, "Game", "Services", "Combat.ts");
        const customMarker = "// EDITED BY USER";
        fs.writeFileSync(servicePath, customMarker);

        // Re-run without --force: must keep custom content.
        makeService(context, createCliOptions(baseArgs));
        assert.equal(fs.readFileSync(servicePath, "utf-8"), customMarker, "make service without --force must not overwrite");

        // Re-run with --force: regenerates template.
        makeService(context, createCliOptions([...baseArgs, "--force"]));
        const forced = fs.readFileSync(servicePath, "utf-8");
        assert.ok(forced.includes("export default class Combat"), "--force regenerates service from template");
        assert.ok(!forced.includes("EDITED BY USER"), "--force overwrites user edits");
    });
});

for (const { name, callback } of tests) {
    callback();
    console.log(`[scaffold-gameapp] ok ${name}`);
}

console.log(`[scaffold-gameapp] ${tests.length} tests passed.`);
