import { $ref, $unref } from 'puerts';
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

export class UIService {
    private readonly manifest = new Map<string, UIManifestEntry>();
    private readonly handles = new Map<string, UIHandle>();
    private readonly layerStacks = new Map<string, string[]>();
    private readonly modalStack: string[] = [];
    private readonly modalMaskOwners = new Map<string, Set<string>>();
    private readonly controllers = new Map<string, UIController>();
    private readonly controllerFactories = new Map<string, UIControllerFactory>();
    private openSequence = 0;

    constructor(
        private readonly resources: ResourceFacade,
        private readonly playerInput: PlayerInputService,
    ) {}

    setManifest(manifest: UIManifest): void {
        this.manifest.clear();
        for (const key of Object.keys(manifest)) {
            this.register(key, manifest[key]);
        }
    }

    register(key: string, entry: UIManifestEntry): void {
        if (!key) {
            throw new Error('UI key is empty.');
        }
        if (!entry?.widgetClass) {
            throw new Error(`UI widgetClass is empty: ${key}`);
        }

        this.manifest.set(key, { ...entry });
    }

    has(key: string): boolean {
        return this.manifest.has(key);
    }

    getEntry(key: string): UIManifestEntry | undefined {
        const entry = this.manifest.get(key);
        return entry ? { ...entry } : undefined;
    }

    registerController(key: string, controller: UIController): void {
        if (!key) {
            throw new Error('UI controller key is empty.');
        }
        this.controllers.set(key, controller);
    }

    unregisterController(key: string): void {
        this.controllers.delete(key);
    }

    /**
     * 注册控制器工厂（声明式入口）。manifest entry 的 `controller` 字段填这里的 name，
     * 框架在该 UI 首次 open 时懒实例化对应控制器。比 registerController 更解耦：
     * 业务层只声明"用哪个工厂"，无需在模块 start() 时手动 new 并预先备好依赖。
     */
    registerControllerFactory(name: string, factory: UIControllerFactory): void {
        if (!name) {
            throw new Error('UI controller factory name is empty.');
        }
        this.controllerFactories.set(name, factory);
    }

    unregisterControllerFactory(name: string): void {
        this.controllerFactories.delete(name);
    }

    /**
     * 确保某 UI 的控制器实例已就绪：已有实例则跳过；否则按 entry.controller 查工厂懒实例化。
     * 在 open 路径挂载/过渡之前调用，使 runTransition 能取到控制器。
     */
    private ensureController(context: FrameworkContext, key: string, entry: UIManifestEntry): void {
        if (this.controllers.has(key)) {
            return;
        }
        const factoryName = entry.controller;
        if (!factoryName) {
            return;
        }
        const factory = this.controllerFactories.get(factoryName);
        if (!factory) {
            return;
        }
        this.controllers.set(key, factory(context));
    }

    getHandle<T extends UE.UserWidget = UE.UserWidget>(key: string): UIHandle<T> | undefined {
        const handle = this.handles.get(key) as UIHandle<T> | undefined;
        if (!handle || !UE.UEHperBridgeLibrary.IsValidObject(handle.widget)) {
            if (handle) {
                this.releaseModalMaskOwner(handle);
            }
            this.handles.delete(key);
            this.removeFromStacks(key);
            return undefined;
        }
        return handle;
    }

    getLayerStack<T extends UE.UserWidget = UE.UserWidget>(layer: string): UIHandle<T>[] {
        const keys = this.layerStacks.get(layer) ?? [];
        return keys.map((key) => this.getHandle<T>(key)).filter((handle): handle is UIHandle<T> => handle != null && handle.isOpen);
    }

    getTopInLayer<T extends UE.UserWidget = UE.UserWidget>(layer: string): UIHandle<T> | undefined {
        const stack = this.getLayerStack<T>(layer);
        return stack[stack.length - 1];
    }

    getModalStack<T extends UE.UserWidget = UE.UserWidget>(): UIHandle<T>[] {
        return this.modalStack.map((key) => this.getHandle<T>(key)).filter((handle): handle is UIHandle<T> => handle != null && handle.isOpen && handle.modal);
    }

    isModalActive(): boolean {
        return this.getModalStack().length > 0;
    }

    getModalMaskReferenceCount(maskKey: string): number {
        return this.modalMaskOwners.get(maskKey)?.size ?? 0;
    }

