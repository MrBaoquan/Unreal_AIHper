const assert = require("assert");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
    createDoctorFailureProject,
    findCurrentProjectRoot,
    removeTempDir,
} = require("./testHelpers");

const tests = [];
const frameworkRoot = path.resolve(__dirname, "..", "..");
const projectRoot = findCurrentProjectRoot();
const cliPath = path.join(frameworkRoot, "uehper.js");

function test(name, callback) {
    tests.push({ name, callback });
}

function runCli(args) {
    try {
        return execFileSync(process.execPath, [cliPath, ...args], {
            cwd: projectRoot,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
        });
    } catch (error) {
        const stdout = error.stdout ? String(error.stdout) : "";
        const stderr = error.stderr ? String(error.stderr) : "";
        throw new Error(`CLI failed: ${args.join(" ")}\n${stdout}${stderr}`);
    }
}

function runCliWithCwd(args, cwd) {
    try {
        return execFileSync(process.execPath, [cliPath, ...args], {
            cwd,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
        });
    } catch (error) {
        const stdout = error.stdout ? String(error.stdout) : "";
        const stderr = error.stderr ? String(error.stderr) : "";
        throw new Error(`CLI failed: ${args.join(" ")}
${stdout}${stderr}`);
    }
}

function runCliFailure(args, options = {}) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...(options.env || {}) },
    });
    return {
        status: result.status,
        output: `${result.stdout || ""}${result.stderr || ""}`,
    };
}

function assertIncludes(output, expected, label) {
    assert.ok(output.includes(expected), `${label || "output"} should include ${expected}\n${output}`);
}

test("bootstrap --dry-run routes through bootstrap.js", () => {
    const output = runCli(["bootstrap", "--dry-run"]);
    assertIncludes(output, "Bootstrap finished.", "bootstrap dry-run");
    assertIncludes(output, "Content/JavaScript/package.json", "bootstrap dry-run");
});

test("help prints the command reference", () => {
    const output = runCli(["help"]);
    assertIncludes(output, "Usage: puerts-uehper", "help");
    assertIncludes(output, "Run from the Unreal project root", "help");
    assertIncludes(output, "npx puerts_uehper", "help");
    assertIncludes(output, "Local source checkout fallback:", "help");
    assertIncludes(output, "node uehper.js <command>", "help");
    assertIncludes(output, "ensure-ui-validation-widget", "help");
});

test("--help prints the command reference", () => {
    const output = runCli(["--help"]);
    assertIncludes(output, "Usage: puerts-uehper", "--help");
    assert.ok(!output.includes("Unsupported command"), `--help should not be treated as a command failure\n${output}`);
});

test("doctor supports --project from outside the project root", () => {
    const output = runCliWithCwd(["doctor", "--project=" + projectRoot], frameworkRoot);
    assertIncludes(output, "Project root:", "doctor --project");
    assertIncludes(output, "HanDan_XR_CYQJ", "doctor --project");
    assertIncludes(output, "runtimePackageReady", "doctor --project");
});

test("install --dry-run keeps build as a dry-run command", () => {
    const output = runCli(["install", "--dry-run"]);
    assertIncludes(output, "Bootstrap finished.", "install dry-run");
    assertIncludes(output, "Running: node ./node_modules/typescript/bin/tsc --build ./tsconfig.json", "install dry-run");
    assert.ok(!output.includes("TypeScript build finished."), `install dry-run should not report build completion\n${output}`);
});

test("sync-runtime --dry-run prints the runtime package target", () => {
    const output = runCli(["sync-runtime", "--dry-run"]);
    assertIncludes(output, "Syncing runtime package", "sync-runtime dry-run");
    assertIncludes(output, "Content/JavaScript/node_modules/puerts_uehper", "sync-runtime dry-run");
});

test("watch --dry-run prints the business TypeScript watch command", () => {
    const output = runCli(["watch", "--dry-run"]);
    assertIncludes(output, "Watching business TypeScript", "watch dry-run");
    assertIncludes(output, "--watch", "watch dry-run");
    assertIncludes(output, "Content/JavaScript", "watch dry-run");
});

test("doctor --cook --dry-run prints the Cook commandlet", () => {
    const output = runCli(["doctor", "--cook", "--dry-run"]);
    assertIncludes(output, "Cook commandlet: platform=Windows", "cook dry-run");
    assertIncludes(output, "-run=Cook", "cook dry-run");
    assertIncludes(output, "-TargetPlatform=Windows", "cook dry-run");
});

test("doctor --asset-registry --dry-run prints the AssetRegistry Editor command", () => {
    const output = runCli(["doctor", "--asset-registry", "--dry-run"]);
    assertIncludes(output, "-UEHperRunAssetDiagnostics=", "asset registry dry-run");
    assertIncludes(output, "-UEHperAssetDiagnosticsOutput=", "asset registry dry-run");
});

test("ensure-cook-smoke-map --dry-run prints the Editor automation command", () => {
    const output = runCli(["ensure-cook-smoke-map", "--cook-map=/Game/UEHper/CliFixtureDryRun", "--dry-run"]);
    assertIncludes(output, "Ensuring CookSmoke map: /Game/UEHper/CliFixtureDryRun", "cook smoke dry-run");
    assertIncludes(output, "-UEHperEnsureCookSmokeMap=/Game/UEHper/CliFixtureDryRun", "cook smoke dry-run");
});

test("ensure-ui-validation-widget --dry-run prints the Editor automation command", () => {
    const output = runCli(["ensure-ui-validation-widget", "--dry-run"]);
    assertIncludes(output, "Ensuring UI validation widget: /Game/UEHper/UI/WBP_UIValidation", "ui widget dry-run");
    assertIncludes(output, "-UEHperEnsureUIValidationWidget=/Game/UEHper/UI/WBP_UIValidation", "ui widget dry-run");
});

test("gen-typings --dry-run prints the Puerts.Gen Editor command", () => {
    const output = runCli(["gen-typings", "--dry-run"]);
    assertIncludes(output, "-UEHperRunPuertsGen=FULL", "gen typings dry-run");
});

test("unsupported command exits with code one", () => {
    const result = runCliFailure(["__missing_command__"]);
    assert.strictEqual(result.status, 1, `unsupported command should exit 1\n${result.output}`);
    assertIncludes(result.output, "Unsupported command: __missing_command__", "unsupported command failure");
});

test("doctor failure exits with code one", () => {
    const { fixtureRoot, scriptRoot } = createDoctorFailureProject();
    try {
        const result = runCliFailure(["doctor", "--project=" + fixtureRoot], { env: { UEHPER_CLI_SCRIPT_ROOT: scriptRoot } });
        assert.strictEqual(result.status, 1, `doctor failure should exit 1\n${result.output}`);
        assertIncludes(result.output, "Missing Puerts backend directory.", "doctor failure");
    } finally {
        removeTempDir(fixtureRoot);
    }
});

for (const { name, callback } of tests) {
    callback();
    console.log(`[cli-fixtures] ok ${name}`);
}

console.log(`[cli-fixtures] ${tests.length} tests passed.`);
