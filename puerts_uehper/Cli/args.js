function getArgv() {
    return process.argv;
}

function getArg(index) {
    return getArgv()[index];
}

function getCommand(defaultCommand = "install") {
    return (getArg(2) || defaultCommand).toLowerCase();
}

function getTarget(index = 3) {
    return (getArg(index) || "").toLowerCase();
}

function getPositionalArg(index) {
    const value = getArg(index);
    return value && !value.startsWith("--") ? value : undefined;
}

function hasOption(name) {
    return getArgv().includes(name);
}

function getOptionValue(name) {
    const prefix = `${name}=`;
    const option = getArgv().find((arg) => arg.startsWith(prefix));
    return option ? option.slice(prefix.length) : undefined;
}

function isForce() {
    return hasOption("--force");
}

function isDryRun() {
    return hasOption("--dry-run");
}

function createCliOptions(argv = getArgv(), defaultCommand = "install") {
    const getArgAt = (index) => argv[index];
    const getCommandValue = (fallback = defaultCommand) => (getArgAt(2) || fallback).toLowerCase();
    const getTargetValue = (index = 3) => (getArgAt(index) || "").toLowerCase();
    const getPositionalArgAt = (index) => {
        const value = getArgAt(index);
        return value && !value.startsWith("--") ? value : undefined;
    };
    const hasOptionValue = (name) => argv.includes(name);
    const getOptionValueByName = (name) => {
        const prefix = `${name}=`;
        const option = argv.find((arg) => arg.startsWith(prefix));
        return option ? option.slice(prefix.length) : undefined;
    };

    return {
        argv,
        command: getCommandValue(defaultCommand),
        target: getTargetValue(),
        getArg: getArgAt,
        getCommand: getCommandValue,
        getTarget: getTargetValue,
        getPositionalArg: getPositionalArgAt,
        hasOption: hasOptionValue,
        getOptionValue: getOptionValueByName,
        isForce: () => hasOptionValue("--force"),
        isDryRun: () => hasOptionValue("--dry-run"),
    };
}

module.exports = {
    getArgv,
    getArg,
    getCommand,
    getTarget,
    getPositionalArg,
    hasOption,
    getOptionValue,
    isForce,
    isDryRun,
    createCliOptions,
};
