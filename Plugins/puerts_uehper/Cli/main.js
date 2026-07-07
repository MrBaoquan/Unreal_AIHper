const path = require("path");
const {
    logFailure,
    fail,
} = require("./shared");
const { createCliOptions } = require("./args");
const { buildContext } = require("./context");
const { printHelp } = require("./help");
const {
    configureCommandDependencies,
    isSupportedCommand,
    canDispatchCommand,
    runCommand,
} = require("./commands");

const options = createCliOptions(process.argv, "install");
const command = (options.command === "--help" || options.command === "-h") ? "help" : options.command;
const packageRoot = process.env.UEHPER_CLI_SCRIPT_ROOT ? path.resolve(process.env.UEHPER_CLI_SCRIPT_ROOT) : path.resolve(__dirname, "..");

configureCommandDependencies();

async function main() {
    if (!isSupportedCommand(command)) {
        printHelp();
        fail(`Unsupported command: ${command}`);
    }

    if (command === "help") {
        printHelp();
        return;
    }

    const projectStartDir = options.getOptionValue("--project") || process.cwd();
    const context = buildContext(projectStartDir, options, packageRoot);

    if (!canDispatchCommand(command)) {
        fail(`Command is supported but has no handler: ${command}`);
    }

    const result = await runCommand(command, context, options);
    if (!result.success) {
        process.exitCode = result.exitCode || 1;
    }
}

main().catch((error) => {
    logFailure(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
