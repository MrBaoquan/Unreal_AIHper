#pragma once

#include "CoreMinimal.h"
#include "UEHperXRAvatarTypes.generated.h"

UENUM(BlueprintType)
enum class EUEHperXRAvatarMotionState : uint8
{
    Idle    UMETA(DisplayName = "Idle"),
    Moving  UMETA(DisplayName = "Moving")
};

UENUM(BlueprintType)
enum class EUEHperXRAvatarHandIntent : uint8
{
    None    UMETA(DisplayName = "None"),
    Open    UMETA(DisplayName = "Open"),
    Point   UMETA(DisplayName = "Point"),
    Grip    UMETA(DisplayName = "Grip"),
    Use     UMETA(DisplayName = "Use"),
    Custom1 UMETA(DisplayName = "Custom1"),
    Custom2 UMETA(DisplayName = "Custom2"),
    Custom3 UMETA(DisplayName = "Custom3"),
    Custom4 UMETA(DisplayName = "Custom4")
};

USTRUCT(BlueprintType)
struct UEHPERXR_API FUEHperXRAvatarTuning
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Network", meta = (ClampMin = "0.0"))
    float MinServerUpdateInterval = 0.033f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Network", meta = (ClampMin = "0.0"))
    float MinPositionDelta = 2.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Network", meta = (ClampMin = "0.0"))
    float MinHeadYawDelta = 1.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Network", meta = (ClampMin = "0.0"))
    float MaxClientMoveDelta = 500.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Network", meta = (ClampMin = "0.0"))
    float ServerSnapDistance = 100.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Network", meta = (ClampMin = "0.0"))
    float SimProxyInterpSpeed = 18.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|BodyTurn", meta = (ClampMin = "0.0", ClampMax = "90.0"))
    float BodyTurnDeadzone = 70.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|BodyTurn", meta = (ClampMin = "0.0"))
    float BodyIdleTurnSpeed = 360.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|BodyTurn", meta = (ClampMin = "0.0"))
    float BodyMoveTurnSpeed = 8.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|BodyTurn", meta = (ClampMin = "0.0"))
    float BodyMoveSpeedThreshold = 20.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Pose", meta = (ClampMin = "0.0", ClampMax = "89.0"))
    float MaxHeadPitch = 70.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Pose", meta = (ClampMin = "0.0", ClampMax = "89.0"))
    float MaxAimPitch = 75.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|Pose", meta = (ClampMin = "0.0", ClampMax = "90.0"))
    float MaxUpperBodyAimYaw = 60.0f;
};
