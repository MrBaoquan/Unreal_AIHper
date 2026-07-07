const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const projectRoot = findProjectRoot(packageRoot);
const tsconfigPath = path.join(packageRoot, "tsconfig.package.json");
const distDir = path.join(packageRoot, "dist");

function findProjectRoot(startDir) {
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

function resolveTypescriptCompiler() {
    const searchPaths = [packageRoot, projectRoot];
    for (const searchPath of searchPaths) {
        try {
            return require.resolve("typescript/bin/tsc", { paths: [searchPath] });
        } catch (_error) {
            // Try the next known dependency root.
        }
    }

    throw new Error("Cannot find TypeScript compiler. Run npm install in the project root first.");
}

function main() {
    fs.rmSync(distDir, { recursive: true, force: true });
    const tscPath = resolveTypescriptCompiler();
    const result = spawnSync(process.execPath, [tscPath, "--project", tsconfigPath], {
        cwd: packageRoot,
        stdio: "inherit",
    });

    if (result.error) {
        throw result.error;
    }

    process.exit(result.status || 0);
}

main();