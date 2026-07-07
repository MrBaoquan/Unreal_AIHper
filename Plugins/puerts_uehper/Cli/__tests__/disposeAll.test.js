"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { findCurrentProjectRoot } = require("./testHelpers");

// Load the compiled ServiceRegistry from Content/JavaScript (produced by `uehper.js build`).
const projectRoot = findCurrentProjectRoot();
const compiledPath = path.join(
    projectRoot,
    "Content",
    "JavaScript",
    "puerts_uehper",
    "Framework",
    "ServiceRegistry.js",
);

const { ServiceRegistry } = require(compiledPath);

function makeService(name, calls, opts = {}) {
    return {
        initialize(ctx) {
            calls.push(`init:${name}`);
            if (opts.initSpy) {
                opts.initSpy(ctx);
            }
        },
        dispose() {
            calls.push(`dispose:${name}`);
            if (opts.throwOnDispose) {
                throw new Error(`boom:${name}`);
            }
        },
    };
}

test("disposeAll runs in reverse topological order", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls), { lifecycle: ["register", "dispose"] });
    registry.register("b", makeService("b", calls), { dependencies: ["a"], lifecycle: ["register", "dispose"] });
    registry.register("c", makeService("c", calls), { dependencies: ["b"], lifecycle: ["register", "dispose"] });

    await registry.disposeAll();
    assert.deepEqual(calls, ["dispose:c", "dispose:b", "dispose:a"]);
});

test("disposeAll skips services without dispose lifecycle", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls), { lifecycle: ["register"] });
    registry.register("b", makeService("b", calls), { dependencies: ["a"], lifecycle: ["register", "dispose"] });

    await registry.disposeAll();
    assert.deepEqual(calls, ["dispose:b"]);
});

test("disposeAll swallows dispose errors and continues releasing remaining services", async () => {
    const calls = [];
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
        const registry = new ServiceRegistry(undefined, "world");
        registry.register("a", makeService("a", calls), { lifecycle: ["register", "dispose"] });
        registry.register("b", makeService("b", calls, { throwOnDispose: true }), {
            dependencies: ["a"],
            lifecycle: ["register", "dispose"],
        });
        registry.register("c", makeService("c", calls), { dependencies: ["b"], lifecycle: ["register", "dispose"] });

        await registry.disposeAll();
    } finally {
        console.warn = originalWarn;
    }

    assert.deepEqual(calls, ["dispose:c", "dispose:b", "dispose:a"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Service dispose failed: b/);
    assert.match(warnings[0], /boom:b/);
});

test("disposeAll honors cross-scope dependencies provided by parent", async () => {
    const calls = [];
    const root = new ServiceRegistry(undefined, "root");
    root.register("events", makeService("events", calls), { lifecycle: ["register"] });

    const world = root.createChild("world");
    world.register("ui", makeService("ui", calls), {
        dependencies: ["events"],
        lifecycle: ["register", "dispose"],
    });
    world.register("scenes", makeService("scenes", calls), {
        dependencies: ["events"],
        lifecycle: ["register", "dispose"],
    });

    await world.disposeAll();
    // No cycles, no missing-dep error; both world services release.
    assert.ok(calls.includes("dispose:ui"));
    assert.ok(calls.includes("dispose:scenes"));
    assert.ok(!calls.includes("dispose:events"), "parent service should not be touched by child disposeAll");
});

test("disposeAll is a no-op when no service declares dispose lifecycle", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "root");
    registry.register("a", makeService("a", calls), { lifecycle: ["register"] });
    registry.register("b", makeService("b", calls), { lifecycle: ["register"] });

    await registry.disposeAll();
    assert.deepEqual(calls, []);
});

test("disposeAll tolerates services without a dispose() method even when lifecycle declares dispose", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", { initialize() {} }, { lifecycle: ["register", "dispose"] });
    registry.register("b", makeService("b", calls), { dependencies: ["a"], lifecycle: ["register", "dispose"] });

    await registry.disposeAll();
    assert.deepEqual(calls, ["dispose:b"]);
});
