// Fill out your copyright notice in the Description page of Project Settings.


#include "PuertsExtensionMethods.h"

AActor* UPuertsExtensionMethods::SpawnActor(UWorld* World, UClass* Class, const FTransform& Transform, ESpawnActorCollisionHandlingMethod SpawnCollisionHandlingOverride, AActor* Owner, APawn* Instigator)
{
    // Defensive: normalize rotation to prevent IsRotationNormalized() assert
    FTransform SafeTransform = Transform;
    if (!SafeTransform.GetRotation().IsNormalized())
    {
        SafeTransform.NormalizeRotation();
    }

    FActorSpawnParameters SpawnParameters;
    SpawnParameters.SpawnCollisionHandlingOverride = SpawnCollisionHandlingOverride;

    SpawnParameters.Owner = Owner;
    SpawnParameters.Instigator = Instigator;

    return World->SpawnActor<AActor>(Class, SafeTransform, SpawnParameters);
}

UClass* UPuertsExtensionMethods::GetClass(UObject *Object)
{
    return Object->GetClass();
}

UFunction* UPuertsExtensionMethods::FindFunction(UObject *Object, FName InName)
{
    return Object->FindFunction(InName);
}