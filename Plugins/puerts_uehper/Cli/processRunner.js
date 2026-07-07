const path = require("path");
const { execSync, spawn } = require("child_process");
const {
    normalizePath,
    quoteArg,
} = require("./shared");

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function killProcessTree(pid) {
    if (!pid) {
        return;
    }

    try {
        if (process.platform === "win32") {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
        } else {
            process.kill(pid, "SIGTERM");
        }
    } catch (_) {
    }
}

function quotePowerShellSingleQuoted(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function cleanupShaderCompileWorkersForExecutable(executablePath) {
    if (process.platform !== "win32") {
        return;
    }

    const engineBinariesDir = normalizePath(path.dirname(executablePath));
    const command = [
        "$engineBinariesDir =", quotePowerShellSingleQuoted(engineBinariesDir), ";",
        "Get-CimInstance Win32_Process |",
        "Where-Object { $_.Name -eq 'ShaderCompileWorker.exe' -and ($_.ExecutablePath -replace '\\\\','/') -like \"$engineBinariesDir/*\" } |",
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
    ].join(" ");

    try {
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command ${quoteArg(command)}`, { stdio: "ignore" });
    } catch (_) {
    }
}

function runChildProcess(executablePath, args, cwd, timeoutMs, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(executablePath, args, {
            cwd,
            stdio: "inherit",
            windowsHide: false,
        });
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            killProcessTree(child.pid);
            if (options.cleanupShaderCompileWorkersOnTimeout) {
                cleanupShaderCompileWorkersForExecutable(executablePath);
            }
            reject(new Error(`Timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        child.on("error", (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            reject(error);
        });

        child.on("exit", (code) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(code ?? 0);
        });
    });
}

async function runPollingProcess(executablePath, args, cwd, timeoutMs, poll, options = {}) {
    const child = spawn(executablePath, args, {
        cwd,
        stdio: options.stdio || "ignore",
        windowsHide: false,
    });

    const state = {
        pid: child.pid,
        exited: false,
        exitCode: null,
        kill() {
            if (!state.exited) {
                killProcessTree(child.pid);
            }
        },
    };
    let spawnError = null;

    child.on("error", (error) => {
        spawnError = error;
        state.exited = true;
    });

    child.on("exit", (code) => {
        state.exited = true;
        state.exitCode = code;
    });

    const pollIntervalMs = options.pollIntervalMs || 1000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (spawnError) {
            throw spawnError;
        }

        const result = await poll(state);
        if (result && result.done) {
            return result.value;
        }
        await delay(pollIntervalMs);
    }

    if (spawnError) {
        throw spawnError;
    }

    if (options.killOnTimeout !== false) {
        state.kill();
    }
    throw new Error(options.timeoutMessage || `Timed out after ${timeoutMs}ms.`);
}

module.exports = {
    delay,
    killProcessTree,
    cleanupShaderCompileWorkersForExecutable,
    runChildProcess,
    runPollingProcess,
};