    getModalMaskOwners(maskKey: string): string[] {
        return [...(this.modalMaskOwners.get(maskKey) ?? [])];
    }

    open<T extends UE.UserWidget = UE.UserWidget>(context: FrameworkContext, key: string, options: UIOpenOptions = {}): UIHandle<T> {
        const entry = this.requireEntry(key);
        const cache = options.cache ?? entry.cache ?? true;
        const existing = cache ? this.getHandle<T>(key) : undefined;
        const handle = existing ?? this.createHandle<T>(context, key, entry, options);

        return this.showHandle(context, key, handle, entry, options, cache);
    }

    async openAsync<T extends UE.UserWidget = UE.UserWidget>(context: FrameworkContext, key: string, options: UIOpenOptions = {}): Promise<UIHandle<T>> {
        const entry = this.requireEntry(key);
        options.cancellationToken?.throwIfCancellationRequested();
        const cache = options.cache ?? entry.cache ?? true;
        const existing = cache ? this.getHandle<T>(key) : undefined;
        const widgetClass = existing ? undefined : await this.loadWidgetClassAsync(key, entry, options);
        options.cancellationToken?.throwIfCancellationRequested();
        const handle = existing ?? this.createHandle<T>(context, key, entry, options, widgetClass);

        return this.showHandleAsync(context, key, handle, entry, options, cache);
    }

    private showHandle<T extends UE.UserWidget>(context: FrameworkContext, key: string, handle: UIHandle<T>, entry: UIManifestEntry, options: UIOpenOptions, cache: boolean): UIHandle<T> {
        this.ensureController(context, key, entry);
        this.applyOpenPolicy(key, handle, entry, options);
        this.openModalMask(context, key, handle, entry, options);

        this.mountWidget(context, handle, entry, options);

        handle.isOpen = true;
        handle.cache = cache;
        handle.openedAt = ++this.openSequence;
        handle.modal = options.modal ?? entry.modal ?? handle.modal;
        handle.modalMask = options.modalMask ?? entry.modalMask ?? handle.modalMask;
        this.activateHandle(handle);
        this.notifyWidget(handle.widget, 'OnShow');
        this.applyInputMode(key, handle.widget, entry, options);
        this.notifyWidget(handle.widget, 'OnAfterShow');

        this.handles.set(key, handle);

        return handle;
    }

    private async showHandleAsync<T extends UE.UserWidget>(context: FrameworkContext, key: string, handle: UIHandle<T>, entry: UIManifestEntry, options: UIOpenOptions, cache: boolean): Promise<UIHandle<T>> {
        this.ensureController(context, key, entry);
        this.applyOpenPolicy(key, handle, entry, options);
        this.openModalMask(context, key, handle, entry, options);

        this.mountWidget(context, handle, entry, options);

        handle.isOpen = true;
        handle.cache = cache;
        handle.openedAt = ++this.openSequence;
        handle.modal = options.modal ?? entry.modal ?? handle.modal;
        handle.modalMask = options.modalMask ?? entry.modalMask ?? handle.modalMask;
        this.activateHandle(handle);
        this.notifyWidget(handle.widget, 'OnShow');
        this.applyInputMode(key, handle.widget, entry, options);
        this.handles.set(key, handle);

        try {
            if (options.waitForTransition ?? true) {
                await this.runTransition(handle, 'show', options.cancellationToken);
            }
            options.cancellationToken?.throwIfCancellationRequested();
        } catch (error) {
            this.close(key, { dispose: !cache });
            throw error;
        }

        this.notifyWidget(handle.widget, 'OnAfterShow');
        return handle;
    }

