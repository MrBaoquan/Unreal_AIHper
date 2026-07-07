const assert = require("assert");
const {
    getArg,
    getCommand,
    getTarget,
    getPositionalArg,
    hasOption,
    getOptionValue,
    isForce,
    isDryRun,
    createCliOptions,
} = require("../args");

const tests = [];
const originalArgv = process.argv;

function test(name, callback) {
    tests.push({ name, callback });
}

function withArgv(argv, callback) {
    process.argv = argv;
    try {
        callback();
    } finally {
        process.argv = originalArgv;
    }
}

test("reads command and target", () => {
    withArgv(["node", "uehper.js", "make", "module", "Score"], () => {
        assert.strictEqual(getCommand(), "make");
        assert.strictEqual(getTarget(), "module");
        assert.strictEqual(getArg(4), "Score");
    });
});

test("defaults command and filters positional option values", () => {
    withArgv(["node", "uehper.js", undefined, "scene", "Main", "--dry-run"], () => {
        assert.strictEqual(getCommand(), "install");
        assert.strictEqual(getPositionalArg(4), "Main");
        assert.strictEqual(getPositionalArg(5), undefined);
    });
});

test("reads flags and key-value options", () => {
    withArgv(["node", "uehper.js", "doctor", "--dry-run", "--force", "--cook-map=/Game/Maps/Test"], () => {
        assert.strictEqual(hasOption("--dry-run"), true);
        assert.strictEqual(isDryRun(), true);
        assert.strictEqual(isForce(), true);
        assert.strictEqual(getOptionValue("--cook-map"), "/Game/Maps/Test");
        assert.strictEqual(getOptionValue("--missing"), undefined);
    });
});

test("creates a stable options snapshot", () => {
    const options = createCliOptions(["node", "uehper.js", "manifest", "widget", "Hud", "HudClass", "--layer=Overlay", "--dry-run"]);

    withArgv(["node", "uehper.js", "doctor"], () => {
        assert.strictEqual(options.command, "manifest");
        assert.strictEqual(options.target, "widget");
        assert.strictEqual(options.getArg(4), "Hud");
        assert.strictEqual(options.getPositionalArg(5), "HudClass");
        assert.strictEqual(options.getOptionValue("--layer"), "Overlay");
        assert.strictEqual(options.hasOption("--dry-run"), true);
        assert.strictEqual(options.isDryRun(), true);
    });
});

for (const { name, callback } of tests) {
    callback();
    console.log(`[args] ok ${name}`);
}

console.log(`[args] ${tests.length} tests passed.`);
