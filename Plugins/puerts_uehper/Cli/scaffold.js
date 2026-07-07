const path = require("path");
const {
    info,
    fail,
    writeTextFile,
    appendTextIfMissing,
} = require("./shared");
const {
    createCliOptions,
} = require("./args");
const { getGameDir } = require("./context");
const {
    makeUI,
    makeResource,
    makeScene,
} = require("./manifest");

let runBootstrap = () => fail("Scaffold init requires runBootstrap to be configured.");

function setScaffoldDependencies(dependencies) {
    if (dependencies.runBootstrap) {
        runBootstrap = dependencies.runBootstrap;
    }
}

function ensureUEHperConfig(context, options) {
    const configPath = path.join(context.projectRoot, "Config", "DefaultUEHper.ini");
    const entryModule = context.entryModule || "Game/GameApp";
    const content = `[/Script/UEHper.UEHperSettings]
bEnableUEHperRuntime=True
StartupPolicy=Auto
RuntimeScope=GameInstance
WorldContextPolicy=PIEIsolated
ScriptRoot=JavaScript
FrameworkModule=puerts_uehper/Framework/bootstrap
EntryModule=${entryModule}
bEnableEditorRuntime=True
bEnableHotReload=False
bEnableDiagnosticsOverlay=False
BootstrapTimeoutSeconds=30.000000
`;

    writeTextFile(configPath, content, { cliOptions: options });
}

function makeApp(context, options = createCliOptions()) {
    const gameAppPath = path.join(getGameDir(context), "GameApp.ts");
    const content = `import { ConfiguredProjectGameApp } from 'puerts_uehper';
import type { FrameworkContext } from 'puerts_uehper';
import { projectConfig } from './ProjectConfig';

export default class GameApp extends ConfiguredProjectGameApp {
    constructor() {
        super(projectConfig);
    }

    async initializeRoot(rootContext: FrameworkContext): Promise<void> {
        await super.initializeRoot(rootContext);
    }

    async initializeWorld(context: FrameworkContext): Promise<void> {
        await super.initializeWorld(context);
    }

    async onWorldBeginPlay(context: FrameworkContext): Promise<void> {
        await super.onWorldBeginPlay(context);
    }

    async onWorldCleanup(context: FrameworkContext): Promise<void> {
        await super.onWorldCleanup(context);
    }
}
`;

    writeTextFile(gameAppPath, content, { cliOptions: options });
}

function ensureProjectManifests(context, options = createCliOptions()) {
    const manifestsDir = path.join(getGameDir(context), "Manifests");
    writeTextFile(path.join(manifestsDir, "ui.ts"), `import type { UIManifest } from 'puerts_uehper';

// 编辑器生成：Content Browser 选中 Widget Blueprint 或其所在文件夹后执行
// UEHper > Generate UEHper Manifest from Selection / Folder。
// 编辑器会自动导出 selected-assets JSON 并调用 manifest selected 写回当前文件。
// 手动追加：puerts-uehper manifest widget GameHUD /Game/UI/WBP_GameHUD.WBP_GameHUD_C --layer=HUD。
export const uiManifest: UIManifest = {
    // GameHUD: { widgetClass: 'GameHUDClass', layer: 'HUD', zOrder: 0 },
};
`, { cliOptions: options });
    writeTextFile(path.join(manifestsDir, "resources.ts"), `import type { ResourceManifest, ResourcePreloadGroups } from 'puerts_uehper';

// 编辑器生成：Content Browser 选中资源或文件夹后执行
// UEHper > Generate UEHper Manifest from Selection / Folder。
// 编辑器会自动导出 selected-assets JSON 并调用 manifest selected 写回当前文件。
// 手动追加：puerts-uehper manifest resource CandyMesh StaticMesh /Game/Models/Candy/SM_Candy.SM_Candy。
export const resourceManifest: ResourceManifest = {
    // CandyMesh: { type: 'StaticMesh', path: '/Game/Models/Candy/SM_Candy.SM_Candy' },
    // GameHUDClass: { type: 'WidgetClass', path: '/Game/UI/WBP_GameHUD.WBP_GameHUD_C' },
};

export const resourcePreloadGroups: ResourcePreloadGroups = {
    // Startup: ['CandyMesh', 'GameHUDClass'],
};
`, { cliOptions: options });
    writeTextFile(path.join(manifestsDir, "scenes.ts"), `import type { SceneManifest } from 'puerts_uehper';

// 编辑器生成：Content Browser 选中地图或其所在文件夹后执行
// UEHper > Generate UEHper Manifest from Selection / Folder。
// 编辑器会自动导出 selected-assets JSON 并调用 manifest selected 写回当前文件。
// 手动追加：puerts-uehper manifest scene Game /Game/Levels/LEVELgame。
export const sceneManifest: SceneManifest = {
    // Game: { levelName: '/Game/Levels/LEVELgame', mapPath: '/Game/Levels/LEVELgame', preloadGroups: ['Startup'] },
};
`, { cliOptions: options });
    writeTextFile(path.join(getGameDir(context), "ProjectConfig.ts"), `import { resourceManifest, resourcePreloadGroups } from './Manifests/resources';
import { sceneManifest } from './Manifests/scenes';
import { uiManifest } from './Manifests/ui';
import { modules } from './Modules';
import type { ProjectConfig } from 'puerts_uehper';

export const projectConfig: ProjectConfig = {
    resourceManifest,
    resourcePreloadGroups,
    sceneManifest,
    uiManifest,
    modules,
};
`, { cliOptions: options });
    writeTextFile(path.join(getGameDir(context), "Modules", "index.ts"), `import type { GameModuleRegistration } from 'puerts_uehper';

export const modules: GameModuleRegistration[] = [];
`, { cliOptions: options });
}

