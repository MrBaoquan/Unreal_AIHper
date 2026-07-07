"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameworkContext = void 0;
const ServiceRegistry_1 = require("./ServiceRegistry");
class ConsoleFrameworkLogger {
    constructor(prefix) {
        this.prefix = prefix;
    }
    info(message) {
        console.log(`${this.prefix} ${message}`);
    }
    warn(message) {
        console.warn(`${this.prefix} ${message}`);
    }
    error(message) {
        console.error(`${this.prefix} ${message}`);
    }
}
class FrameworkContext {
    constructor(info, services, ownsServices = services == null) {
        this.info = info;
        this.id = info.id;
        this.world = info.world;
        this.ownsServices = ownsServices;
        this.services = services ?? new ServiceRegistry_1.ServiceRegistry();
        this.rootServices = this.services.getRoot();
        this.logger = new ConsoleFrameworkLogger(`[uehper:${this.id}]`);
    }
    getService(name) {
        return this.services.get(name);
    }
    getLocalService(name) {
        return this.services.getLocal(name);
    }
    async beginPlay() {
        this.logger.info('FrameworkContext beginPlay');
    }
    async dispose() {
        this.logger.info('FrameworkContext dispose');
        if (this.ownsServices) {
            this.services.clear();
        }
    }
}
exports.FrameworkContext = FrameworkContext;
//# sourceMappingURL=FrameworkContext.js.map