    /**
     * 内部：根据 entry.world 字段决定走 ViewPort 还是 World Host 路径。
     * - 有 world 字段：通过 UEHperUIWorldHostActor 挂到世界空间
     * - 无 world 字段：保持原有 ViewPort 行为
     */
    private mountWidget<T extends UE.UserWidget>(context: FrameworkContext, handle: UIHandle<T>, entry: UIManifestEntry, options: UIOpenOptions): void {
        const placement = options.world ?? entry.world;
        if (placement) {
            // World Host 路径
            const worldCtx = options.worldContextObject ?? (context.world as UE.Object | undefined) ?? null;
            const host = UE.UEHperBridgeLibrary.ResolveUIWorldHost(worldCtx);
            if (!host) {
                this.context_warnHostMissing(context, handle.key);
                // 退化到 ViewPort
                this.mountToViewport(handle, entry, options);
                return;
            }
            this.notifyWidget(handle.widget, 'OnBeforeShow');
            const owningPlayer = options.owningPlayer ?? UE.UEHperBridgeLibrary.GetPrimaryPlayerController(worldCtx) ?? null;
            host.AttachExistingPanel(
                handle.widget,
                handle.key,
                owningPlayer ?? undefined,
                placement.distanceCm ?? 100,
                placement.pitchOffsetDeg ?? 0,
                placement.faceCameraOnSpawn ?? true,
                placement.drawSizeX ?? 800,
                placement.drawSizeY ?? 600,
                placement.scale ?? 1,
                placement.offsetRightCm ?? 0,
                placement.offsetUpCm ?? 0,
            );
            handle.worldHost = host;
            return;
        }
        // ViewPort 路径
        this.mountToViewport(handle, entry, options);
    }

    private mountToViewport<T extends UE.UserWidget>(handle: UIHandle<T>, entry: UIManifestEntry, options: UIOpenOptions): void {
        if (!handle.widget.IsInViewport()) {
            this.notifyWidget(handle.widget, 'OnBeforeShow');
            handle.widget.AddToViewport(options.zOrder ?? entry.zOrder ?? handle.zOrder);
        }
    }

    private unmountWidget<T extends UE.UserWidget>(handle: UIHandle<T>): void {
        if (handle.worldHost && UE.UEHperBridgeLibrary.IsValidObject(handle.worldHost)) {
            UE.UEHperBridgeLibrary.DetachPanelFromHost(handle.worldHost, handle.key);
            handle.worldHost = undefined;
        } else if (handle.widget.IsInViewport()) {
            handle.widget.RemoveFromParent();
        }
    }

    /** 框架级 warn：World Host 解析失败时记录，不抛错（业务侧可能尚未注册 host）。 */
    private context_warnHostMissing(context: FrameworkContext, key: string): void {
        try {
            context.logger?.warn?.(`[ui] ResolveUIWorldHost returned null for key=${key}; falling back to ViewPort`);
        } catch {
            // logger 不可用时静默
        }
    }

    close(key: string, options: UICloseOptions = {}): boolean {
        const handle = this.getHandle(key);
        if (!handle) {
            return false;
        }

        this.notifyWidget(handle.widget, 'OnBeforeHide');
        this.notifyWidget(handle.widget, 'OnHide');
        this.playerInput.release(key);
        this.unmountWidget(handle);
        this.notifyWidget(handle.widget, 'OnAfterHide');
        handle.isOpen = false;
        this.removeFromStacks(key);
        this.closeModalMask(handle, options);
        this.clearModalMaskOwnersForClosedMask(key);

        if (options.dispose || !handle.cache) {
            this.handles.delete(key);
        }

        return true;
    }

    async closeAsync(key: string, options: UICloseOptions = {}): Promise<boolean> {
        const handle = this.getHandle(key);
        if (!handle) {
            return false;
        }

        options.cancellationToken?.throwIfCancellationRequested();
        this.notifyWidget(handle.widget, 'OnBeforeHide');
        this.notifyWidget(handle.widget, 'OnHide');
        if (options.waitForTransition ?? true) {
            await this.runTransition(handle, 'hide', options.cancellationToken);
        }
        options.cancellationToken?.throwIfCancellationRequested();

        this.playerInput.release(key);
        this.unmountWidget(handle);
        this.notifyWidget(handle.widget, 'OnAfterHide');
        handle.isOpen = false;
        this.removeFromStacks(key);
        await this.closeModalMaskAsync(handle, options);
        this.clearModalMaskOwnersForClosedMask(key);

        if (options.dispose || !handle.cache) {
            this.handles.delete(key);
        }

        return true;
    }

    closeLayer(layer: string, options: UICloseOptions = {}): number {
        let closedCount = 0;
        for (const handle of Array.from(this.handles.values())) {
            if (handle.layer === layer && this.close(handle.key, options)) {
                closedCount++;
            }
        }
        return closedCount;
    }

