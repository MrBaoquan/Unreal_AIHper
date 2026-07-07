const path = require("path");
const fs = require("fs");
const { createCliOptions } = require("./args");

function resolveCliOptions(options = {}) {
    if (typeof options.isDryRun === "function" && typeof options.isForce === "function") {
        return options;
    }
    if (options.cliOptions) {
        return options.cliOptions;
    }
    return createCliOptions();
}

function isForced(options = {}) {
    return options.force === true || resolveCliOptions(options).isForce();
}

function isDryRun(options = {}) {
    return resolveCliOptions(options).isDryRun();
}

function info(message) {
    console.log(`[uehper] ${message}`);
}

function warn(message) {
    console.warn(`[uehper] ${message}`);
}

function logFailure(message) {
    console.error(`[uehper] ${message}`);
}

function fail(message) {
    throw new Error(message);
}

function normalizePath(targetPath) {
    return targetPath.replace(/\\/g, "/");
}

function findProjectRoot(startDir) {
    let currentDir = startDir;

    while (true) {
        const entries = fs.existsSync(currentDir) ? fs.readdirSync(currentDir) : [];
        if (entries.some((entry) => entry.endsWith(".uproject"))) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            fail(`Unable to locate Unreal project root from ${startDir}`);
        }

        currentDir = parentDir;
    }
}

function findPuertsPath(projectRootDir) {
    const pluginsDir = path.join(projectRootDir, "Plugins");
    const candidates = [
        path.join(pluginsDir, "Puerts"),
        path.join(pluginsDir, "Unreal.AIHper", "Puerts"),
        path.join(pluginsDir, "Unreal.AIHper", "puerts", "unreal", "Puerts"),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, "Puerts.uplugin"))) {
            return candidate;
        }
    }

    const searchQueue = [pluginsDir];
    while (searchQueue.length > 0) {
        const currentDir = searchQueue.shift();
        if (!fs.existsSync(currentDir)) {
            continue;
        }

        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const entryPath = path.join(currentDir, entry.name);
            if (!entry.isDirectory()) {
                continue;
            }

            if (fs.existsSync(path.join(entryPath, "Puerts.uplugin"))) {
                return entryPath;
            }

            searchQueue.push(entryPath);
        }
    }

    fail(`Unable to locate Puerts plugin under ${pluginsDir}`);
}

function ensureDir(targetDir) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
}

function writeTextFile(targetPath, content, options = {}) {
    const shouldOverwrite = isForced(options);
    if (fs.existsSync(targetPath) && !shouldOverwrite) {
        info(`Exists: ${normalizePath(targetPath)}`);
        return false;
    }

    if (isDryRun(options)) {
        info(`[dry-run] Write: ${normalizePath(targetPath)}`);
        return true;
    }

    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, content);
    info(`Wrote: ${normalizePath(targetPath)}`);
    return true;
}

function writeTextFileIfMissing(targetPath, content, options = {}) {
    if (fs.existsSync(targetPath)) {
        return false;
    }

    if (isDryRun(options)) {
        info(`[dry-run] Write: ${normalizePath(targetPath)}`);
        return true;
    }

    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, content);
    return true;
}

function appendTextIfMissing(targetPath, marker, content, options = {}) {
    const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : "";
    if (existing.includes(marker)) {
        info(`Already configured: ${normalizePath(targetPath)}`);
        return false;
    }

    if (isDryRun(options)) {
        info(`[dry-run] Append: ${normalizePath(targetPath)}`);
        return true;
    }

    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${content}`);
    info(`Updated: ${normalizePath(targetPath)}`);
    return true;
}

function copyFileSync(source, target) {
    let targetFile = target;
    if (fs.existsSync(target) && fs.lstatSync(target).isDirectory()) {
        targetFile = path.join(target, path.basename(source));
    }

    ensureDir(path.dirname(targetFile));
    fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFileIfMissing(source, target, options = {}) {
    if (!fs.existsSync(target)) {
        if (!fs.existsSync(source)) {
            fail(`Missing source file: ${source}`);
        }

        if (isDryRun(options)) {
            info(`[dry-run] Copy: ${normalizePath(source)} -> ${normalizePath(target)}`);
            return true;
        }

        copyFileSync(source, target);
        return true;
    }

    return false;
}

function syncFile(source, target) {
    if (!fs.existsSync(target) || fs.readFileSync(source).compare(fs.readFileSync(target)) !== 0) {
        copyFileSync(source, target);
        return true;
    }

    return false;
}

function copyFolderRecursiveSync(source, targetFolder, options = {}) {
    if (!fs.existsSync(source)) {
        fail(`Missing source directory: ${source}`);
    }

    if (isDryRun(options)) {
        info(`[dry-run] Copy folder: ${normalizePath(source)} -> ${normalizePath(targetFolder)}`);
        return true;
    }

    ensureDir(targetFolder);

    for (const file of fs.readdirSync(source)) {
        const curSource = path.join(source, file);
        const curTarget = path.join(targetFolder, file);
        if (fs.lstatSync(curSource).isDirectory()) {
            copyFolderRecursiveSync(curSource, curTarget, options);
        } else {
            fs.writeFileSync(curTarget, fs.readFileSync(curSource));
        }
    }
    return true;
}

function shouldSkipCopy(relativePath) {
    const normalized = normalizePath(relativePath);
    return normalized === ".git" || normalized.startsWith(".git/") || normalized === "node_modules" || normalized.startsWith("node_modules/");
}

function materializeFrameworkDirectory(sourceDir, targetDir, options = {}) {
    if (!fs.existsSync(sourceDir)) {
        fail(`Missing source directory: ${sourceDir}`);
    }

    if (isDryRun(options)) {
        info(`[dry-run] Materialize: ${normalizePath(sourceDir)} -> ${normalizePath(targetDir)}`);
        return true;
    }

    ensureDir(targetDir);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        const relativePath = path.relative(sourceDir, sourcePath);

        if (shouldSkipCopy(relativePath)) {
            continue;
        }

        if (entry.isDirectory()) {
            materializeFrameworkDirectory(sourcePath, targetPath, options);
        } else {
            syncFile(sourcePath, targetPath);
        }
    }
    return true;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, value, options = {}) {
    if (isDryRun(options)) {
        info(`[dry-run] Write: ${normalizePath(filePath)}`);
        return;
    }

    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 4)}\n`);
}

function quoteArg(value) {
    return `"${String(value).replace(/"/g, '\\"')}"`;
}

module.exports = {
    info,
    warn,
    logFailure,
    fail,
    normalizePath,
    findProjectRoot,
    findPuertsPath,
    ensureDir,
    writeTextFile,
    writeTextFileIfMissing,
    appendTextIfMissing,
    copyFileSync,
    copyFileIfMissing,
    syncFile,
    copyFolderRecursiveSync,
    materializeFrameworkDirectory,
    readJson,
    writeJson,
    quoteArg,
};
