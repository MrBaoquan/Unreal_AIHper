const path = require("path");

function normalizeUnrealPackagePath(value) {
    const normalized = String(value || "").trim().replace(/^"|"$/g, "");
    if (!normalized) {
        return "";
    }
    const dotIndex = normalized.indexOf(".");
    return dotIndex >= 0 ? normalized.slice(0, dotIndex) : normalized;
}

function normalizeUnrealAssetPath(assetPath) {
    const match = String(assetPath || "").match(/((?:\/Game|\/Script)\/[^'"\s]+)/);
    if (!match) {
        return String(assetPath || "");
    }
    return match[1].endsWith("_C") ? match[1].slice(0, -2) : match[1];
}

function normalizeUnrealCookPath(value) {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized || value;
}

function getGamePackageFilePath(context, packagePath, extension) {
    const normalized = normalizeUnrealPackagePath(packagePath);
    if (!normalized.startsWith("/Game/")) {
        return "";
    }
    return path.join(context.projectRoot, "Content", ...normalized.slice("/Game/".length).split("/")) + extension;
}

function getAssetPackagePath(item) {
    if (item.packagePath) {
        return normalizeUnrealCookPath(item.packagePath);
    }
    if (item.objectPath && item.objectPath.includes(".")) {
        return normalizeUnrealCookPath(item.objectPath.slice(0, item.objectPath.indexOf(".")));
    }
    return normalizeUnrealCookPath(item.objectPath || item.path || "");
}

module.exports = {
    normalizeUnrealPackagePath,
    normalizeUnrealAssetPath,
    normalizeUnrealCookPath,
    getGamePackageFilePath,
    getAssetPackagePath,
};