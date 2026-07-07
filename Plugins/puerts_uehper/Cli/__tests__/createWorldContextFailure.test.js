"use strict";

// Stage 7.3: createWorldContext 失败路径集成测试。
// 通过 Module.prototype.require 注入 'ue' 桩，并把 FrameworkApp 的私有 createWorldServices 替换成
// 空 ServiceRegistry，规避真实 Service 构造对 UE API 的依赖；专注验证 catch 块的回滚链路：
//   1) projectApp.onWorldInitFailed 被调用，且 error 透传。
//   2) destroyWorldContext 被调用 → contexts map 不残留。
//   3) hook 抛错不掩盖原 error。
//   4) 未实现 onWorldInitFailed 时仍正常回滚 + 重抛。

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { test, after } = require("node:test");
const { findCurrentProjectRoot } = require("./testHelpers");

// 注入 'ue' 桩（必须在 require FrameworkApp.js 之前）。
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === "ue" || id === "puerts") {
        return new Proxy({}, { get: () => function () { return null; } });
    }
    return originalRequire.apply(this, arguments);
};

// Stage 7.10: 即使当前测试以独立进程入口运行（进程退出会自动销毁 monkey-patch），
// 仍显式注册 after() 钩子还原 Module.prototype.require，使本测试文件能安全地被未来的
// mocha/jest 单进程多文件 runner 复用，不污染同进程其它 require 调用。
after(() => {
    Module.prototype.require = originalRequire;
});

const projectRoot = findCurrentProjectRoot();
const compiledDir = path.join(
    projectRoot,
    "Content",
    "JavaScript",
    "puerts_uehper",
    "Framework",
);
const { FrameworkApp } = require(path.join(compiledDir, "FrameworkApp.js"));
const { ServiceRegistry } = require(path.join(compiledDir, "ServiceRegistry.js"));

function makeWorldInfo(id) {
    return { id, world: {}, type: "PIE", isPIE: true };
}

function makeApp(projectApp) {
    const app = new FrameworkApp();
    // 注入 projectApp 与 contexts map（绕过 initialize()，因为我们不想触发 root 服务注册路径）。
    app["projectApp"] = projectApp;
    // 用空 ServiceRegistry 替换 createWorldServices，避免依赖真实 UE Service。
    app["createWorldServices"] = () => new ServiceRegistry();
    return app;
}

test("createWorldContext failure: invokes onWorldInitFailed and rolls back context", async () => {
    const hookCalls = [];
    const projectApp = {
        async initializeWorld() {
            throw new Error("world-boom");
        },
        async onWorldInitFailed(context, error) {
            hookCalls.push({ id: context.id, message: error && error.message });
        },
    };
    const app = makeApp(projectApp);

    await assert.rejects(
        () => app.createWorldContext(makeWorldInfo("w1")),
        (err) => err instanceof Error && err.message === "world-boom",
    );

    assert.equal(hookCalls.length, 1, "onWorldInitFailed must be called once");
    assert.equal(hookCalls[0].id, "w1");
    assert.equal(hookCalls[0].message, "world-boom");
    assert.equal(app.getContext("w1"), undefined, "contexts map must not retain w1");
});

test("createWorldContext failure: hook throw is swallowed; original error rethrown", async () => {
    let hookInvoked = false;
    const projectApp = {
        async initializeWorld() {
            throw new Error("world-boom-2");
        },
        async onWorldInitFailed() {
            hookInvoked = true;
            throw new Error("hook-explode");
        },
    };
    const app = makeApp(projectApp);

    await assert.rejects(
        () => app.createWorldContext(makeWorldInfo("w2")),
        (err) => err instanceof Error && err.message === "world-boom-2",
    );

    assert.equal(hookInvoked, true, "hook must have been invoked");
    assert.equal(app.getContext("w2"), undefined, "contexts map must not retain w2 even after hook throw");
});

test("createWorldContext failure: missing onWorldInitFailed still rolls back and rethrows", async () => {
    const projectApp = {
        async initializeWorld() {
            throw new Error("world-boom-3");
        },
        // 显式不实现 onWorldInitFailed
    };
    const app = makeApp(projectApp);

    await assert.rejects(
        () => app.createWorldContext(makeWorldInfo("w3")),
        (err) => err instanceof Error && err.message === "world-boom-3",
    );

    assert.equal(app.getContext("w3"), undefined, "contexts map must not retain w3");
});

test("createWorldContext failure: services.initializeAll throw also triggers rollback", async () => {
    let hookCalledWith = null;
    const projectApp = {
        async initializeWorld() {
            // 成功；故意让后续 services.initializeAll 阶段抛错。
        },
        async onWorldInitFailed(context, error) {
            hookCalledWith = { id: context.id, message: error && error.message };
        },
    };
    const app = makeApp(projectApp);
    // 覆盖 createWorldServices，让 initializeAll 阶段抛错。
    app["createWorldServices"] = () => {
        const sr = new ServiceRegistry();
        sr.register("boomSvc", {
            async initialize() { throw new Error("init-boom"); },
            dispose() {},
        }, { lifecycle: ["register", "initialize", "dispose"] });
        return sr;
    };

    await assert.rejects(
        () => app.createWorldContext(makeWorldInfo("w4")),
        (err) => err instanceof Error && err.message === "init-boom",
    );

    assert.notEqual(hookCalledWith, null, "hook must be called when services.initializeAll throws");
    assert.equal(hookCalledWith.id, "w4");
    assert.equal(hookCalledWith.message, "init-boom");
    assert.equal(app.getContext("w4"), undefined);
});

console.log("[createWorldContext-failure] 4 tests passed.");
