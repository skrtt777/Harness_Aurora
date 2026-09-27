#pragma once
#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"
#include "IOpenXRExtensionPlugin.h"

// Minimal native OpenXR passthrough underlay. No camera frames are read/stored.
class AURORAPASSTHROUGH_API FAuroraPassthroughModule : public IModuleInterface, public IOpenXRExtensionPlugin
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;
    virtual bool GetOptionalExtensions(TArray<const ANSICHAR*>& Extensions) override;
    virtual bool InsertOpenXRAPILayer(PFN_xrGetInstanceProcAddr& Proc) override;
    virtual void PostCreateInstance(XrInstance Instance) override;
    virtual void PostCreateSession(XrSession Session) override;
    virtual void OnDestroySession(XrSession Session) override;
    virtual void UpdateDeviceLocations(XrSession Session,XrTime DisplayTime,XrSpace TrackingSpace) override;
    virtual void OnEvent(XrSession Session,const XrEventDataBaseHeader* Header) override;
    void SavePlacement(const FTransform& TrackingPose,float Scale);
    bool GetPlacement(FTransform& Pose) const { if(!bAnchorLocated)return false;Pose=AnchorPose;return true; }
    FString GetAnchorStatus() const { return AnchorStatus; }
    virtual void UpdateCompositionLayers_RHIThread(XrSession Session, TArray<XrCompositionLayerBaseHeader*>& Headers) override;
    virtual const void* OnEndProjectionLayer_RHIThread(XrSession Session, int32 Index, const void* Next, XrCompositionLayerFlags& Flags) override;
    void SetRequested(bool Value) { bRequested.Store(Value); }
    bool IsReady() const { return bReady.Load(); }
    static FAuroraPassthroughModule& Get() { return FModuleManager::LoadModuleChecked<FAuroraPassthroughModule>("AuroraPassthrough"); }
private:
    PFN_xrGetInstanceProcAddr GetProc = nullptr;
    PFN_xrCreatePassthroughFB Create = nullptr;
    PFN_xrDestroyPassthroughFB Destroy = nullptr;
    PFN_xrCreatePassthroughLayerFB CreateLayer = nullptr;
    PFN_xrDestroyPassthroughLayerFB DestroyLayer = nullptr;
    PFN_xrPassthroughLayerSetStyleFB SetStyle = nullptr;
    XrPassthroughFB Passthrough = XR_NULL_HANDLE;
    XrPassthroughLayerFB Layer = XR_NULL_HANDLE;
    XrCompositionLayerPassthroughFB Composition{XR_TYPE_COMPOSITION_LAYER_PASSTHROUGH_FB};
    TAtomic<bool> bReady{false};
    TAtomic<bool> bRequested{false};
    PFN_xrCreateSpatialAnchorFB CreateAnchor=nullptr;
    PFN_xrSetSpaceComponentStatusFB SetComponent=nullptr;
    PFN_xrGetSpaceComponentStatusFB GetComponent=nullptr;
    PFN_xrSaveSpaceFB SaveSpace=nullptr;
    PFN_xrQuerySpacesFB QuerySpaces=nullptr;
    PFN_xrRetrieveSpaceQueryResultsFB RetrieveSpaces=nullptr;
    PFN_xrLocateSpace LocateSpace=nullptr;
    PFN_xrDestroySpace DestroySpace=nullptr;
    XrSpace Anchor=XR_NULL_HANDLE;
    XrUuidEXT AnchorUuid{};
    XrAsyncRequestIdFB CreateId=0,SaveId=0,QueryId=0;
    bool bCreateQueued=false,bAnchorLocated=false,bSavePending=false,bSaveIssued=false,bQueryStarted=false;
    float AnchorScale=100;
    FTransform PendingPose,AnchorPose;
    FString AnchorStatus=TEXT("Posicionamento manual");
    void LoadAnchorFunctions(XrInstance Instance);
    void EnableAnchorComponents(bool Store);
};