function runInit(context, options = createCliOptions()) {
    runBootstrap(context, options);
    ensureUEHperConfig(context, options);
    makeApp(context, options);
    ensureProjectManifests(context, options);
    info("Project TypeScript game scaffold initialized.");
}

function toPascalCase(value) {
    return value
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

function requireArg(options, index, label) {
    const value = options.getArg(index);
    if (!value || value.startsWith("--")) {
        fail(`Missing ${label}.`);
    }
    return value;
}

function makeModule(context, options) {
    const rawName = requireArg(options, 4, "module name");
    const name = toPascalCase(rawName);
    const className = `${name}Module`;
    const moduleDir = path.join(getGameDir(context), "Modules", name);
    const moduleFile = path.join(moduleDir, `${className}.ts`);
    const content = `import type { FrameworkContext, GameModule } from 'puerts_uehper';

export default class ${className} implements GameModule {
    readonly name = '${name}';

    initialize(context: FrameworkContext): void {
        context.logger.info('${className} initialized');
    }
}
`;

    writeTextFile(moduleFile, content, { cliOptions: options });
    appendTextIfMissing(
        path.join(getGameDir(context), "Modules", "index.ts"),
        `${className}`,
        `import ${className} from './${name}/${className}';\nexport { default as ${className} } from './${name}/${className}';\nmodules.push(${className});\n`,
        { cliOptions: options }
    );
}

function makeService(context, options) {
    const rawName = requireArg(options, 4, "service name");
    const name = toPascalCase(rawName);
    const serviceFile = path.join(getGameDir(context), "Services", `${name}.ts`);
    const content = `import type { FrameworkContext } from 'puerts_uehper';

/**
 * 在 GameApp.initializeRoot / initializeWorld 中通过 services.register 注册：
 *
 * context.services.register('${name.charAt(0).toLowerCase() + name.slice(1)}', new ${name}(), {
 *     // dependencies: ['otherService'],
 *     lifecycle: ['register', 'initialize', 'dispose'],
 * });
 *
 * 框架会按拓扑序自动调用 initialize(context) 与 dispose()（在 world 销毁时）。
 */
export default class ${name} {
    initialize(context: FrameworkContext): void {
        context.logger.info('${name} initialized');
    }

    dispose(): void {
        // 释放资源、取消订阅等
    }
}
`;

    writeTextFile(serviceFile, content, { cliOptions: options });
}

function runMake(context, options = createCliOptions()) {
    const makeTarget = options.getTarget();
    if (makeTarget === "app") {
        makeApp(context, options);
        return;
    }
    if (makeTarget === "module") {
        makeModule(context, options);
        return;
    }
    if (makeTarget === "ui") {
        makeUI(context, options);
        return;
    }
    if (makeTarget === "resource") {
        makeResource(context, options);
        return;
    }
    if (makeTarget === "scene") {
        makeScene(context, options);
        return;
    }
    if (makeTarget === "service") {
        makeService(context, options);
        return;
    }

    fail("Unsupported make target. Use app, module, ui, resource, scene, or service.");
}

module.exports = {
    setScaffoldDependencies,
    ensureProjectManifests,
    ensureUEHperConfig,
    makeApp,
    makeService,
    runInit,
    runMake,
};
