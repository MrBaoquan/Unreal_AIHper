const assert = require("assert");
const path = require("path");
const { createCliOptions } = require("../args");
const { resolveProjectLayout } = require("../context");
const { createTempDir, removeTempDir, writeFile } = require("./testHelpers");

function makeOptions(args) {
    return createCliOptions(["node", "uehper.js", "doctor", ...args]);
}

{
    const projectRoot = createTempDir("uehper-layout-default-");
    try {
        const layout = resolveProjectLayout(projectRoot, makeOptions([]));
        assert.strictEqual(layout.sourceRoot, "TypeScript");
        assert.strictEqual(layout.appDir, "Game");
        assert.strictEqual(layout.entryModule, "Game/GameApp");
        assert.strictEqual(layout.frameworkSource, "package");
        assert.strictEqual(layout.sourceDir, path.join(projectRoot, "TypeScript"));
    } finally {
        removeTempDir(projectRoot);
    }
}

{
    const projectRoot = createTempDir("uehper-layout-config-");
    try {
        writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
            uehper: {
                sourceRoot: "Scripts",
                appDir: ".",
                entryModule: "GameApp",
                frameworkSource: "source",
            },
        }, null, 2));
        const layout = resolveProjectLayout(projectRoot, makeOptions([]));
        assert.strictEqual(layout.sourceRoot, "Scripts");
        assert.strictEqual(layout.appDir, ".");
        assert.strictEqual(layout.entryModule, "GameApp");
        assert.strictEqual(layout.frameworkSource, "source");
        assert.strictEqual(layout.appDirPath, path.join(projectRoot, "Scripts"));
    } finally {
        removeTempDir(projectRoot);
    }
}

{
    const projectRoot = createTempDir("uehper-layout-override-");
    try {
        writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
            uehper: {
                frameworkSource: "source",
            },
        }, null, 2));
        const layout = resolveProjectLayout(projectRoot, makeOptions(["--framework-source=package"]));
        assert.strictEqual(layout.frameworkSource, "package");
    } finally {
        removeTempDir(projectRoot);
    }
}

console.log("[context-layout] 3 tests passed.");