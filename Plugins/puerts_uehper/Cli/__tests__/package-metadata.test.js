const assert = require("assert");
const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..", "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

function assertPathExists(relativePath) {
    assert.ok(fs.existsSync(path.join(packageRoot, relativePath)), `package path should exist: ${relativePath}`);
}

assert.strictEqual(packageJson.name, "puerts_uehper");
assert.strictEqual(packageJson.bin["puerts-uehper"], "uehper.js");
assert.strictEqual(packageJson.bin["puerts_uehper"], "uehper.js");
assert.strictEqual(packageJson.main, "./dist/index.js");
assert.strictEqual(packageJson.types, "./dist/index.d.ts");
assert.strictEqual(packageJson.type, "commonjs");
assert.strictEqual(packageJson.scripts["build:package"], "node ./Cli/package-build.js");
assert.strictEqual(packageJson.scripts["pretest:cli"], "npm run build:package");
assert.strictEqual(packageJson.scripts.prepack, "node ./Cli/package-prepack.js");
assert.strictEqual(packageJson.scripts.postpack, "node ./Cli/package-postpack.js");

assertPathExists(packageJson.main);
assertPathExists(packageJson.types);
assertPathExists(packageJson.bin["puerts-uehper"]);
assertPathExists(packageJson.bin["puerts_uehper"]);
assertPathExists("dist/Framework/bootstrap.js");
assertPathExists("dist/Framework/bootstrap.d.ts");

assert.ok(packageJson.exports["."], "root export should be declared");
assert.strictEqual(packageJson.exports["."].types, "./dist/index.d.ts");
assert.strictEqual(packageJson.exports["."].default, "./dist/index.js");
assert.strictEqual(packageJson.exports["./Framework/bootstrap"].types, "./dist/Framework/bootstrap.d.ts");
assert.strictEqual(packageJson.exports["./Framework/bootstrap"].default, "./dist/Framework/bootstrap.js");
assert.strictEqual(packageJson.exports["./Framework/*"].types, "./dist/Framework/*.d.ts");
assert.strictEqual(packageJson.exports["./Framework/*"].default, "./dist/Framework/*.js");
assert.strictEqual(packageJson.exports["./Services/*"].types, "./dist/Services/*.d.ts");
assert.strictEqual(packageJson.exports["./Services/*"].default, "./dist/Services/*.js");
assert.ok(!packageJson.exports["./Cli/*"], "package should not expose wildcard CLI exports");
for (const cliPath of packageJson.files.filter((item) => item.startsWith("Cli/") && item.endsWith(".js"))) {
    const exportName = `./${cliPath.replace(/\.js$/, "")}`;
    assert.strictEqual(packageJson.exports[exportName], `./${cliPath}`, `CLI export should be explicit for ${cliPath}`);
}
assert.ok(!packageJson.exports["./Cli/package-build"], "package should not export source-repo package build tools");
assert.strictEqual(packageJson.exports["./Cli/watch"], "./Cli/watch.js", "watch CLI export should be explicit");

assert.ok(packageJson.files.includes("Cli/main.js"), "package should include CLI implementation files");
assert.ok(packageJson.files.includes("Cli/watch.js"), "package should include the watch CLI implementation");
assert.ok(packageJson.files.includes("dist"), "package should include generated dist output after prepack");
assert.ok(packageJson.files.includes("uehper.js"), "package should include the bin entry script");
assert.ok(packageJson.files.includes("README.md"), "package should include README");
assert.ok(!packageJson.files.includes("Cli/*.js"), "package should list runtime CLI files explicitly");
assert.ok(!packageJson.files.includes("Cli"), "package should not include the whole Cli directory because it contains tests");
assert.ok(!packageJson.files.includes("Cli/package-build.js"), "package should not publish source-repo package build tools");
assert.ok(!packageJson.files.includes("Framework"), "package should not publish framework TS source");
assert.ok(!packageJson.files.includes("Services"), "package should not publish service TS source");
assert.ok(!packageJson.files.includes("IOToolkit"), "package should not publish excluded toolkit source");
assert.ok(!packageJson.files.includes("index.ts"), "package should not publish TS source entry");
assert.ok(!packageJson.files.includes("UEHelpers.ts"), "package should not publish TS helper source");
assert.ok(!packageJson.files.includes("tsconfig.package.json"), "package should not publish package build config");
assert.ok(!packageJson.files.some((item) => item.includes("__tests__")), "package files should not include tests");

console.log("[package-metadata] 1 tests passed.");