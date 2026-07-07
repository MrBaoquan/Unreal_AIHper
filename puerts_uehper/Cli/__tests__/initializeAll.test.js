"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { findCurrentProjectRoot } = require("./testHelpers");

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
        async initialize(ctx) {
            calls.push(`init:${name}`);
            if (opts.captureCtx) {
                opts.captureCtx.push({ name, ctx });
            }
            if (opts.throwOnInit) {
                throw new Error(`boom-init:${name}`);
            }
        },
        dispose() {
            calls.push(`dispose:${name}`);
        },
    };
}

test("initializeAll runs services in topological order", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls), { lifecycle: ["register", "initialize"] });
    registry.register("b", makeService("b", calls), { dependencies: ["a"], lifecycle: ["register", "initialize"] });
    registry.register("c", makeService("c", calls), { dependencies: ["b"], lifecycle: ["register", "initialize"] });

    await registry.initializeAll({ tag: "ctx" });
    assert.deepEqual(calls, ["init:a", "init:b", "init:c"]);
});

test("initializeAll skips services without initialize lifecycle", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls), { lifecycle: ["register"] });
    registry.register("b", makeService("b", calls), { dependencies: ["a"], lifecycle: ["register", "initialize"] });

    await registry.initializeAll({});
    assert.deepEqual(calls, ["init:b"]);
});

test("initializeAll passes the provided context object to each initializer", async () => {
    const calls = [];
    const captureCtx = [];
    const ctx = { token: "frameworkContext" };
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls, { captureCtx }), { lifecycle: ["register", "initialize"] });
    registry.register("b", makeService("b", calls, { captureCtx }), { dependencies: ["a"], lifecycle: ["register", "initialize"] });

    await registry.initializeAll(ctx);
    assert.equal(captureCtx.length, 2);
    assert.equal(captureCtx[0].ctx, ctx);
    assert.equal(captureCtx[1].ctx, ctx);
});

test("initializeAll honors cross-scope dependencies from parent", async () => {
    const calls = [];
    const root = new ServiceRegistry(undefined, "root");
    root.register("events", makeService("events", calls), { lifecycle: ["register"] });

    const world = root.createChild("world");
    world.register("ui", makeService("ui", calls), {
        dependencies: ["events"],
        lifecycle: ["register", "initialize"],
    });

    await world.initializeAll({});
    assert.deepEqual(calls, ["init:ui"], "parent service should not be re-initialized; missing-dep check uses parent.has");
});

test("initializeAll tolerates services without an initialize() method even if lifecycle declares initialize", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", { /* no initialize method */ }, { lifecycle: ["register", "initialize"] });
    registry.register("b", makeService("b", calls), { dependencies: ["a"], lifecycle: ["register", "initialize"] });

    await registry.initializeAll({});
    assert.deepEqual(calls, ["init:b"]);
});

test("initializeAll throws on dependency cycles", async () => {
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", []), { dependencies: ["b"], lifecycle: ["register", "initialize"] });
    registry.register("b", makeService("b", []), { dependencies: ["a"], lifecycle: ["register", "initialize"] });

    await assert.rejects(() => registry.initializeAll({}), /Service dependency cycle/);
});

test("initializeAll throws on missing local dependency that is not satisfied by parent", async () => {
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", []), { dependencies: ["ghost"], lifecycle: ["register", "initialize"] });

    await assert.rejects(() => registry.initializeAll({}), /Missing dependency 'ghost'/);
});

test("initializeAll propagates initializer errors (no swallowing)", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls), { lifecycle: ["register", "initialize"] });
    registry.register("b", makeService("b", calls, { throwOnInit: true }), {
        dependencies: ["a"],
        lifecycle: ["register", "initialize"],
    });
    registry.register("c", makeService("c", calls), { dependencies: ["b"], lifecycle: ["register", "initialize"] });

    await assert.rejects(() => registry.initializeAll({}), /boom-init:b/);
    // 'a' should have initialized; 'c' must NOT have been reached.
    assert.deepEqual(calls, ["init:a", "init:b"]);
});

test("initializeAll best-effort rolls back successfully-initialized services on failure", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls), { lifecycle: ["register", "initialize", "dispose"] });
    registry.register("b", makeService("b", calls, { throwOnInit: true }), {
        dependencies: ["a"],
        lifecycle: ["register", "initialize", "dispose"],
    });
    registry.register("c", makeService("c", calls), {
        dependencies: ["b"],
        lifecycle: ["register", "initialize", "dispose"],
    });

    await assert.rejects(() => registry.initializeAll({}), /boom-init:b/);
    // 'a' initialized then was disposed in reverse order; 'b' threw before being added to initialized list; 'c' never ran.
    assert.deepEqual(calls, ["init:a", "init:b", "dispose:a"]);
});

test("initializeAll rollback skips services without 'dispose' in lifecycle", async () => {
    const calls = [];
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", makeService("a", calls), { lifecycle: ["register", "initialize"] });
    registry.register("b", makeService("b", calls, { throwOnInit: true }), {
        dependencies: ["a"],
        lifecycle: ["register", "initialize"],
    });

    await assert.rejects(() => registry.initializeAll({}), /boom-init:b/);
    // 'a' has no 'dispose' in lifecycle, so rollback skips it (unchanged from old propagation behavior).
    assert.deepEqual(calls, ["init:a", "init:b"]);
});

test("initializeAll rollback swallows dispose errors but still re-throws original init error", async () => {
    const calls = [];
    const aService = {
        async initialize() {
            calls.push("init:a");
        },
        dispose() {
            calls.push("dispose:a");
            throw new Error("rollback-boom-a");
        },
    };
    const registry = new ServiceRegistry(undefined, "world");
    registry.register("a", aService, { lifecycle: ["register", "initialize", "dispose"] });
    registry.register("b", makeService("b", calls, { throwOnInit: true }), {
        dependencies: ["a"],
        lifecycle: ["register", "initialize", "dispose"],
    });

    await assert.rejects(() => registry.initializeAll({}), /boom-init:b/);
    assert.deepEqual(calls, ["init:a", "init:b", "dispose:a"]);
});
