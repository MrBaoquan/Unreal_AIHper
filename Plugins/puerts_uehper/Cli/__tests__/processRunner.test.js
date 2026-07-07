const assert = require("assert");
const path = require("path");
const {
    runChildProcess,
    runPollingProcess,
} = require("../processRunner");
const {
    createProcessTreeScript,
    createTempDir,
    removeTempDir,
    waitForFile,
    waitForProcessExit,
} = require("./testHelpers");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

test("runPollingProcess returns poll value when done", async () => {
    const value = await runPollingProcess(
        process.execPath,
        ["-e", "setTimeout(() => {}, 5000)"],
        process.cwd(),
        2000,
        async (state) => {
            assert.ok(state.pid, "poll state should expose child pid");
            state.kill();
            return { done: true, value: "ready" };
        },
        { pollIntervalMs: 10 }
    );

    assert.strictEqual(value, "ready");
});

test("runChildProcess resolves zero exit code", async () => {
    const exitCode = await runChildProcess(
        process.execPath,
        ["-e", "process.exit(0)"],
        process.cwd(),
        2000
    );

    assert.strictEqual(exitCode, 0);
});

test("runChildProcess resolves nonzero exit code", async () => {
    const exitCode = await runChildProcess(
        process.execPath,
        ["-e", "process.exit(7)"],
        process.cwd(),
        2000
    );

    assert.strictEqual(exitCode, 7);
});

test("runChildProcess times out and kills child", async () => {
    const startedAt = Date.now();
    await assert.rejects(
        () => runChildProcess(
            process.execPath,
            ["-e", "setTimeout(() => {}, 5000)"],
            process.cwd(),
            50
        ),
        /Timed out after 50ms\./
    );
    assert.ok(Date.now() - startedAt < 2000, "timeout test should not wait for the child process duration");
});

test("runChildProcess timeout kills spawned child process tree on Windows", async () => {
    if (process.platform !== "win32") {
        console.log("[processRunner] skip runChildProcess process tree cleanup on non-Windows platform");
        return;
    }

    const fixtureRoot = createTempDir("uehper-process-tree-");
    const pidFile = path.join(fixtureRoot, "nested.pid");
    try {
        await assert.rejects(
            () => runChildProcess(
                process.execPath,
                ["-e", createProcessTreeScript(pidFile)],
                process.cwd(),
                250
            ),
            /Timed out after 250ms\./
        );
        const nestedPid = Number(await waitForFile(pidFile, 1000));
        assert.ok(Number.isInteger(nestedPid) && nestedPid > 0, `nested pid should be valid: ${nestedPid}`);
        await waitForProcessExit(nestedPid, 2000);
    } finally {
        removeTempDir(fixtureRoot);
    }
});

test("runChildProcess rejects spawn errors", async () => {
    const missingExecutable = path.join(process.cwd(), "__missing_uehper_executable__.exe");
    await assert.rejects(
        () => runChildProcess(
            missingExecutable,
            [],
            process.cwd(),
            2000
        ),
        /ENOENT|spawn/
    );
});

test("runPollingProcess propagates poll errors", async () => {
    await assert.rejects(
        () => runPollingProcess(
            process.execPath,
            ["-e", "setTimeout(() => {}, 5000)"],
            process.cwd(),
            2000,
            async (state) => {
                state.kill();
                throw new Error("poll failed");
            },
            { pollIntervalMs: 10 }
        ),
        /poll failed/
    );
});

test("runPollingProcess rejects spawn errors", async () => {
    const missingExecutable = path.join(process.cwd(), "__missing_uehper_polling_executable__.exe");
    const startedAt = Date.now();
    await assert.rejects(
        () => runPollingProcess(
            missingExecutable,
            [],
            process.cwd(),
            2000,
            async () => undefined,
            { pollIntervalMs: 10 }
        ),
        /ENOENT|spawn/
    );
    assert.ok(Date.now() - startedAt < 1000, "spawn error should reject before the polling timeout");
});

test("runPollingProcess times out and kills child", async () => {
    const startedAt = Date.now();
    await assert.rejects(
        () => runPollingProcess(
            process.execPath,
            ["-e", "setTimeout(() => {}, 5000)"],
            process.cwd(),
            50,
            async () => undefined,
            { pollIntervalMs: 10, timeoutMessage: "poll timed out" }
        ),
        /poll timed out/
    );
    assert.ok(Date.now() - startedAt < 2000, "timeout test should not wait for the child process duration");
});

test("runPollingProcess timeout kills spawned child process tree on Windows", async () => {
    if (process.platform !== "win32") {
        console.log("[processRunner] skip runPollingProcess process tree cleanup on non-Windows platform");
        return;
    }

    const fixtureRoot = createTempDir("uehper-polling-tree-");
    const pidFile = path.join(fixtureRoot, "nested.pid");
    try {
        await assert.rejects(
            () => runPollingProcess(
                process.execPath,
                ["-e", createProcessTreeScript(pidFile)],
                process.cwd(),
                250,
                async () => undefined,
                { pollIntervalMs: 10, timeoutMessage: "polling tree timed out" }
            ),
            /polling tree timed out/
        );
        const nestedPid = Number(await waitForFile(pidFile, 1000));
        assert.ok(Number.isInteger(nestedPid) && nestedPid > 0, `nested pid should be valid: ${nestedPid}`);
        await waitForProcessExit(nestedPid, 2000);
    } finally {
        removeTempDir(fixtureRoot);
    }
});

(async () => {
    for (const { name, callback } of tests) {
        await callback();
        console.log(`[processRunner] ok ${name}`);
    }

    console.log(`[processRunner] ${tests.length} tests passed.`);
})().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});
