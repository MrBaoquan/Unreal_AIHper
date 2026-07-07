import * as UE from 'ue';
import type { CancellationToken } from '../Framework/Cancellation';
import type { FrameworkContext } from '../Framework/FrameworkContext';
import { PlayerInputService, type UIInputMode } from './PlayerInputService';
import { ResourceFacade } from './ResourceService';
/**
 * World UI 挂载选项（可选，存在则 widget 走 UEHperUIWorldHostActor 挂到世界空间）。
 * 仅当 manifest 或 open options 中提供 world 字段时启用 World 路径，否则保持
 * 原有 ViewPort 行为（屏幕空间 HUD）。
 *
 * 通用性：框架只负责"把 widget 放到玩家前方某距离"，与具体交互手段无关
 * （手势 / 射线 / 鼠标 / 眼动等），项目侧通过订阅 host 的 OnPanelAttached / OnPanelDetached
 * 自行做交互绑定。
 */
export interface UIWorldPlacement {
    /** 相机正前方距离（cm），默认 100 */
    distanceCm?: number;
    /** 俯仰偏移（度），用于舒适区微调；默认 0 */
    pitchOffsetDeg?: number;
    /** 是否在打开时正对玩家（默认 true）。打开后不再跟随，符合"快照式定位"语义 */
    faceCameraOnSpawn?: boolean;
    /** Widget 在世界中的绘制宽度（cm），默认 800 */
    drawSizeX?: number;
    /** Widget 在世界中的绘制高度（cm），默认 600 */
    drawSizeY?: number;
    /** 面板整体缩放（默认 1）。替代在 BP_UIManager 手调 PanelWidget RelativeScale3D */
    scale?: number;
    /** 相机视角平面内向右偏移（cm），默认 0。负数向左 */
    offsetRightCm?: number;
    /** 相机视角平面内向上偏移（cm），默认 0。负数向下 */
    offsetUpCm?: number;
}
export interface UIManifestEntry {
    widgetClass: string;
    layer?: string;
    controller?: string;
    zOrder?: number;
    cache?: boolean;
    exclusive?: boolean;
    modal?: boolean;
    modalMask?: string;
    closeLayers?: string[];
    inputMode?: UIInputMode;
    showMouseCursor?: boolean;
    /** 存在时走 World UI 路径（UEHperUIWorldHostActor），否则走 ViewPort 路径。 */
    world?: UIWorldPlacement;
}
export type UIManifest = Record<string, UIManifestEntry>;
export interface UIOpenOptions {
    worldContextObject?: UE.Object;
    owningPlayer?: UE.PlayerController;
    zOrder?: number;
    layer?: string;
    cache?: boolean;
    exclusive?: boolean;
    modal?: boolean;
    modalMask?: string;
    closeLayers?: string[];
    cancellationToken?: CancellationToken;
    inputMode?: UIInputMode;
    showMouseCursor?: boolean;
    waitForTransition?: boolean;
    /** 覆盖 manifest 的 world 字段；设为 null/未设置时按 manifest entry 取值。 */
    world?: UIWorldPlacement;
}
export interface UICloseOptions {
    dispose?: boolean;
    cancellationToken?: CancellationToken;
    waitForTransition?: boolean;
}
export type UITransitionPhase = 'show' | 'hide';
export interface UITransitionContext<T extends UE.UserWidget = UE.UserWidget> {
    key: string;
    entry: UIManifestEntry;
    handle: UIHandle<T>;
    widget: T;
    phase: UITransitionPhase;
    cancellationToken?: CancellationToken;
}
export interface UITransitionTask {
    promise: Promise<void>;
    cancel?(): void;
}
export type UITransitionResult = void | Promise<void> | UITransitionTask;
export interface UIController<T extends UE.UserWidget = UE.UserWidget> {
    OnShowTransition?(context: UITransitionContext<T>): UITransitionResult;
    OnHideTransition?(context: UITransitionContext<T>): UITransitionResult;
}
/**
 * 控制器工厂：声明式注册的入口。框架在某个 UI 首次 open 时，按 manifest entry 的
 * `controller` 名查工厂并懒实例化（实例缓存进 controllers，与 registerController 等价）。
 *
 * 工厂在 open 时刻才被调用并传入当时的 FrameworkContext，因此可在闭包里安全解析
 * 那些"晚于模块 initialize 才注册"的服务（如依赖 Actor 发现的 gameView），
 * 业务层无需再在 module.start() 里做服务时序补偿。
 */
