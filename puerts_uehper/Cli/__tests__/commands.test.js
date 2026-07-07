const assert = require("assert");
const path = require("path");
const { createCliOptions } = require("../args");
const {
    normalizeCommandResult,
    runCommand,
} = require("../commands");
const {
    createTempDir,
    removeTempDir,
} = require("./testHelpers");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

test("normalizes empty command result as success", () => {
    assert.deepStrictEqual(normalizeCommandResult(undefined), { success: true, exitCode: 0 });
});

test("normalizes false command result as failure", () => {
    assert.deepStrictEqual(normalizeCommandResult(false), { success: false, exitCode: 1 });
});

test("defaults failed object result exit code to one", () => {
    assert.deepStrictEqual(normalizeCommandResult({ success: false }), { success: false, exitCode: 1 });
});

test("preserves explicit integer exit code", () => {
    assert.deepStrictEqual(normalizeCommandResult({ success: false, exitCode: 7 }), { success: false, exitCode: 7 });
});

function createDoctorFailureContext(fixtureRoot) {
    return {
        projectRoot: fixtureRoot,
        uprojectPath: path.join(fixtureRoot, "Fixture.uproject"),
        engineAssociation: "5.5",
        puertsPath: path.join(fixtureRoot, "Plugins", "Puerts"),
        jsEnvConfig: { backendType: "v8", expectedBackendDir: "v8_missing" },
        contentJavascriptDir: path.join(fixtureRoot, "Content", "JavaScript"),
        rootPackagePath: path.join(fixtureRoot, "package.json"),
        rootTsConfigPath: path.join(fixtureRoot, "tsconfig.json"),
        rootNodeModulesDir: path.join(fixtureRoot, "node_modules"),
        projectTypescriptDir: path.join(fixtureRoot, "TypeScript"),
        frameworkDir: path.join(fixtureRoot, "TypeScript", "puerts_uehper"),
        isFrameworkInProjectTypescript: false,
        typingsDir: path.join(fixtureRoot, "Typing", "ue"),
        thirdPartyDir: path.join(fixtureRoot, "Plugins", "Puerts", "ThirdParty"),
        puertsEditorTypescriptPath: path.join(fixtureRoot, "Content", "JavaScript", "PuertsEditor", "node_modules", "typescript"),
        runtimeNodeModulesDir: path.join(fixtureRoot, "Content", "JavaScript", "node_modules"),
        projectTypingUE: path.join(fixtureRoot, "Typing", "ue", "ue.d.ts"),
        projectTypingUEBP: path.join(fixtureRoot, "Typing", "ue", "ue_bp.d.ts"),
        backendPath: path.join(fixtureRoot, "Plugins", "Puerts", "ThirdParty", "v8_missing"),
        rootTypescriptCompiler: path.join(fixtureRoot, "node_modules", "typescript", "bin", "tsc"),
    };
}

async function withMutedConsole(callback) {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    try {
        console.log = () => undefined;
        console.warn = () => undefined;
        console.error = () => undefined;
        return await callback();
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    }
}

test("doctor failure returns exit code one", async () => {
    const fixtureRoot = createTempDir("uehper-doctor-failure-");
    try {
        const result = await withMutedConsole(() => runCommand("doctor", createDoctorFailureContext(fixtureRoot), createCliOptions(["node", "uehper.js", "doctor"])));
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.exitCode, 1);
    } finally {
        removeTempDir(fixtureRoot);
    }
});

(async () => {
    for (const { name, callback } of tests) {
        await callback();
        console.log(`[commands] ok ${name}`);
    }

    console.log(`[commands] ${tests.length} tests passed.`);
})().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});