#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "UEHperRuntimeTypes.h"
#include "UEHperRuntimeBlueprintLibrary.generated.h"

class UUEHperRuntimeSubsystem;

/**
 * Stage 6.18: Blueprint-friendly wrapper around UUEHperRuntimeSubsystem 状态查询接口。
 * 蓝图、UMG/HUD、编辑器面板可以不持有 GameInstance 引用，直接通过 WorldContextObject 拿到当前
 * RuntimeState / RuntimeStateName / LastError。事件订阅仍走 UUEHperRuntimeSubsystem::OnUEHperRuntimeStateChanged。
 * Stage 7.6: 新增 GetUEHperRuntimeSubsystem 以便 BP 直接拿到 subsystem 引用绑定 OnUEHperRuntimeStateChanged，
 * 免去 GetGameInstance -> Cast -> GetSubsystem 的模板节点链。
 */
UCLASS()
class UEHPER_API UUEHperRuntimeBlueprintLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    /**
     * 从 WorldContext 解析当前 RuntimeSubsystem。返回值可直接作为 Assign On UEHper Runtime State Changed
     * 等 BlueprintAssignable 委托节点的 Target，避免 BP 端写 GetGameInstance + Cast + GetSubsystem 模板代码。
     * 不存在 GameInstance 或还未初始化时返回 nullptr。
     */
    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime", meta = (WorldContext = "WorldContextObject", DisplayName = "Get UEHper Runtime Subsystem"))
    static UUEHperRuntimeSubsystem* GetUEHperRuntimeSubsystem(const UObject* WorldContextObject);

    /** 当前 RuntimeState；找不到 subsystem 时返回 Uninitialized。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime", meta = (WorldContext = "WorldContextObject"))
    static EUEHperRuntimeState GetCurrentRuntimeState(const UObject* WorldContextObject);

    /** 当前 RuntimeState 的人类可读名称（与 LexToString(EUEHperRuntimeState) 一致）。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime", meta = (WorldContext = "WorldContextObject"))
    static FString GetCurrentRuntimeStateName(const UObject* WorldContextObject);

    /** 最近一次 RuntimeState=Failed 的错误描述；为空表示 runtime 当前不在 Failed 状态。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime", meta = (WorldContext = "WorldContextObject"))
    static FString GetLastRuntimeError(const UObject* WorldContextObject);

    /** 便于 BP 判定的封装：RuntimeState == Running。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime", meta = (WorldContext = "WorldContextObject"))
    static bool IsRuntimeRunning(const UObject* WorldContextObject);

    /** 便于 BP 判定的封装：RuntimeState == Failed。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime", meta = (WorldContext = "WorldContextObject"))
    static bool IsRuntimeFailed(const UObject* WorldContextObject);
};
