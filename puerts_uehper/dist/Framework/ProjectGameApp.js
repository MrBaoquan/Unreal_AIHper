"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProjectGameApp = exports.ConfiguredProjectGameApp = void 0;
const CapabilityPack_1 = require("../Multiplayer/CapabilityPack");
class ConfiguredProjectGameApp {
    constructor(config = {}) {
        this.config = config;
    }
    async initializeRoot(rootContext) {
        const resources = rootContext.services.get('resources');
        resources.setManifest(this.config.resourceManifest ?? {});
        resources.setPreloadGroups(this.config.resourcePreloadGroups ?? {});
        // P0-A: 注册 root-scoped 模块。框架 FrameworkApp 会在 rootServices.initializeAll 之后
        // 调用 rootModules.initializeAll + startAll，此处只需 registerMany。
        // rootModules 通过 rootContext.getService 访问 root services（events/commands/resources），
        // 并可注册自己的 root-scoped 服务供 World 层通过 context.rootServices.getService 消费。
        const frameworkApp = globalThis.__uehperFrameworkApp;
        if (frameworkApp && this.config.rootModules && this.config.rootModules.length > 0) {
            const rootModules = frameworkApp.getRootModules();
            rootModules.registerMany(this.config.rootModules);
            rootContext.logger.info(`GameApp root initialized with ${this.config.rootModules.length} root modules`);
        }
        else {
            rootContext.logger.info('GameApp root initialized');
        }
    }
    async initializeWorld(context) {
        // 多人能力包先于模块装配：modules.initializeAll 内的多人 Module 会 getService('playerRegistry') 等，
        // 若不在装模块前注册，会因服务缺失而失败。opt-in 由 ProjectConfig.multiplayer 开关决定。
        if (this.config.multiplayer === true) {
            (0, CapabilityPack_1.registerMultiplayerCapabilityPack)(context.services, context.world);
            context.logger.info('GameApp multiplayer capability pack installed');
        }
        context.services.get('ui').setManifest(this.config.uiManifest ?? {});
        context.services.get('scenes').setManifest(this.config.sceneManifest ?? {});
        const modules = context.services.get('modules');
        modules.registerMany(this.config.modules ?? []);
        await modules.initializeAll(context);
        context.logger.info('GameApp started');
    }
    async onWorldBeginPlay(context) {
        await context.services.get('modules').startAll();
    }
    async onWorldCleanup(context) {
        const modules = context.services.get('modules');
        await modules.stopAll();
        await modules.disposeAll();
        context.services.get('ui').releaseAll();
    }
}
exports.ConfiguredProjectGameApp = ConfiguredProjectGameApp;
function createProjectGameApp(config = {}) {
    return new ConfiguredProjectGameApp(config);
}
exports.createProjectGameApp = createProjectGameApp;
//# sourceMappingURL=ProjectGameApp.js.map