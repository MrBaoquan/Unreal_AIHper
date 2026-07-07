const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const backupPath = path.join(packageRoot, ".package-json-source.tmp");

if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, packageJsonPath);
    fs.rmSync(backupPath, { force: true });
}