const fs = require("fs");
const os = require("os");
const path = require("path");

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeTempDir(targetDir) {
    fs.rmSync(targetDir, { recursive: true, force: true });
}

function writeFile(targetPath, content) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
}

function findFixtureProjectRoot(startDir) {
    let currentDir = path.resolve(startDir);
    while (true) {
        if (fs.existsSync(currentDir) && fs.readdirSync(currentDir).some((entry) => entry.endsWith(".uproject"))) {
            return currentDir;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error(`Unable to locate Unreal project root from ${startDir}`);
        }
        currentDir = parentDir;
    }
}

function findCurrentProjectRoot() {
    return findFixtureProjectRoot(__dirname);
}

function createDoctorFailureProject() {
    const fixtureRoot = createTempDir("uehper-cli-doctor-failure-");
    const scriptRoot = path.join(fixtureRoot, "TypeScript", "puerts_uehper");
    fs.mkdirSync(scriptRoot, { recursive: true });
    writeFile(path.join(fixtureRoot, "Fixture.uproject"), JSON.stringify({ EngineAssociation: "5.5" }, null, 2));
    writeFile(path.join(fixtureRoot, "Plugins", "Puerts", "Puerts.uplugin"), JSON.stringify({ FileVersion: 3 }, null, 2));
    writeFile(path.join(fixtureRoot, "Plugins", "Puerts", "Source", "JsEnv", "JsEnv.Build.cs"), [
        "public class JsEnv {",
        "    private bool UseNodejs = false;",
        "    private bool UseQuickjs = false;",
        "    private SupportedV8Versions UseV8Version = SupportedV8Versions.V9_4_146_24;",
        "}",
        "",
    ].join("\n"));
    return { fixtureRoot, scriptRoot };
}

function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

async function waitForFile(targetPath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fs.existsSync(targetPath)) {
            return fs.readFileSync(targetPath, "utf-8").trim();
        }
        await delay(10);
    }
    throw new Error(`Timed out waiting for ${targetPath}`);
}

async function waitForProcessExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessRunning(pid)) {
            return;
        }
        await delay(25);
    }
    throw new Error(`Process ${pid} was still running after ${timeoutMs}ms.`);
}

function createProcessTreeScript(pidFile) {
    return [
        "const fs = require('fs');",
        "const { spawn } = require('child_process');",
        `const pidFile = ${JSON.stringify(pidFile)};`,
        "const nested = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });",
        "fs.writeFileSync(pidFile, String(nested.pid));",
        "setTimeout(() => {}, 10000);",
    ].join("\n");
}

module.exports = {
    createDoctorFailureProject,
    createProcessTreeScript,
    createTempDir,
    findCurrentProjectRoot,
    findFixtureProjectRoot,
    removeTempDir,
    waitForFile,
    waitForProcessExit,
    writeFile,
};
