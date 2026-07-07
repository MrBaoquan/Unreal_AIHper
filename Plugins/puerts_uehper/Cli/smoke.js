const path = require("path");
const fs = require("fs");
const {
    info,
    fail,
    normalizePath,
} = require("./shared");
const { getGameDir } = require("./context");
const { runDoctor } = require("./doctor");

function runSmoke(context) {
    const report = runDoctor(context);
    const gameAppPath = path.join(getGameDir(context), "GameApp.ts");
    const frameworkSource = context.projectLayout?.frameworkSource || "package";
    const frameworkBootstrap = frameworkSource === "source"
        ? path.join(context.frameworkDir, "Framework", "bootstrap.ts")
        : path.join(context.projectFrameworkPackageDir, "dist", "Framework", "bootstrap.js");

    if (!fs.existsSync(gameAppPath)) {
        fail(`Missing GameApp: ${normalizePath(gameAppPath)}. Run init or make app.`);
    }
    if (!fs.existsSync(frameworkBootstrap)) {
        fail(`Missing framework bootstrap: ${normalizePath(frameworkBootstrap)}`);
    }
    if (!Object.values(report.checks).every(Boolean)) {
        fail("doctor checks are not all OK.");
    }

    info("Smoke checks passed.");
}

module.exports = {
    runSmoke,
};
