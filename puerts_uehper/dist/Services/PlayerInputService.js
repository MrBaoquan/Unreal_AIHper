"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerInputService = void 0;
const UE = require("ue");
class PlayerInputService {
    constructor() {
        this.stacks = new Map();
    }
    push(request) {
        if (request.inputMode === 'none') {
            return;
        }
        const stack = this.getStack(request.playerController).filter((item) => item.key !== request.key);
        stack.push(request);
        this.stacks.set(request.playerController, stack);
        this.applyTop(request.playerController);
    }
    release(key, playerController) {
        const targets = playerController ? [playerController] : Array.from(this.stacks.keys());
        for (const target of targets) {
            const stack = this.getStack(target).filter((item) => item.key !== key);
            if (stack.length > 0) {
                this.stacks.set(target, stack);
                this.applyTop(target);
            }
            else {
                this.stacks.delete(target);
                this.applyGameOnly(target);
            }
        }
    }
    clear(playerController) {
        const targets = playerController ? [playerController] : Array.from(this.stacks.keys());
        for (const target of targets) {
            this.stacks.delete(target);
            this.applyGameOnly(target);
        }
    }
    getStack(playerController) {
        return [...(this.stacks.get(playerController) ?? [])];
    }
    applyTop(playerController) {
        const stack = this.stacks.get(playerController);
        const request = stack?.[stack.length - 1];
        if (!request) {
            this.applyGameOnly(playerController);
            return;
        }
        if (request.showMouseCursor != null) {
            playerController.bShowMouseCursor = request.showMouseCursor;
        }
        if (request.inputMode === 'gameOnly') {
            this.applyGameOnly(playerController);
        }
        else if (request.inputMode === 'uiOnly') {
            UE.WidgetBlueprintLibrary.SetInputMode_UIOnlyEx(playerController, request.widget, UE.EMouseLockMode.DoNotLock, false);
        }
        else if (request.inputMode === 'gameAndUI') {
            UE.WidgetBlueprintLibrary.SetInputMode_GameAndUIEx(playerController, request.widget, UE.EMouseLockMode.DoNotLock, true, false);
        }
    }
    applyGameOnly(playerController) {
        playerController.bShowMouseCursor = false;
        UE.WidgetBlueprintLibrary.SetInputMode_GameOnly(playerController, false);
    }
    dispose() {
        this.clear();
    }
}
exports.PlayerInputService = PlayerInputService;
//# sourceMappingURL=PlayerInputService.js.map