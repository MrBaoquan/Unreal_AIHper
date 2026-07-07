"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMultiplayerCapabilityPackRegistered = exports.registerMultiplayerCapabilityPack = exports.MULTIPLAYER_SERVICE_NAMES = void 0;
const ActorRegistryService_1 = require("../Services/ActorRegistryService");
const DeviceTopologyService_1 = require("../Services/DeviceTopologyService");
const PlayerRegistryService_1 = require("../Services/PlayerRegistryService");
/** 多人能力包内服务名常量（与历史保持一致，确保 L3 `getService('playerRegistry')` 等无须改动）。 */
exports.MULTIPLAYER_SERVICE_NAMES = ['actorRegistry', 'playerRegistry', 'deviceTopology'];
/**
 * 把多人能力三项服务（actorRegistry / playerRegistry / deviceTopology）注册到指定 ServiceRegistry。
 * 必须在 modules.initializeAll 之前调用，否则多人 Module 的 getService 会因服务缺失而报错。
 * 重复调用幂等：若服务已存在，则 skip（不再覆盖既有实例）。
 *
 * @param world 当前 World 对象引用（字符串版），保留给未来需要直接绑定 World 上下文的多人能力扩展；
 *              当前两项构造均不直接依赖 world，可省略。
 */
function registerMultiplayerCapabilityPack(services, world) {
    if (!services.has('actorRegistry')) {
        services.register('actorRegistry', new ActorRegistryService_1.ActorRegistryService(), { dependencies: [], lifecycle: ['register', 'dispose'] });
    }
    if (!services.has('playerRegistry')) {
        services.register('playerRegistry', new PlayerRegistryService_1.PlayerRegistryService(), { dependencies: [], lifecycle: ['register', 'dispose'] });
    }
    if (!services.has('deviceTopology')) {
        services.register('deviceTopology', new DeviceTopologyService_1.DefaultDeviceTopologyService(), { dependencies: [], lifecycle: ['register', 'dispose'] });
    }
    // world 参数保留给未来需要直接绑定 World 上下文的多人能力扩展；当前两项构造均不直接依赖 world。
    void world;
}
exports.registerMultiplayerCapabilityPack = registerMultiplayerCapabilityPack;
/** 检测某组服务是否已注册（doctor 或 GameApp 自检用）。 */
function isMultiplayerCapabilityPackRegistered(services) {
    return exports.MULTIPLAYER_SERVICE_NAMES.every((name) => services.has(name));
}
exports.isMultiplayerCapabilityPackRegistered = isMultiplayerCapabilityPackRegistered;
//# sourceMappingURL=CapabilityPack.js.map