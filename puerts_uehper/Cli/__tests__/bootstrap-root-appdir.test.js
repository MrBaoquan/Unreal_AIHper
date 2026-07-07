const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { rewriteTsConfig, materializePackageBinShims } = require("../bootstrap");
const { createCliOptions } = require("../args");
const { createTempDir, removeTempDir, writeFile } = require("./testHelpers");

const projectRoot = createTempDir("uehper-bootstrap-root-appdir-");

try {
    const tsconfigPath = path.join(projectRoot, "tsconfig.json");
    writeFile(tsconfigPath, JSON.stringify({
        compilerOptions: {
            paths: {
                "Game/*": ["Game/*"],
            },
        },
    }, null, 4));

    rewriteTsConfig(tsconfigPath, {
        projectRoot,
        projectTypescriptDir: path.join(projectRoot, "TypeScript"),
        projectFrameworkPackageDir: path.join(projectRoot, "node_modules", "puerts_uehper"),
        projectLayout: {
            sourceRoot: "TypeScript",
            appDir: ".",
            frameworkSource: "package",
        },
    }, createCliOptions(["node", "uehper.js", "bootstrap"]));

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
    assert.strictEqual(tsconfig.compilerOptions.baseUrl, "TypeScript");
    assert.deepStrictEqual(tsconfig.compilerOptions.paths["puerts_uehper"], ["../node_modules/puerts_uehper/dist/index"]);
    assert.deepStrictEqual(tsconfig.compilerOptions.paths["puerts_uehper/*"], ["../node_modules/puerts_uehper/dist/*"]);
    assert.ok(!Object.prototype.hasOwnProperty.call(tsconfig.compilerOptions.paths, "Game/*"), "root appDir must remove stale Game alias");
    assert.ok(tsconfig.include.includes("TypeScript/**/*"));
    assert.ok(tsconfig.exclude.includes("TypeScript/puerts_uehper/**/*"));

    materializePackageBinShims({ projectRoot }, createCliOptions(["node", "uehper.js", "bootstrap"]));
    assert.ok(fs.existsSync(path.join(projectRoot, "node_modules", ".bin", "puerts-uehper.cmd")), "local puerts-uehper.cmd bin shim should exist");
    assert.ok(fs.existsSync(path.join(projectRoot, "node_modules", ".bin", "puerts_uehper.cmd")), "local puerts_uehper.cmd bin shim should exist");
} finally {
    removeTempDir(projectRoot);
}

console.log("[bootstrap-root-appdir] 2 tests passed.");