const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    RUNTIME_STATE_PATTERN,
    UE_LOG_PREFIX_PATTERN,
    parseUeLogPrefix,
    listLogFilesByMtimeDesc,
    pickLatestLog,
    readRuntimeStateLastKnown,
    analyzeRuntimeBootstrapReadinessLines,
    readRuntimeBootstrapReadiness,
} = require("../runtimeLog");

const tests = [];
function test(name, callback) {
    tests.push({ name, callback });
}

function withFixture(callback) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uehper-runtimelog-"));
    try {
        callback(fixtureRoot);
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function writeLog(logsDir, name, content, mtimeMs) {
    const full = path.join(logsDir, name);
    fs.writeFileSync(full, content);
    if (typeof mtimeMs === "number") {
        const t = mtimeMs / 1000;
        fs.utimesSync(full, t, t);
    }
    return full;
}

test("RUNTIME_STATE_PATTERN captures from/to", () => {
    const m = "LogUEHper: RuntimeState Initializing -> RuntimeReady".match(RUNTIME_STATE_PATTERN);
    assert.ok(m);
    assert.strictEqual(m[1], "Initializing");
    assert.strictEqual(m[2], "RuntimeReady");
});

test("UE_LOG_PREFIX_PATTERN matches standard UE log line", () => {
    const ok = "[2026.05.26-17.25.43:123][  0]LogUEHper: RuntimeState X -> Y".match(UE_LOG_PREFIX_PATTERN);
    assert.ok(ok, "should match standard UE log prefix");
});

test("parseUeLogPrefix returns ueTs/frame/category", () => {
    const out = parseUeLogPrefix("[2026.05.26-17.25.43:123][ 42]LogUEHper: RuntimeState X -> Y");
    assert.deepStrictEqual(out, {
        ueTs: "2026-05-26T17:25:43.123",
        frame: 42,
        category: "LogUEHper",
    });
});

test("parseUeLogPrefix returns null on non-matching line", () => {
    assert.strictEqual(parseUeLogPrefix("plain line without prefix"), null);
    assert.strictEqual(parseUeLogPrefix(""), null);
    assert.strictEqual(parseUeLogPrefix(undefined), null);
});

test("listLogFilesByMtimeDesc sorts by mtime descending and ignores non-.log files", () => {
    withFixture((root) => {
        const logsDir = path.join(root, "Saved", "Logs");
        fs.mkdirSync(logsDir, { recursive: true });
        const t0 = Date.now() - 60_000;
        writeLog(logsDir, "old.log", "old", t0);
        writeLog(logsDir, "newer.log", "newer", t0 + 10_000);
        writeLog(logsDir, "newest.log", "newest", t0 + 20_000);
        writeLog(logsDir, "skip.txt", "ignored", t0 + 30_000);
        const result = listLogFilesByMtimeDesc(logsDir);
        const names = result.map((entry) => path.basename(entry.full));
        assert.deepStrictEqual(names, ["newest.log", "newer.log", "old.log"]);
    });
});

test("listLogFilesByMtimeDesc returns [] when logs dir missing", () => {
    withFixture((root) => {
        assert.deepStrictEqual(listLogFilesByMtimeDesc(path.join(root, "no-such")), []);
    });
});

test("pickLatestLog returns newest entry or null", () => {
    withFixture((root) => {
        const logsDir = path.join(root, "Saved", "Logs");
        fs.mkdirSync(logsDir, { recursive: true });
        assert.strictEqual(pickLatestLog(logsDir), null);
        const t0 = Date.now() - 5000;
        writeLog(logsDir, "a.log", "a", t0);
        writeLog(logsDir, "b.log", "b", t0 + 1000);
        const latest = pickLatestLog(logsDir);
        assert.ok(latest);
        assert.strictEqual(path.basename(latest.full), "b.log");
    });
});

test("readRuntimeStateLastKnown returns last transition from newest log first", () => {
    withFixture((root) => {
        const logsDir = path.join(root, "Saved", "Logs");
        fs.mkdirSync(logsDir, { recursive: true });
        const t0 = Date.now() - 60_000;
        writeLog(
            logsDir,
            "older.log",
            [
                "LogX: warmup",
                "LogUEHper: RuntimeState Uninitialized -> Initializing",
                "LogUEHper: RuntimeState Initializing -> RuntimeReady",
            ].join("\n"),
            t0,
        );
        writeLog(
            logsDir,
            "newest.log",
            [
                "LogX: PIE",
                "LogUEHper: RuntimeState RuntimeReady -> FrameworkLoaded",
                "LogUEHper: RuntimeState FrameworkLoaded -> AppCreated",
                "LogUEHper: RuntimeState AppCreated -> Running",
            ].join("\n"),
            t0 + 30_000,
        );
        const result = readRuntimeStateLastKnown({ projectRoot: root });
        assert.strictEqual(result.available, true);
        assert.strictEqual(result.state, "Running");
        assert.strictEqual(path.basename(result.sourceLog), "newest.log");
        assert.match(result.sourceLine, /AppCreated\s+->\s+Running/);
    });
});

test("readRuntimeStateLastKnown falls back to older log when newest has no transition", () => {
    withFixture((root) => {
        const logsDir = path.join(root, "Saved", "Logs");
        fs.mkdirSync(logsDir, { recursive: true });
        const t0 = Date.now() - 60_000;
        writeLog(logsDir, "older.log",
            "LogUEHper: RuntimeState Uninitialized -> Initializing\n", t0);
        writeLog(logsDir, "newest.log", "LogX: nothing interesting\n", t0 + 5000);
        const result = readRuntimeStateLastKnown({ projectRoot: root });
        assert.strictEqual(result.available, true);
        assert.strictEqual(result.state, "Initializing");
        assert.strictEqual(path.basename(result.sourceLog), "older.log");
    });
});

test("readRuntimeStateLastKnown returns unavailable when no transition exists", () => {
    withFixture((root) => {
        const logsDir = path.join(root, "Saved", "Logs");
        fs.mkdirSync(logsDir, { recursive: true });
        writeLog(logsDir, "a.log", "nothing\n", Date.now());
        const result = readRuntimeStateLastKnown({ projectRoot: root });
        assert.strictEqual(result.available, false);
        assert.strictEqual(result.state, null);
    });
});

test("readRuntimeStateLastKnown returns unavailable when logs dir missing", () => {
    withFixture((root) => {
        const result = readRuntimeStateLastKnown({ projectRoot: root });
        assert.strictEqual(result.available, false);
    });
});

test("analyzeRuntimeBootstrapReadinessLines reports ready bootstrap", () => {
    const result = analyzeRuntimeBootstrapReadinessLines([
        "LogUEHperRuntime: RuntimeState RuntimeReady -> FrameworkLoaded",
        "LogUEHperRuntime: RuntimeState FrameworkLoaded -> AppCreated",
        "Puerts: [uehper] FrameworkApp initialized. entryModule=GameApp",
        "LogUEHperRuntime: RuntimeState AppCreated -> Running",
        "LogUEHperRuntime: UEHper TS bootstrap ready.",
        "LogUEHperRuntime: UEHper runtime module started. FrameworkModule=puerts_uehper/Framework/bootstrap EntryModule=GameApp BootstrapState=ready",
    ]);
    assert.strictEqual(result.status, "ready");
    assert.strictEqual(result.entryModule, "GameApp");
    assert.strictEqual(result.runningReached, true);
    assert.strictEqual(result.bootstrapReady, true);
    assert.strictEqual(result.ignoredBootstrapResult, false);
});

test("analyzeRuntimeBootstrapReadinessLines reports ignored bootstrap callback", () => {
    const result = analyzeRuntimeBootstrapReadinessLines([
        "LogUEHperRuntime: RuntimeState Initializing -> RuntimeReady",
        "LogUEHperRuntime: Warning: NotifyBootstrapResult ignored: unexpected RuntimeState=2",
        "Puerts: [uehper] Framework bootstrap completed",
        "LogUEHperRuntime: RuntimeState RuntimeReady -> FrameworkLoaded",
        "LogUEHperRuntime: RuntimeState FrameworkLoaded -> AppCreated",
    ]);
    assert.strictEqual(result.status, "blocked");
    assert.strictEqual(result.runningReached, false);
    assert.strictEqual(result.bootstrapReady, true);
    assert.strictEqual(result.ignoredBootstrapResult, true);
    assert.match(result.ignoredLine, /NotifyBootstrapResult ignored/);
});

test("readRuntimeBootstrapReadiness uses latest log only", () => {
    withFixture((root) => {
        const logsDir = path.join(root, "Saved", "Logs");
        fs.mkdirSync(logsDir, { recursive: true });
        const t0 = Date.now() - 60_000;
        writeLog(logsDir, "older.log", "LogUEHperRuntime: RuntimeState AppCreated -> Running\nLogUEHperRuntime: UEHper TS bootstrap ready.\n", t0);
        writeLog(logsDir, "newer.log", "LogUEHperRuntime: NotifyBootstrapResult ignored: unexpected RuntimeState=2\n", t0 + 10_000);
        const result = readRuntimeBootstrapReadiness({ projectRoot: root });
        assert.strictEqual(result.status, "blocked");
        assert.strictEqual(path.basename(result.sourceLog), "newer.log");
    });
});

for (const { name, callback } of tests) {
    callback();
    console.log(`[runtimeLog] ok ${name}`);
}

console.log(`[runtimeLog] ${tests.length} tests passed.`);
