const assert = require("assert");
const path = require("path");
const {
    normalizeUnrealPackagePath,
    normalizeUnrealAssetPath,
    normalizeUnrealCookPath,
    getGamePackageFilePath,
    getAssetPackagePath,
} = require("../unrealPaths");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

test("normalizeUnrealPackagePath trims object suffixes", () => {
    assert.strictEqual(normalizeUnrealPackagePath('"/Game/UI/WBP_Menu.WBP_Menu_C"'), "/Game/UI/WBP_Menu");
    assert.strictEqual(normalizeUnrealPackagePath("/Game/Levels/MainLevel"), "/Game/Levels/MainLevel");
    assert.strictEqual(normalizeUnrealPackagePath(""), "");
});

test("normalizeUnrealAssetPath extracts Game and Script references", () => {
    assert.strictEqual(normalizeUnrealAssetPath("WidgetBlueprintGeneratedClass'/Game/UI/WBP_Menu.WBP_Menu_C'"), "/Game/UI/WBP_Menu.WBP_Menu");
    assert.strictEqual(normalizeUnrealAssetPath("/Script/Engine.StaticMesh"), "/Script/Engine.StaticMesh");
    assert.strictEqual(normalizeUnrealAssetPath("NotAnAsset"), "NotAnAsset");
});

test("normalizeUnrealCookPath normalizes slashes and trailing separators", () => {
    assert.strictEqual(normalizeUnrealCookPath("/Game/Maps/"), "/Game/Maps");
    assert.strictEqual(normalizeUnrealCookPath("\\Game\\Maps\\"), "/Game/Maps");
});

test("getGamePackageFilePath maps /Game package paths to Content files", () => {
    const context = { projectRoot: path.resolve("F:/Project") };
    const filePath = getGamePackageFilePath(context, "/Game/UI/WBP_Menu.WBP_Menu_C", ".uasset");
    assert.strictEqual(filePath.replace(/\\/g, "/"), "F:/Project/Content/UI/WBP_Menu.uasset");
    assert.strictEqual(getGamePackageFilePath(context, "/Script/Engine.StaticMesh", ".uasset"), "");
});

test("getAssetPackagePath prefers packagePath and trims object paths", () => {
    assert.strictEqual(getAssetPackagePath({ packagePath: "/Game/Props/SM_Candy/" }), "/Game/Props/SM_Candy");
    assert.strictEqual(getAssetPackagePath({ objectPath: "/Game/UI/WBP_Menu.WBP_Menu_C" }), "/Game/UI/WBP_Menu");
    assert.strictEqual(getAssetPackagePath({ path: "/Game/Levels/MainLevel/" }), "/Game/Levels/MainLevel");
});

for (const { name, callback } of tests) {
    callback();
    console.log(`[unrealPaths] ok ${name}`);
}

console.log(`[unrealPaths] ${tests.length} tests passed.`);
