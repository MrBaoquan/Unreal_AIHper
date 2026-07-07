"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UIService = void 0;
const puerts_1 = require("puerts");
const UE = require("ue");
class UIService {
    constructor(resources, playerInput) {
        this.resources = resources;
        this.playerInput = playerInput;
        this.manifest = new Map();
        this.handles = new Map();
        this.layerStacks = new Map();
        this.modalStack = [];
        this.modalMaskOwners = new Map();
        this.controllers = new Map();
        this.controllerFactories = new Map();
        this.openSequence = 0;
    }
    setManifest(manifest) {
        this.manifest.clear();
        for (const key of Object.keys(manifest)) {
            this.register(key, manifest[key]);
        }
    }
    register(key, entry) {
        if (!key) {
            throw new Error('UI key is empty.');
        }
        if (!entry?.widgetClass) {
            throw new Error(`UI widgetClass is empty: ${key}`);
        }
        this.manifest.set(key, { ...entry });
    }
    has(key) {
        return this.manifest.has(key);
    }
    getEntry(key) {
        const entry = this.manifest.get(key);
        return entry ? { ...entry } : undefined;
    }
    registerController(key, controller) {
        if (!key) {
            throw new Error('UI controller key is empty.');
        }
        this.controllers.set(key, controller);
    }
    unregisterController(key) {
        this.controllers.delete(key);
    }
    /**
     * 注册控制器工厂（声明式入口）。manifest entry 的 `controller` 字段填这里的 name，
     * 框架在该 UI 首次 open 时懒实例化对应控制器。比 registerController 更解耦：
     * 业务层只声明"用哪个工厂"，无需在模块 start() 时手动 new 并预先备好依赖。
     */
    registerControllerFactory(name, factory) {
        if (!name) {
            throw new Error('UI controller factory name is empty.');
        }
        this.controllerFactories.set(name, factory);
    }
    unregisterControllerFactory(name) {
        this.controllerFactories.delete(name);
    }
    /**
     * 确保某 UI 的控制器实例已就绪：已有实例则跳过；否则按 entry.controller 查工厂懒实例化。
     * 在 open 路径挂载/过渡之前调用，使 runTransition 能取到控制器。
     */
    ensureController(context, key, entry) {
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
    getHandle(key) {
        const handle = this.handles.get(key);
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
    getLayerStack(layer) {
        const keys = this.layerStacks.get(layer) ?? [];
        return keys.map((key) => this.getHandle(key)).filter((handle) => handle != null && handle.isOpen);
    }
    getTopInLayer(layer) {
        const stack = this.getLayerStack(layer);
        return stack[stack.length - 1];
    }
    getModalStack() {
        return this.modalStack.map((key) => this.getHandle(key)).filter((handle) => handle != null && handle.isOpen && handle.modal);
    }
    isModalActive() {
        return this.getModalStack().length > 0;
    }
    getModalMaskReferenceCount(maskKey) {
        return this.modalMaskOwners.get(maskKey)?.size ?? 0;
    }
    getModalMaskOwners(maskKey) {
        return [...(this.modalMaskOwners.get(maskKey) ?? [])];
    }
    open(context, key, options = {}) {
        const entry = this.requireEntry(key);
        const cache = options.cache ?? entry.cache ?? true;
        const existing = cache ? this.getHandle(key) : undefined;
        const handle = existing ?? this.createHandle(context, key, entry, options);
        return this.showHandle(context, key, handle, entry, options, cache);
    }
    async openAsync(context, key, options = {}) {
        const entry = this.requireEntry(key);
        options.cancellationToken?.throwIfCancellationRequested();
        const cache = options.cache ?? entry.cache ?? true;
        const existing = cache ? this.getHandle(key) : undefined;
        const widgetClass = existing ? undefined : await this.loadWidgetClassAsync(key, entry, options);
        options.cancellationToken?.throwIfCancellationRequested();
        const handle = existing ?? this.createHandle(context, key, entry, options, widgetClass);
        return this.showHandleAsync(context, key, handle, entry, options, cache);
    }
    showHandle(context, key, handle, entry, options, cache) {
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
    async showHandleAsync(context, key, handle, entry, options, cache) {
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
        }
        catch (error) {
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
    mountWidget(context, handle, entry, options) {
        const placement = options.world ?? entry.world;
        if (placement) {
            // World Host 路径
            const worldCtx = options.worldContextObject ?? context.world ?? null;
            const host = UE.UEHperBridgeLibrary.ResolveUIWorldHost(worldCtx);
            if (!host) {
                this.context_warnHostMissing(context, handle.key);
                // 退化到 ViewPort
                this.mountToViewport(handle, entry, options);
                return;
            }
            this.notifyWidget(handle.widget, 'OnBeforeShow');
            const owningPlayer = options.owningPlayer ?? UE.UEHperBridgeLibrary.GetPrimaryPlayerController(worldCtx) ?? null;
            host.AttachExistingPanel(handle.widget, handle.key, owningPlayer ?? undefined, placement.distanceCm ?? 100, placement.pitchOffsetDeg ?? 0, placement.faceCameraOnSpawn ?? true, placement.drawSizeX ?? 800, placement.drawSizeY ?? 600, placement.scale ?? 1, placement.offsetRightCm ?? 0, placement.offsetUpCm ?? 0);
            handle.worldHost = host;
            return;
        }
        // ViewPort 路径
        this.mountToViewport(handle, entry, options);
    }
    mountToViewport(handle, entry, options) {
        if (!handle.widget.IsInViewport()) {
            this.notifyWidget(handle.widget, 'OnBeforeShow');
            handle.widget.AddToViewport(options.zOrder ?? entry.zOrder ?? handle.zOrder);
        }
    }
    unmountWidget(handle) {
        if (handle.worldHost && UE.UEHperBridgeLibrary.IsValidObject(handle.worldHost)) {
            UE.UEHperBridgeLibrary.DetachPanelFromHost(handle.worldHost, handle.key);
            handle.worldHost = undefined;
        }
        else if (handle.widget.IsInViewport()) {
            handle.widget.RemoveFromParent();
        }
    }
    /** 框架级 warn：World Host 解析失败时记录，不抛错（业务侧可能尚未注册 host）。 */
    context_warnHostMissing(context, key) {
        try {
            context.logger?.warn?.(`[ui] ResolveUIWorldHost returned null for key=${key}; falling back to ViewPort`);
        }
        catch {
            // logger 不可用时静默
        }
    }
    close(key, options = {}) {
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
    async closeAsync(key, options = {}) {
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
    closeLayer(layer, options = {}) {
        let closedCount = 0;
        for (const handle of Array.from(this.handles.values())) {
            if (handle.layer === layer && this.close(handle.key, options)) {
                closedCount++;
            }
        }
        return closedCount;
    }
    async closeLayerAsync(layer, options = {}) {
        let closedCount = 0;
        for (const handle of Array.from(this.handles.values())) {
            if (handle.layer === layer && (await this.closeAsync(handle.key, options))) {
                closedCount++;
            }
        }
        return closedCount;
    }
    closeAll(options = {}) {
        for (const key of Array.from(this.handles.keys())) {
            this.close(key, options);
        }
    }
    async closeAllAsync(options = {}) {
        for (const key of Array.from(this.handles.keys())) {
            await this.closeAsync(key, options);
        }
    }
    release(key) {
        this.close(key, { dispose: true });
        this.handles.delete(key);
    }
    releaseAll() {
        this.closeAll({ dispose: true });
        this.handles.clear();
        this.layerStacks.clear();
        this.modalStack.length = 0;
        this.modalMaskOwners.clear();
        this.controllers.clear();
        this.controllerFactories.clear();
        this.playerInput.clear();
    }
    createHandle(context, key, entry, options, loadedWidgetClass) {
        const worldContextObject = options.worldContextObject ?? context.world;
        const widgetClass = loadedWidgetClass ?? this.loadWidgetClass(key, entry);
        const owningPlayer = options.owningPlayer ?? UE.UEHperBridgeLibrary.GetPrimaryPlayerController(worldContextObject ?? null);
        const bSuccess = (0, puerts_1.$ref)(false);
        const errorMessage = (0, puerts_1.$ref)('');
        const widget = UE.UEHperBridgeLibrary.CreateWidgetSafe(worldContextObject ?? null, widgetClass, owningPlayer, bSuccess, errorMessage);
        if (!(0, puerts_1.$unref)(bSuccess) || !widget) {
            const detail = (0, puerts_1.$unref)(errorMessage) || `widgetClass=${entry.widgetClass}`;
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
    openModalMask(context, key, handle, entry, options) {
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
        }
        catch (error) {
            owners.delete(key);
            if (owners.size === 0) {
                this.modalMaskOwners.delete(modalMask);
            }
            throw error;
        }
    }
    closeModalMask(handle, options) {
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
    async closeModalMaskAsync(handle, options) {
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
    getOrCreateModalMaskOwners(maskKey) {
        let owners = this.modalMaskOwners.get(maskKey);
        if (!owners) {
            owners = new Set();
            this.modalMaskOwners.set(maskKey, owners);
        }
        return owners;
    }
    releaseModalMaskOwner(handle) {
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
    clearModalMaskOwnersForClosedMask(key) {
        this.modalMaskOwners.delete(key);
    }
    reorderModalMaskToTopOwner(maskKey) {
        const owner = this.getTopModalMaskOwner(maskKey);
        if (!owner) {
            return;
        }
        this.reorderModalMask(maskKey, owner.zOrder - 1);
    }
    getTopModalMaskOwner(maskKey) {
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
    reorderModalMask(maskKey, zOrder) {
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
    applyOpenPolicy(key, handle, entry, options) {
        const closeLayers = options.closeLayers ?? entry.closeLayers ?? [];
        for (const layer of closeLayers) {
            this.closeLayerExcept(layer, key);
        }
        if (options.exclusive ?? entry.exclusive ?? false) {
            this.closeLayerExcept(handle.layer, key);
        }
    }
    closeLayerExcept(layer, exceptKey) {
        let closedCount = 0;
        for (const handle of Array.from(this.handles.values())) {
            if (handle.key !== exceptKey && handle.layer === layer && this.close(handle.key)) {
                closedCount++;
            }
        }
        return closedCount;
    }
    activateHandle(handle) {
        this.removeFromArray(this.getOrCreateLayerStack(handle.layer), handle.key);
        this.getOrCreateLayerStack(handle.layer).push(handle.key);
        this.removeFromArray(this.modalStack, handle.key);
        if (handle.modal) {
            this.modalStack.push(handle.key);
        }
    }
    removeFromStacks(key) {
        for (const stack of this.layerStacks.values()) {
            this.removeFromArray(stack, key);
        }
        this.removeFromArray(this.modalStack, key);
    }
    getOrCreateLayerStack(layer) {
        let stack = this.layerStacks.get(layer);
        if (!stack) {
            stack = [];
            this.layerStacks.set(layer, stack);
        }
        return stack;
    }
    removeFromArray(items, value) {
        const index = items.indexOf(value);
        if (index >= 0) {
            items.splice(index, 1);
        }
    }
    loadWidgetClass(key, entry) {
        if (this.resources.has(entry.widgetClass)) {
            return this.resources.loadClass(entry.widgetClass).asset;
        }
        const bSuccess = (0, puerts_1.$ref)(false);
        const errorMessage = (0, puerts_1.$ref)('');
        const widgetClass = UE.UEHperBridgeLibrary.LoadClassByPath(entry.widgetClass, bSuccess, errorMessage);
        if ((0, puerts_1.$unref)(bSuccess) && widgetClass) {
            return widgetClass;
        }
        const detail = (0, puerts_1.$unref)(errorMessage) || `widgetClass=${entry.widgetClass}`;
        UE.UEHperBridgeLibrary.ReportFrameworkError('UI.ClassLoadFailed', `UI class load failed: ${key}`, detail);
        throw new Error(`UI class load failed: ${key}. ${detail}`);
    }
    async loadWidgetClassAsync(key, entry, options) {
        if (this.resources.has(entry.widgetClass)) {
            return (await this.resources.loadClassAsync(entry.widgetClass, { cancellationToken: options.cancellationToken })).asset;
        }
        return this.loadWidgetClass(key, entry);
    }
    requireEntry(key) {
        const entry = this.manifest.get(key);
        if (!entry) {
            throw new Error(`UI not registered: ${key}`);
        }
        return entry;
    }
    applyInputMode(key, widget, entry, options) {
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
            playerController.bShowMouseCursor = showMouseCursor;
        }
        this.playerInput.push({
            key,
            widget,
            playerController,
            inputMode,
            showMouseCursor,
        });
    }
    async runTransition(handle, phase, cancellationToken) {
        cancellationToken?.throwIfCancellationRequested();
        const methodName = phase === 'show' ? 'OnShowTransition' : 'OnHideTransition';
        const receiver = (this.controllers.get(handle.key) ?? handle.widget);
        if (typeof receiver[methodName] !== 'function') {
            return;
        }
        handle.isTransitioning = true;
        handle.transitionPhase = phase;
        let task;
        let unsubscribeCancellation;
        try {
            const context = {
                key: handle.key,
                entry: handle.entry,
                handle,
                widget: handle.widget,
                phase,
                cancellationToken,
            };
            const result = receiver[methodName](context);
            task = this.toTransitionTask(result);
            if (task) {
                unsubscribeCancellation = cancellationToken?.onCancellationRequested(() => task?.cancel?.());
                await task.promise;
            }
            cancellationToken?.throwIfCancellationRequested();
        }
        finally {
            unsubscribeCancellation?.();
            handle.isTransitioning = false;
            handle.transitionPhase = undefined;
        }
    }
    toTransitionTask(result) {
        if (!result) {
            return undefined;
        }
        if (this.isPromiseLike(result)) {
            return { promise: result };
        }
        return result;
    }
    isPromiseLike(value) {
        return typeof value === 'object' && value != null && typeof value.then === 'function';
    }
    notifyWidget(widget, methodName) {
        const receiver = widget;
        if (typeof receiver[methodName] === 'function') {
            receiver[methodName]();
        }
    }
    dispose() {
        this.releaseAll();
    }
}
exports.UIService = UIService;
//# sourceMappingURL=UIService.js.map