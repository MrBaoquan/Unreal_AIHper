"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDefaultServiceMeta = exports.DEFAULT_SERVICES = void 0;
exports.DEFAULT_SERVICES = {
    root: [
        { name: 'events', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'commands', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'resources', dependencies: [], lifecycle: ['register', 'dispose'] },
    ],
    world: [
        { name: 'events', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'modules', dependencies: [], lifecycle: ['register', 'initialize', 'start', 'stop', 'dispose'] },
        { name: 'scenes', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'saveGames', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'timers', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'playerInput', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'worldResources', dependencies: ['resources'], lifecycle: ['register', 'dispose'] },
        { name: 'ui', dependencies: ['worldResources', 'playerInput'], lifecycle: ['register', 'dispose'] },
    ],
    /** opt-in 多人能力包子图；由 registerMultiplayerCapabilityPack(services, world) 装入。 */
    multiplayer: [
        { name: 'actorRegistry', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'playerRegistry', dependencies: [], lifecycle: ['register', 'dispose'] },
    ],
};
/** Lookup helper used by both FrameworkApp 与 doctor. */
function findDefaultServiceMeta(scope, name) {
    return exports.DEFAULT_SERVICES[scope].find((entry) => entry.name === name);
}
exports.findDefaultServiceMeta = findDefaultServiceMeta;
//# sourceMappingURL=DefaultServices.js.map