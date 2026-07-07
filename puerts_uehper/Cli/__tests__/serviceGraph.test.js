"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { analyzeServiceGraph } = require("../doctor");

test("analyzeServiceGraph topologically sorts a valid graph", () => {
    const graph = [
        { name: "a", scopeName: "root", dependencies: [], lifecycle: ["register"] },
        { name: "b", scopeName: "root", dependencies: ["a"], lifecycle: ["register"] },
        { name: "c", scopeName: "root", dependencies: ["b"], lifecycle: ["register"] },
    ];
    const result = analyzeServiceGraph(graph);
    assert.equal(result.isValid, true);
    assert.deepEqual(result.cycles, []);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.order, ["a", "b", "c"]);
});

test("analyzeServiceGraph detects cycles", () => {
    const graph = [
        { name: "a", scopeName: "root", dependencies: ["b"], lifecycle: ["register"] },
        { name: "b", scopeName: "root", dependencies: ["a"], lifecycle: ["register"] },
    ];
    const result = analyzeServiceGraph(graph);
    assert.equal(result.isValid, false);
    assert.equal(result.cycles.length >= 1, true);
});

test("analyzeServiceGraph detects missing dependencies", () => {
    const graph = [
        { name: "a", scopeName: "root", dependencies: ["ghost"], lifecycle: ["register"] },
    ];
    const result = analyzeServiceGraph(graph);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.missing, [{ name: "a", dependency: "ghost" }]);
});
