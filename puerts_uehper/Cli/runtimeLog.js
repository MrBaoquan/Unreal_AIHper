// Stage 7.5: 抽出 Saved/Logs 中 RuntimeState 转换行的解析逻辑，
// 在 doctor 报告（readRuntimeStateLastKnown）与 watch 模式（pickLatestLog + 正则）之间共享，避免双源维护。
const path = require("path");
const fs = require("fs");

const RUNTIME_STATE_PATTERN = /RuntimeState\s+(\w+)\s+->\s+(\w+)/;
const FRAMEWORK_APP_INITIALIZED_PATTERN = /FrameworkApp initialized\. entryModule=([^\s]+)/;
const BOOTSTRAP_READY_PATTERN = /UEHper TS bootstrap ready|Framework bootstrap completed/;
const BOOTSTRAP_IGNORED_PATTERN = /NotifyBootstrapResult ignored/;

// Stage 7.7: 解析 UE 标准日志行前缀 [YYYY.MM.DD-HH.MM.SS:mmm][frame]LogCategory:。
// 命中时返回 { ueTs, frame, category }；未命中（例如换行/纯文本）返回 null。
// ueTs 输出 ISO-8601-ish 形式 "YYYY-MM-DDTHH:MM:SS.mmmZ" 风格便于聚合工具消费；
// 因 UE 写入的时间默认是本地时区，本字段不会强行附加 Z，以免误导消费方做 UTC 转换。
const UE_LOG_PREFIX_PATTERN = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]\[\s*(\d+)\]([A-Za-z0-9_]+):/;

function parseUeLogPrefix(line) {
    if (typeof line !== "string") {
        return null;
    }
    const m = line.match(UE_LOG_PREFIX_PATTERN);
    if (!m) {
        return null;
    }
    return {
        ueTs: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}`,
        frame: Number.parseInt(m[8], 10),
        category: m[9],
    };
}

function resolveLogsDir(context) {
    return path.join(context.projectRoot, "Saved", "Logs");
}

function listLogFilesByMtimeDesc(logsDir) {
    if (!fs.existsSync(logsDir)) {
        return [];
    }
    let entries;
    try {
        entries = fs.readdirSync(logsDir).filter((entry) => entry.toLowerCase().endsWith(".log"));
    } catch (_error) {
        return [];
    }
    return entries
        .map((name) => {
            const full = path.join(logsDir, name);
            try {
                const stat = fs.statSync(full);
                return { full, mtime: stat.mtimeMs, size: stat.size };
            } catch (_error) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
}

function pickLatestLog(logsDir) {
    const sorted = listLogFilesByMtimeDesc(logsDir);
    return sorted.length > 0 ? sorted[0] : null;
}

function readRuntimeStateLastKnown(context) {
    const logsDir = resolveLogsDir(context);
    const result = { state: null, sourceLog: null, sourceLine: null, mtime: null, available: false };
    const candidates = listLogFilesByMtimeDesc(logsDir);
    if (candidates.length === 0) {
        return result;
    }
    for (const candidate of candidates) {
        let content;
        try {
            content = fs.readFileSync(candidate.full, "utf8");
        } catch (_error) {
            continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
            const match = lines[i].match(RUNTIME_STATE_PATTERN);
            if (match) {
                result.state = match[2];
                result.sourceLog = candidate.full;
                result.sourceLine = lines[i].trim();
                result.mtime = new Date(candidate.mtime).toISOString();
                result.available = true;
                return result;
            }
        }
    }
    return result;
}

function analyzeRuntimeBootstrapReadinessLines(lines) {
    const result = {
        available: Array.isArray(lines) && lines.length > 0,
        status: "unknown",
        entryModule: null,
        runningReached: false,
        bootstrapReady: false,
        ignoredBootstrapResult: false,
        ignoredLine: null,
        runningLine: null,
        readyLine: null,
        initializedLine: null,
    };

    if (!result.available) {
        return result;
    }

    for (const rawLine of lines) {
        const line = String(rawLine || "").trim();
        const initialized = line.match(FRAMEWORK_APP_INITIALIZED_PATTERN);
        if (initialized) {
            result.entryModule = initialized[1];
            result.initializedLine = line;
        }

        const transition = line.match(RUNTIME_STATE_PATTERN);
        if (transition && transition[2] === "Running") {
            result.runningReached = true;
            result.runningLine = line;
        }

        if (BOOTSTRAP_READY_PATTERN.test(line)) {
            result.bootstrapReady = true;
            result.readyLine = line;
        }

        if (BOOTSTRAP_IGNORED_PATTERN.test(line)) {
            result.ignoredBootstrapResult = true;
            result.ignoredLine = line;
        }
    }

    if (result.ignoredBootstrapResult) {
        result.status = "blocked";
    } else if (result.runningReached && result.bootstrapReady) {
        result.status = "ready";
    } else if (result.runningReached) {
        result.status = "running";
    } else {
        result.status = "pending";
    }

    return result;
}

function readRuntimeBootstrapReadiness(context) {
    const logsDir = resolveLogsDir(context);
    const latest = pickLatestLog(logsDir);
    const result = {
        ...analyzeRuntimeBootstrapReadinessLines([]),
        sourceLog: latest ? latest.full : null,
        mtime: latest ? new Date(latest.mtime).toISOString() : null,
    };

    if (!latest) {
        return result;
    }

    try {
        const content = fs.readFileSync(latest.full, "utf8");
        return {
            ...analyzeRuntimeBootstrapReadinessLines(content.split(/\r?\n/)),
            sourceLog: latest.full,
            mtime: new Date(latest.mtime).toISOString(),
        };
    } catch (_error) {
        return result;
    }
}

module.exports = {
    RUNTIME_STATE_PATTERN,
    UE_LOG_PREFIX_PATTERN,
    FRAMEWORK_APP_INITIALIZED_PATTERN,
    BOOTSTRAP_READY_PATTERN,
    BOOTSTRAP_IGNORED_PATTERN,
    parseUeLogPrefix,
    resolveLogsDir,
    listLogFilesByMtimeDesc,
    pickLatestLog,
    readRuntimeStateLastKnown,
    analyzeRuntimeBootstrapReadinessLines,
    readRuntimeBootstrapReadiness,
};
