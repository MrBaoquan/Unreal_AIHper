"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { findCurrentProjectRoot } = require("./testHelpers");

// Load compiled default root services from Content/JavaScript (produced by `uehper.js build`).
const projectRoot = findCurrentProjectRoot();
const eventBusPath = path.join(
    projectRoot,
    "Content",
    "JavaScript",
    "puerts_uehper",
    "Framework",
    "EventBus.js",
);
const commandBusPath = path.join(
    projectRoot,
    "Content",
    "JavaScript",
    "puerts_uehper",
    "Framework",
    "CommandBus.js",
);
const serviceRegistryPath = path.join(
    projectRoot,
    "Content",
    "JavaScript",
    "puerts_uehper",
    "Framework",
    "ServiceRegistry.js",
);

const { EventBus } = require(eventBusPath);
const { CommandBus } = require(commandBusPath);
const { ServiceRegistry } = require(serviceRegistryPath);

test("EventBus.dispose clears all handlers", () => {
    const bus = new EventBus();
    let received = 0;
    bus.on("ping", () => { received += 1; });
    bus.emit("ping", undefined);
    assert.equal(received, 1);

    assert.equal(typeof bus.dispose, "function");
    bus.dispose();

    bus.emit("ping", undefined);
    assert.equal(received, 1, "no handler should fire after dispose");
});

test("CommandBus.dispose clears all registrations", async () => {
    const bus = new CommandBus();
    bus.register("ping", () => "pong");
    assert.equal(await bus.execute("ping", undefined), "pong");

    assert.equal(typeof bus.dispose, "function");
    bus.dispose();

    assert.equal(bus.has("ping"), false);
    await assert.rejects(() => bus.execute("ping", undefined), /Command not registered/);
});

test("root scope disposeAll calls dispose on events/commands/resources surrogates", async () => {
    const calls = [];
    const root = new ServiceRegistry(undefined, "root");

    const events = {
        dispose() { calls.push("dispose:events"); },
    };
    const commands = {
        dispose() { calls.push("dispose:commands"); },
    };
    const resources = {
        dispose() { calls.push("dispose:resources"); },
    };

    root.register("events", events, { lifecycle: ["register", "dispose"] });
    root.register("commands", commands, { lifecycle: ["register", "dispose"] });
    root.register("resources", resources, { lifecycle: ["register", "dispose"] });

    await root.disposeAll();

    // No dependencies => reverse insertion order from topo sort: resources, commands, events.
    assert.deepEqual(calls, ["dispose:resources", "dispose:commands", "dispose:events"]);
});

test("root scope disposeAll wired with real EventBus + CommandBus actually clears them", async () => {
    const root = new ServiceRegistry(undefined, "root");
    const events = new EventBus();
    const commands = new CommandBus();

    let eventFired = 0;
    events.on("ping", () => { eventFired += 1; });
    commands.register("ping", () => "pong");

    root.register("events", events, { lifecycle: ["register", "dispose"] });
    root.register("commands", commands, { lifecycle: ["register", "dispose"] });

    await root.disposeAll();

    events.emit("ping", undefined);
    assert.equal(eventFired, 0, "EventBus handlers should be cleared after root disposeAll");
    assert.equal(commands.has("ping"), false, "CommandBus registrations should be cleared after root disposeAll");
});
