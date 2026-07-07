const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveRuntimePackageSource } = require("../bootstrap");

function makeOptions(runtimeSource) {
    return {
        getOptionValue(name) {
            return name === "--runtime-source" ? runtimeSource : undefined;
        },
        isDryRun() {
            return false;
        },
    };
}

function makeEntrypoints(root) {
    fs.mkdirSync(path.join(root, "Framework"), { recursive: true });
    fs.writeFileSync(path.join(root, "index.js"), "");
    fs.writeFileSync(path.join(root, "Framework", "bootstrap.js"), "");
}

function makeContext() {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uehper-runtime-source-"));
    return {
        fixtureRoot,
        context: {
            projectRoot: fixtureRoot,
            projectLayout: {},
            contentJavascriptDir: path.join(fixtureRoot, "Content", "JavaScript"),
            frameworkPackageRoot: path.join(fixtureRoot, "Package"),
            projectFrameworkPackageDir: path.join(fixtureRoot, "node_modules", "puerts_uehper"),
        },
    };
}

function removeTempDir(target) {
    fs.rmSync(target, { recursive: true, force: true });
}

{
    const { fixtureRoot, context } = makeContext();
    try {
        const compiledDir = path.join(context.contentJavascriptDir, "puerts_uehper");
        const distDir = path.join(context.frameworkPackageRoot, "dist");
        makeEntrypoints(compiledDir);
        makeEntrypoints(distDir);
        const source = resolveRuntimePackageSource(context, makeOptions(undefined));
        assert.strictEqual(source.name, "compiled");
        assert.strictEqual(source.dir, compiledDir);
    } finally {
        removeTempDir(fixtureRoot);
    }
}

{
    const { fixtureRoot, context } = makeContext();
    try {
        const distDir = path.join(context.frameworkPackageRoot, "dist");
        makeEntrypoints(distDir);
        const source = resolveRuntimePackageSource(context, makeOptions("dist"));
        assert.strictEqual(source.name, "dist");
        assert.strictEqual(source.dir, distDir);
    } finally {
        removeTempDir(fixtureRoot);
    }
}

{
    const { fixtureRoot, context } = makeContext();
    try {
        const packageDir = path.join(context.projectFrameworkPackageDir, "dist");
        makeEntrypoints(packageDir);
        const source = resolveRuntimePackageSource(context, makeOptions("package"));
        assert.strictEqual(source.name, "package");
        assert.strictEqual(source.dir, packageDir);
    } finally {
        removeTempDir(fixtureRoot);
    }
}

{
    const { fixtureRoot, context } = makeContext();
    try {
        context.projectLayout.frameworkSource = "package";
        const compiledDir = path.join(context.contentJavascriptDir, "puerts_uehper");
        const packageDir = path.join(context.projectFrameworkPackageDir, "dist");
        makeEntrypoints(compiledDir);
        makeEntrypoints(packageDir);
        const source = resolveRuntimePackageSource(context, makeOptions(undefined));
        assert.strictEqual(source.name, "package");
        assert.strictEqual(source.dir, packageDir);
    } finally {
        removeTempDir(fixtureRoot);
    }
}

{
    const { fixtureRoot, context } = makeContext();
    try {
        assert.throws(
            () => resolveRuntimePackageSource(context, makeOptions("missing")),
            /Unsupported --runtime-source=missing/
        );
    } finally {
        removeTempDir(fixtureRoot);
    }
}

console.log("[runtime-source] 5 tests passed.");