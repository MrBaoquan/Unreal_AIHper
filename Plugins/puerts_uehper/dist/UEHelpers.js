"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const UE = require("ue");
class UEHelpers {
    static DisableScreenMessages(world) {
        UE.KismetSystemLibrary.ExecuteConsoleCommand(world, 'DisableAllScreenMessages');
    }
    static EnableScreenMessages(world) {
        UE.KismetSystemLibrary.ExecuteConsoleCommand(world, 'EnableAllScreenMessages');
    }
    static ExecuteConsoleCommand(world, command) {
        UE.KismetSystemLibrary.ExecuteConsoleCommand(world, command);
    }
}
exports.default = UEHelpers;
//# sourceMappingURL=UEHelpers.js.map