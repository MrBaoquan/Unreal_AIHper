const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const backupPath = path.join(packageRoot, ".package-json-source.tmp");

if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, packageJsonPath);
    fs.rmSync(backupPath, { force: true });
}

execFileSync(process.execPath, [path.join(__dirname, "package-build.js")], {
    cwd: packageRoot,
    stdio: "inherit",
});

const sourceText = fs.readFileSync(packageJsonPath, "utf-8");
fs.writeFileSync(backupPath, sourceText);

const packageJson = JSON.parse(sourceText);
delete packageJson.scripts;

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`);