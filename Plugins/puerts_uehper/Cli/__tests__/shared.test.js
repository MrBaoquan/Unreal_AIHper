const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCliOptions } = require("../args");
const {
    copyFileIfMissing,
    copyFolderRecursiveSync,
    materializeFrameworkDirectory,
} = require("../shared");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function withFixture(callback) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uehper-shared-"));
    try {
        callback(fixtureRoot);
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function createSourceTree(fixtureRoot) {
    const sourceDir = path.join(fixtureRoot, "source");
    fs.mkdirSync(path.join(sourceDir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "root.txt"), "root");
    fs.writeFileSync(path.join(sourceDir, "nested", "child.txt"), "child");
    return sourceDir;
}

function assertFileContent(targetPath, expected) {
    assert.strictEqual(fs.readFileSync(targetPath, "utf-8"), expected);
}

test("copyFolderRecursiveSync honors explicit dry-run options", () => {
    withFixture((fixtureRoot) => {
        const sourceDir = createSourceTree(fixtureRoot);
        const targetDir = path.join(fixtureRoot, "target");
        const options = createCliOptions(["node", "uehper.js", "bootstrap", "--dry-run"]);

        copyFolderRecursiveSync(sourceDir, targetDir, { cliOptions: options });

        assert.ok(!fs.existsSync(targetDir), "dry-run copy should not create target directory");
    });
});

test("copyFileIfMissing copies new files and preserves existing files", () => {
    withFixture((fixtureRoot) => {
        const sourcePath = path.join(fixtureRoot, "source.txt");
        const targetPath = path.join(fixtureRoot, "target", "copied.txt");
        fs.writeFileSync(sourcePath, "first");

        assert.strictEqual(copyFileIfMissing(sourcePath, targetPath), true);
        assertFileContent(targetPath, "first");

        fs.writeFileSync(sourcePath, "second");
        assert.strictEqual(copyFileIfMissing(sourcePath, targetPath), false);
        assertFileContent(targetPath, "first");
    });
});

test("copyFileIfMissing reports missing source files", () => {
    withFixture((fixtureRoot) => {
        assert.throws(
            () => copyFileIfMissing(path.join(fixtureRoot, "missing.txt"), path.join(fixtureRoot, "target.txt")),
            /Missing source file:/
        );
    });
});

test("copyFolderRecursiveSync copies nested file content", () => {
    withFixture((fixtureRoot) => {
        const sourceDir = createSourceTree(fixtureRoot);
        const targetDir = path.join(fixtureRoot, "target");

        assert.strictEqual(copyFolderRecursiveSync(sourceDir, targetDir), true);

        assertFileContent(path.join(targetDir, "root.txt"), "root");
        assertFileContent(path.join(targetDir, "nested", "child.txt"), "child");
    });
});

test("copyFolderRecursiveSync reports missing source directories", () => {
    withFixture((fixtureRoot) => {
        assert.throws(
            () => copyFolderRecursiveSync(path.join(fixtureRoot, "missing"), path.join(fixtureRoot, "target")),
            /Missing source directory:/
        );
    });
});

test("materializeFrameworkDirectory honors explicit dry-run options", () => {
    withFixture((fixtureRoot) => {
        const sourceDir = createSourceTree(fixtureRoot);
        const targetDir = path.join(fixtureRoot, "materialized");
        const options = createCliOptions(["node", "uehper.js", "bootstrap", "--dry-run"]);

        materializeFrameworkDirectory(sourceDir, targetDir, { cliOptions: options });

        assert.ok(!fs.existsSync(targetDir), "dry-run materialize should not create target directory");
    });
});

test("materializeFrameworkDirectory syncs content and skips generated folders", () => {
    withFixture((fixtureRoot) => {
        const sourceDir = createSourceTree(fixtureRoot);
        const targetDir = path.join(fixtureRoot, "materialized");
        fs.mkdirSync(path.join(sourceDir, ".git"), { recursive: true });
        fs.mkdirSync(path.join(sourceDir, "node_modules", "pkg"), { recursive: true });
        fs.writeFileSync(path.join(sourceDir, ".git", "config"), "ignored");
        fs.writeFileSync(path.join(sourceDir, "node_modules", "pkg", "index.js"), "ignored");
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, "root.txt"), "old");

        assert.strictEqual(materializeFrameworkDirectory(sourceDir, targetDir), true);

        assertFileContent(path.join(targetDir, "root.txt"), "root");
        assertFileContent(path.join(targetDir, "nested", "child.txt"), "child");
        assert.ok(!fs.existsSync(path.join(targetDir, ".git")), "materialize should skip .git");
        assert.ok(!fs.existsSync(path.join(targetDir, "node_modules")), "materialize should skip node_modules");
    });
});

test("materializeFrameworkDirectory reports missing source directories", () => {
    withFixture((fixtureRoot) => {
        assert.throws(
            () => materializeFrameworkDirectory(path.join(fixtureRoot, "missing"), path.join(fixtureRoot, "materialized")),
            /Missing source directory:/
        );
    });
});

for (const { name, callback } of tests) {
    callback();
    console.log(`[shared] ok ${name}`);
}

console.log(`[shared] ${tests.length} tests passed.`);