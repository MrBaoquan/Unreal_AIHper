import * as UE from 'ue';

export type UIInputMode = 'none' | 'gameOnly' | 'uiOnly' | 'gameAndUI';

export interface UIInputRequest {
    key: string;
    widget: UE.UserWidget;
    playerController: UE.PlayerController;
    inputMode: UIInputMode;
    showMouseCursor?: boolean;
}

export class PlayerInputService {
    private readonly stacks = new Map<UE.PlayerController, UIInputRequest[]>();

    push(request: UIInputRequest): void {
        if (request.inputMode === 'none') {
            return;
        }

        const stack = this.getStack(request.playerController).filter((item) => item.key !== request.key);
        stack.push(request);
        this.stacks.set(request.playerController, stack);
        this.applyTop(request.playerController);
    }

    release(key: string, playerController?: UE.PlayerController): void {
        const targets = playerController ? [playerController] : Array.from(this.stacks.keys());
        for (const target of targets) {
            const stack = this.getStack(target).filter((item) => item.key !== key);
            if (stack.length > 0) {
                this.stacks.set(target, stack);
                this.applyTop(target);
            } else {
                this.stacks.delete(target);
                this.applyGameOnly(target);
            }
        }
    }

    clear(playerController?: UE.PlayerController): void {
        const targets = playerController ? [playerController] : Array.from(this.stacks.keys());
        for (const target of targets) {
            this.stacks.delete(target);
            this.applyGameOnly(target);
        }
    }

    getStack(playerController: UE.PlayerController): UIInputRequest[] {
        return [...(this.stacks.get(playerController) ?? [])];
    }

    private applyTop(playerController: UE.PlayerController): void {
        const stack = this.stacks.get(playerController);
        const request = stack?.[stack.length - 1];
        if (!request) {
            this.applyGameOnly(playerController);
            return;
        }

        if (request.showMouseCursor != null) {
            (playerController as any).bShowMouseCursor = request.showMouseCursor;
        }

        if (request.inputMode === 'gameOnly') {
            this.applyGameOnly(playerController);
        } else if (request.inputMode === 'uiOnly') {
            UE.WidgetBlueprintLibrary.SetInputMode_UIOnlyEx(playerController, request.widget, UE.EMouseLockMode.DoNotLock, false);
        } else if (request.inputMode === 'gameAndUI') {
            UE.WidgetBlueprintLibrary.SetInputMode_GameAndUIEx(playerController, request.widget, UE.EMouseLockMode.DoNotLock, true, false);
        }
    }

    private applyGameOnly(playerController: UE.PlayerController): void {
        (playerController as any).bShowMouseCursor = false;
        UE.WidgetBlueprintLibrary.SetInputMode_GameOnly(playerController, false);
    }

    dispose(): void {
        this.clear();
    }
}