    async closeLayerAsync(layer: string, options: UICloseOptions = {}): Promise<number> {
        let closedCount = 0;
        for (const handle of Array.from(this.handles.values())) {
            if (handle.layer === layer && (await this.closeAsync(handle.key, options))) {
                closedCount++;
            }
        }
        return closedCount;
    }

    closeAll(options: UICloseOptions = {}): void {
        for (const key of Array.from(this.handles.keys())) {
            this.close(key, options);
        }
    }

    async closeAllAsync(options: UICloseOptions = {}): Promise<void> {
        for (const key of Array.from(this.handles.keys())) {
            await this.closeAsync(key, options);
        }
    }

    release(key: string): void {
        this.close(key, { dispose: true });
        this.handles.delete(key);
    }

    releaseAll(): void {
        this.closeAll({ dispose: true });
        this.handles.clear();
        this.layerStacks.clear();
        this.modalStack.length = 0;
        this.modalMaskOwners.clear();
        this.controllers.clear();
        this.controllerFactories.clear();
        this.playerInput.clear();
    }

    private createHandle<T extends UE.UserWidget>(context: FrameworkContext, key: string, entry: UIManifestEntry, options: UIOpenOptions, loadedWidgetClass?: UE.Class): UIHandle<T> {
        const worldContextObject = options.worldContextObject ?? (context.world as UE.Object | undefined);
        const widgetClass = loadedWidgetClass ?? this.loadWidgetClass(key, entry);
        const owningPlayer = options.owningPlayer ?? UE.UEHperBridgeLibrary.GetPrimaryPlayerController(worldContextObject ?? null);
        const bSuccess = $ref(false);
        const errorMessage = $ref('');
        const widget = UE.UEHperBridgeLibrary.CreateWidgetSafe(worldContextObject ?? null, widgetClass, owningPlayer, bSuccess, errorMessage) as T;

        if (!$unref(bSuccess) || !widget) {
            const detail = $unref(errorMessage) || `widgetClass=${entry.widgetClass}`;
            UE.UEHperBridgeLibrary.ReportFrameworkError('UI.CreateFailed', `UI create failed: ${key}`, detail);
            throw new Error(`UI create failed: ${key}. ${detail}`);
        }

        this.notifyWidget(widget, 'OnLoad');
        return {
            key,
            entry,
            widget,
            layer: options.layer ?? entry.layer ?? 'default',
            zOrder: options.zOrder ?? entry.zOrder ?? 0,
            cache: options.cache ?? entry.cache ?? true,
            modal: options.modal ?? entry.modal ?? false,
            modalMask: options.modalMask ?? entry.modalMask,
            openedAt: 0,
            isOpen: false,
            isTransitioning: false,
        };
    }

    private openModalMask(context: FrameworkContext, key: string, handle: UIHandle, entry: UIManifestEntry, options: UIOpenOptions): void {
        const modal = options.modal ?? entry.modal ?? handle.modal;
        const modalMask = options.modalMask ?? entry.modalMask ?? handle.modalMask;
        if (!modal || !modalMask || modalMask === key) {
            return;
        }

        const maskZOrder = (options.zOrder ?? entry.zOrder ?? handle.zOrder) - 1;
        const owners = this.getOrCreateModalMaskOwners(modalMask);
        const shouldOpenMask = owners.size === 0;
        owners.add(key);

        if (!shouldOpenMask) {
            this.reorderModalMask(modalMask, maskZOrder);
            return;
        }

        try {
            this.open(context, modalMask, {
                layer: handle.layer,
                zOrder: maskZOrder,
                cache: true,
                modal: false,
                inputMode: 'uiOnly',
                showMouseCursor: options.showMouseCursor ?? entry.showMouseCursor,
            });
        } catch (error) {
            owners.delete(key);
            if (owners.size === 0) {
                this.modalMaskOwners.delete(modalMask);
            }
            throw error;
        }
    }

    private closeModalMask(handle: UIHandle, options: UICloseOptions): void {
        const modalMask = handle.modalMask;
        if (!handle.modal || !modalMask || modalMask === handle.key) {
            return;
        }

        const closeMask = this.releaseModalMaskOwner(handle);
        if (!closeMask) {
            this.reorderModalMaskToTopOwner(modalMask);
            return;
        }

        this.close(closeMask, options);
    }

