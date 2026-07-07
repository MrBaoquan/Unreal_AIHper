import * as UE from 'ue';
export type UIInputMode = 'none' | 'gameOnly' | 'uiOnly' | 'gameAndUI';
export interface UIInputRequest {
    key: string;
    widget: UE.UserWidget;
    playerController: UE.PlayerController;
    inputMode: UIInputMode;
    showMouseCursor?: boolean;
}
export declare class PlayerInputService {
    private readonly stacks;
    push(request: UIInputRequest): void;
    release(key: string, playerController?: UE.PlayerController): void;
    clear(playerController?: UE.PlayerController): void;
    getStack(playerController: UE.PlayerController): UIInputRequest[];
    private applyTop;
    private applyGameOnly;
    dispose(): void;
}
//# sourceMappingURL=PlayerInputService.d.ts.map