export type UIControllerFactory<T extends UE.UserWidget = UE.UserWidget> = (context: FrameworkContext) => UIController<T>;
export interface UIHandle<T extends UE.UserWidget = UE.UserWidget> {
    key: string;
    entry: UIManifestEntry;
    widget: T;
    layer: string;
    zOrder: number;
    cache: boolean;
    modal: boolean;
    modalMask?: string;
    openedAt: number;
    isOpen: boolean;
    isTransitioning: boolean;
    transitionPhase?: UITransitionPhase;
    /** 若挂载到 World Host，记录 host 引用以便 close 时 detach。 */
    worldHost?: UE.UEHperUIWorldHostActor;
}
export declare class UIService {
    private readonly resources;
    private readonly playerInput;
    private readonly manifest;
    private readonly handles;
    private readonly layerStacks;
    private readonly modalStack;
    private readonly modalMaskOwners;
    private readonly controllers;
    private readonly controllerFactories;
    private openSequence;
    constructor(resources: ResourceFacade, playerInput: PlayerInputService);
    setManifest(manifest: UIManifest): void;
    register(key: string, entry: UIManifestEntry): void;
    has(key: string): boolean;
    getEntry(key: string): UIManifestEntry | undefined;
    registerController(key: string, controller: UIController): void;
    unregisterController(key: string): void;
    /**
     * 注册控制器工厂（声明式入口）。manifest entry 的 `controller` 字段填这里的 name，
     * 框架在该 UI 首次 open 时懒实例化对应控制器。比 registerController 更解耦：
     * 业务层只声明"用哪个工厂"，无需在模块 start() 时手动 new 并预先备好依赖。
     */
    registerControllerFactory(name: string, factory: UIControllerFactory): void;
    unregisterControllerFactory(name: string): void;
    /**
     * 确保某 UI 的控制器实例已就绪：已有实例则跳过；否则按 entry.controller 查工厂懒实例化。
     * 在 open 路径挂载/过渡之前调用，使 runTransition 能取到控制器。
     */
    private ensureController;
    getHandle<T extends UE.UserWidget = UE.UserWidget>(key: string): UIHandle<T> | undefined;
    getLayerStack<T extends UE.UserWidget = UE.UserWidget>(layer: string): UIHandle<T>[];
    getTopInLayer<T extends UE.UserWidget = UE.UserWidget>(layer: string): UIHandle<T> | undefined;
    getModalStack<T extends UE.UserWidget = UE.UserWidget>(): UIHandle<T>[];
    isModalActive(): boolean;
    getModalMaskReferenceCount(maskKey: string): number;
    getModalMaskOwners(maskKey: string): string[];
    open<T extends UE.UserWidget = UE.UserWidget>(context: FrameworkContext, key: string, options?: UIOpenOptions): UIHandle<T>;
    openAsync<T extends UE.UserWidget = UE.UserWidget>(context: FrameworkContext, key: string, options?: UIOpenOptions): Promise<UIHandle<T>>;
    private showHandle;
    private showHandleAsync;
    /**
     * 内部：根据 entry.world 字段决定走 ViewPort 还是 World Host 路径。
     * - 有 world 字段：通过 UEHperUIWorldHostActor 挂到世界空间
     * - 无 world 字段：保持原有 ViewPort 行为
     */
    private mountWidget;
    private mountToViewport;
    private unmountWidget;
    /** 框架级 warn：World Host 解析失败时记录，不抛错（业务侧可能尚未注册 host）。 */
    private context_warnHostMissing;
    close(key: string, options?: UICloseOptions): boolean;
    closeAsync(key: string, options?: UICloseOptions): Promise<boolean>;
    closeLayer(layer: string, options?: UICloseOptions): number;
    closeLayerAsync(layer: string, options?: UICloseOptions): Promise<number>;
    closeAll(options?: UICloseOptions): void;
    closeAllAsync(options?: UICloseOptions): Promise<void>;
    release(key: string): void;
    releaseAll(): void;
    private createHandle;
    private openModalMask;
    private closeModalMask;
    private closeModalMaskAsync;
    private getOrCreateModalMaskOwners;
    private releaseModalMaskOwner;
    private clearModalMaskOwnersForClosedMask;
    private reorderModalMaskToTopOwner;
    private getTopModalMaskOwner;
    private reorderModalMask;
    private applyOpenPolicy;
    private closeLayerExcept;
    private activateHandle;
    private removeFromStacks;
    private getOrCreateLayerStack;
    private removeFromArray;
    private loadWidgetClass;
    private loadWidgetClassAsync;
    private requireEntry;
    private applyInputMode;
    private runTransition;
    private toTransitionTask;
    private isPromiseLike;
    private notifyWidget;
    dispose(): void;
}
//# sourceMappingURL=UIService.d.ts.map