    private async closeModalMaskAsync(handle: UIHandle, options: UICloseOptions): Promise<void> {
        const modalMask = handle.modalMask;
        if (!handle.modal || !modalMask || modalMask === handle.key) {
            return;
        }

        const closeMask = this.releaseModalMaskOwner(handle);
        if (!closeMask) {
            this.reorderModalMaskToTopOwner(modalMask);
            return;
        }

        await this.closeAsync(closeMask, { ...options, cancellationToken: undefined });
    }

    private getOrCreateModalMaskOwners(maskKey: string): Set<string> {
        let owners = this.modalMaskOwners.get(maskKey);
        if (!owners) {
            owners = new Set<string>();
            this.modalMaskOwners.set(maskKey, owners);
        }
        return owners;
    }

    private releaseModalMaskOwner(handle: UIHandle): string | undefined {
        const modalMask = handle.modalMask;
        if (!handle.modal || !modalMask || modalMask === handle.key) {
            return undefined;
        }

        const owners = this.modalMaskOwners.get(modalMask);
        if (!owners) {
            return modalMask;
        }

        owners.delete(handle.key);
        if (owners.size > 0) {
            return undefined;
        }

        this.modalMaskOwners.delete(modalMask);
        return modalMask;
    }

    private clearModalMaskOwnersForClosedMask(key: string): void {
        this.modalMaskOwners.delete(key);
    }

    private reorderModalMaskToTopOwner(maskKey: string): void {
        const owner = this.getTopModalMaskOwner(maskKey);
        if (!owner) {
            return;
        }

        this.reorderModalMask(maskKey, owner.zOrder - 1);
    }

    private getTopModalMaskOwner(maskKey: string): UIHandle | undefined {
        const owners = this.modalMaskOwners.get(maskKey);
        if (!owners) {
            return undefined;
        }

        for (let index = this.modalStack.length - 1; index >= 0; index--) {
            const ownerKey = this.modalStack[index];
            if (!owners.has(ownerKey)) {
                continue;
            }

            const owner = this.getHandle(ownerKey);
            if (owner?.isOpen && owner.modal) {
                return owner;
            }
        }

        return undefined;
    }

    private reorderModalMask(maskKey: string, zOrder: number): void {
        const maskHandle = this.getHandle(maskKey);
        if (!maskHandle) {
            return;
        }

        maskHandle.zOrder = zOrder;
        if (!maskHandle.widget.IsInViewport()) {
            return;
        }

        maskHandle.widget.RemoveFromParent();
        maskHandle.widget.AddToViewport(zOrder);
    }

    private applyOpenPolicy(key: string, handle: UIHandle, entry: UIManifestEntry, options: UIOpenOptions): void {
        const closeLayers = options.closeLayers ?? entry.closeLayers ?? [];
        for (const layer of closeLayers) {
            this.closeLayerExcept(layer, key);
        }

        if (options.exclusive ?? entry.exclusive ?? false) {
            this.closeLayerExcept(handle.layer, key);
        }
    }

    private closeLayerExcept(layer: string, exceptKey: string): number {
        let closedCount = 0;
        for (const handle of Array.from(this.handles.values())) {
            if (handle.key !== exceptKey && handle.layer === layer && this.close(handle.key)) {
                closedCount++;
            }
        }
        return closedCount;
    }

    private activateHandle(handle: UIHandle): void {
        this.removeFromArray(this.getOrCreateLayerStack(handle.layer), handle.key);
        this.getOrCreateLayerStack(handle.layer).push(handle.key);

        this.removeFromArray(this.modalStack, handle.key);
        if (handle.modal) {
            this.modalStack.push(handle.key);
        }
    }

    private removeFromStacks(key: string): void {
        for (const stack of this.layerStacks.values()) {
            this.removeFromArray(stack, key);
        }
        this.removeFromArray(this.modalStack, key);
    }

    private getOrCreateLayerStack(layer: string): string[] {
        let stack = this.layerStacks.get(layer);
        if (!stack) {
            stack = [];
            this.layerStacks.set(layer, stack);
        }
        return stack;
    }

    private removeFromArray(items: string[], value: string): void {
        const index = items.indexOf(value);
        if (index >= 0) {
            items.splice(index, 1);
        }
    }

