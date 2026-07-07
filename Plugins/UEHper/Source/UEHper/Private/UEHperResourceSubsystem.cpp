#include "UEHperResourceSubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogUEHperResource, Log, All);

void UUEHperResourceSubsystem::Deinitialize()
{
    for (const TPair<FString, TSharedPtr<FStreamableHandle>>& Pair : ActiveHandles)
    {
        if (Pair.Value.IsValid())
        {
            Pair.Value->CancelHandle();
        }
    }

    ActiveHandles.Empty();
    Requests.Empty();
    Super::Deinitialize();
}

bool UUEHperResourceSubsystem::RequestAsyncLoadObject(const FString& RequestId, const FString& ObjectPath, FString& ErrorMessage)
{
    return RequestAsyncLoad(RequestId, ObjectPath, false, ErrorMessage);
}

bool UUEHperResourceSubsystem::RequestAsyncLoadClass(const FString& RequestId, const FString& ClassPath, FString& ErrorMessage)
{
    return RequestAsyncLoad(RequestId, ClassPath, true, ErrorMessage);
}

bool UUEHperResourceSubsystem::CancelAsyncLoad(const FString& RequestId)
{
    FUEHperAsyncLoadRequest* Request = Requests.Find(RequestId);
    if (!Request)
    {
        return false;
    }

    if (TSharedPtr<FStreamableHandle>* Handle = ActiveHandles.Find(RequestId))
    {
        if (Handle->IsValid())
        {
            (*Handle)->CancelHandle();
        }
        ActiveHandles.Remove(RequestId);
    }

    Request->Status = EUEHperAsyncLoadStatus::Canceled;

    FUEHperAsyncLoadResult Result;
    Result.RequestId = Request->RequestId;
    Result.AssetPath = Request->AssetPath;
    Result.bIsClass = Request->bIsClass;
    Result.ErrorMessage = TEXT("Async load canceled.");
    OnAsyncLoadCompleted.Broadcast(Result);
    return true;
}

EUEHperAsyncLoadStatus UUEHperResourceSubsystem::GetAsyncLoadStatus(const FString& RequestId) const
{
    if (const FUEHperAsyncLoadRequest* Request = Requests.Find(RequestId))
    {
        return Request->Status;
    }

    return EUEHperAsyncLoadStatus::None;
}

void UUEHperResourceSubsystem::ReleaseAsyncLoadHandle(const FString& RequestId)
{
    ActiveHandles.Remove(RequestId);
    Requests.Remove(RequestId);
}

bool UUEHperResourceSubsystem::RequestAsyncLoad(const FString& RequestId, const FString& AssetPath, bool bIsClass, FString& ErrorMessage)
{
    ErrorMessage.Reset();
    if (!ValidateRequest(RequestId, AssetPath, ErrorMessage))
    {
        return false;
    }

    FSoftObjectPath SoftObjectPath(AssetPath);
    if (!SoftObjectPath.IsValid())
    {
        ErrorMessage = FString::Printf(TEXT("Invalid asset path: %s"), *AssetPath);
        return false;
    }

    FUEHperAsyncLoadRequest Request;
    Request.RequestId = RequestId;
    Request.AssetPath = AssetPath;
    Request.bIsClass = bIsClass;
    Request.Status = EUEHperAsyncLoadStatus::Loading;
    Requests.Add(RequestId, Request);

    TSharedPtr<FStreamableHandle> Handle = StreamableManager.RequestAsyncLoad(
        SoftObjectPath,
        FStreamableDelegate::CreateUObject(this, &UUEHperResourceSubsystem::HandleAsyncLoadCompleted, RequestId));

    if (!Handle.IsValid())
    {
        Requests.Remove(RequestId);
        ErrorMessage = FString::Printf(TEXT("Failed to create async load handle: %s"), *AssetPath);
        return false;
    }

    ActiveHandles.Add(RequestId, Handle);
    UE_LOG(LogUEHperResource, Display, TEXT("Async load requested. RequestId=%s Path=%s IsClass=%s"), *RequestId, *AssetPath, bIsClass ? TEXT("true") : TEXT("false"));
    return true;
}

void UUEHperResourceSubsystem::HandleAsyncLoadCompleted(FString RequestId)
{
    FUEHperAsyncLoadRequest* Request = Requests.Find(RequestId);
    if (!Request)
    {
        return;
    }

    FSoftObjectPath SoftObjectPath(Request->AssetPath);
    UObject* LoadedObject = SoftObjectPath.ResolveObject();

    FUEHperAsyncLoadResult Result;
    Result.RequestId = Request->RequestId;
    Result.AssetPath = Request->AssetPath;
    Result.bIsClass = Request->bIsClass;

    if (Request->bIsClass)
    {
        Result.Class = Cast<UClass>(LoadedObject);
        Result.bSuccess = IsValid(Result.Class);
    }
    else
    {
        Result.Object = LoadedObject;
        Result.bSuccess = IsValid(Result.Object);
    }

    if (!Result.bSuccess)
    {
        Result.ErrorMessage = FString::Printf(TEXT("Async load completed but asset was not resolved: %s"), *Request->AssetPath);
    }

    CompleteRequest(Result, Result.bSuccess ? EUEHperAsyncLoadStatus::Completed : EUEHperAsyncLoadStatus::Failed);
}

void UUEHperResourceSubsystem::CompleteRequest(const FUEHperAsyncLoadResult& Result, EUEHperAsyncLoadStatus Status)
{
    if (FUEHperAsyncLoadRequest* Request = Requests.Find(Result.RequestId))
    {
        Request->Status = Status;
    }

    ActiveHandles.Remove(Result.RequestId);
    UE_LOG(LogUEHperResource, Display, TEXT("Async load completed. RequestId=%s Success=%s Path=%s"), *Result.RequestId, Result.bSuccess ? TEXT("true") : TEXT("false"), *Result.AssetPath);
    OnAsyncLoadCompleted.Broadcast(Result);
}

bool UUEHperResourceSubsystem::ValidateRequest(const FString& RequestId, const FString& AssetPath, FString& ErrorMessage) const
{
    if (RequestId.IsEmpty())
    {
        ErrorMessage = TEXT("RequestId is empty.");
        return false;
    }

    if (AssetPath.IsEmpty())
    {
        ErrorMessage = TEXT("AssetPath is empty.");
        return false;
    }

    if (Requests.Contains(RequestId))
    {
        ErrorMessage = FString::Printf(TEXT("Async load request already exists: %s"), *RequestId);
        return false;
    }

    return true;
}