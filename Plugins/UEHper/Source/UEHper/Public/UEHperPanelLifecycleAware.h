#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "UEHperPanelLifecycleAware.generated.h"

UINTERFACE(BlueprintType, MinimalAPI, meta = (DisplayName = "UEHper Panel Lifecycle Aware"))
class UUEHperPanelLifecycleAware : public UInterface
{
    GENERATED_BODY()
};

/**
 * 由 World Space UI widget（UUserWidget 子类）选择性实现，用于在被 AUEHperUIWorldHostActor 挂载/卸下时
 * 接收通知，**无需依赖 host BP 的 EventGraph 连线**。
 *
 * 框架不知道 widget 内部做什么（HandGesture Box / 射线代理 / 眼动 reticle），
 * 只是提供一个通用挂钩。Widget 如果实现此接口，host 在 AttachExistingPanel 完成后
 * 会直接 Execute_OnAttachedToHost(Widget, Host, Key)。
 *
 * 业务约定（项目层）：
 *   UGameplayPanelBase 在 OnAttachedToHost_Implementation 内做 widget 树遍历 + Box 绑定。
 *   BP 子类可选地 override 接口方法做额外处理。
 */
class UEHPER_API IUEHperPanelLifecycleAware
{
    GENERATED_BODY()

public:
    /** Widget 被挂载到 host 后由 host 直接调用。Host 即 AUEHperUIWorldHostActor 实例。 */
    UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "UEHper|UI")
    void OnAttachedToHost(AActor* Host, FName PanelKey);

    /** Widget 即将从 host 卸下时由 host 直接调用。 */
    UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "UEHper|UI")
    void OnDetachedFromHost(FName PanelKey);
};