    private loadWidgetClass(key: string, entry: UIManifestEntry): UE.Class {
        if (this.resources.has(entry.widgetClass)) {
            return this.resources.loadClass(entry.widgetClass).asset;
        }

        const bSuccess = $ref(false);
        const errorMessage = $ref('');
        const widgetClass = UE.UEHperBridgeLibrary.LoadClassByPath(entry.widgetClass, bSuccess, errorMessage);
        if ($unref(bSuccess) && widgetClass) {
            return widgetClass;
        }

        const detail = $unref(errorMessage) || `widgetClass=${entry.widgetClass}`;
        UE.UEHperBridgeLibrary.ReportFrameworkError('UI.ClassLoadFailed', `UI class load failed: ${key}`, detail);
        throw new Error(`UI class load failed: ${key}. ${detail}`);
    }

    private async loadWidgetClassAsync(key: string, entry: UIManifestEntry, options: UIOpenOptions): Promise<UE.Class> {
        if (this.resources.has(entry.widgetClass)) {
            return (await this.resources.loadClassAsync(entry.widgetClass, { cancellationToken: options.cancellationToken })).asset;
        }

        return this.loadWidgetClass(key, entry);
    }

    private requireEntry(key: string): UIManifestEntry {
        const entry = this.manifest.get(key);
        if (!entry) {
            throw new Error(`UI not registered: ${key}`);
        }
        return entry;
    }

    private applyInputMode(key: string, widget: UE.UserWidget, entry: UIManifestEntry, options: UIOpenOptions): void {
        const inputMode = options.inputMode ?? entry.inputMode ?? 'none';
        if (inputMode === 'none') {
            return;
        }

        const playerController = options.owningPlayer ?? UE.UEHperBridgeLibrary.GetPrimaryPlayerController(widget);
        if (!playerController) {
            return;
        }

        const showMouseCursor = options.showMouseCursor ?? entry.showMouseCursor;
        if (showMouseCursor != null) {
            (playerController as any).bShowMouseCursor = showMouseCursor;
        }

        this.playerInput.push({
            key,
            widget,
            playerController,
            inputMode,
            showMouseCursor,
        });
    }

    private async runTransition<T extends UE.UserWidget>(handle: UIHandle<T>, phase: UITransitionPhase, cancellationToken?: CancellationToken): Promise<void> {
        cancellationToken?.throwIfCancellationRequested();
        const methodName = phase === 'show' ? 'OnShowTransition' : 'OnHideTransition';
        const receiver = (this.controllers.get(handle.key) ?? handle.widget) as any;
        if (typeof receiver[methodName] !== 'function') {
            return;
        }

        handle.isTransitioning = true;
        handle.transitionPhase = phase;
        let task: UITransitionTask | undefined;
        let unsubscribeCancellation: (() => void) | undefined;
        try {
            const context: UITransitionContext<T> = {
                key: handle.key,
                entry: handle.entry,
                handle,
                widget: handle.widget,
                phase,
                cancellationToken,
            };
            const result = receiver[methodName](context) as UITransitionResult;
            task = this.toTransitionTask(result);
            if (task) {
                unsubscribeCancellation = cancellationToken?.onCancellationRequested(() => task?.cancel?.());
                await task.promise;
            }
            cancellationToken?.throwIfCancellationRequested();
        } finally {
            unsubscribeCancellation?.();
            handle.isTransitioning = false;
            handle.transitionPhase = undefined;
        }
    }

    private toTransitionTask(result: UITransitionResult): UITransitionTask | undefined {
        if (!result) {
            return undefined;
        }

        if (this.isPromiseLike(result)) {
            return { promise: result };
        }

        return result;
    }

    private isPromiseLike(value: unknown): value is Promise<void> {
        return typeof value === 'object' && value != null && typeof (value as { then?: unknown }).then === 'function';
    }

    private notifyWidget(widget: UE.UserWidget, methodName: 'OnLoad' | 'OnBeforeShow' | 'OnShow' | 'OnAfterShow' | 'OnBeforeHide' | 'OnHide' | 'OnAfterHide'): void {
        const receiver = widget as any;
        if (typeof receiver[methodName] === 'function') {
            receiver[methodName]();
        }
    }

    dispose(): void {
        this.releaseAll();
    }
}
