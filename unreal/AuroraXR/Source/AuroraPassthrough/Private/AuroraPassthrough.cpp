#include "AuroraPassthrough.h"
#include "IOpenXRHMDModule.h"

IMPLEMENT_MODULE(FAuroraPassthroughModule, AuroraPassthrough)
DEFINE_LOG_CATEGORY_STATIC(LogAuroraPassthrough, Log, All);

void FAuroraPassthroughModule::StartupModule() { RegisterOpenXRExtensionModularFeature(); }
void FAuroraPassthroughModule::ShutdownModule() { UnregisterOpenXRExtensionModularFeature(); }
bool FAuroraPassthroughModule::GetOptionalExtensions(TArray<const ANSICHAR*>& Extensions)
{
    Extensions.Add(XR_FB_PASSTHROUGH_EXTENSION_NAME);
    Extensions.Add(XR_FB_SPATIAL_ENTITY_EXTENSION_NAME);
    Extensions.Add(XR_FB_SPATIAL_ENTITY_STORAGE_EXTENSION_NAME);
    Extensions.Add(XR_FB_SPATIAL_ENTITY_QUERY_EXTENSION_NAME);
    return true;
}
bool FAuroraPassthroughModule::InsertOpenXRAPILayer(PFN_xrGetInstanceProcAddr& Proc)
{
    GetProc = Proc; // Observe loader; do not replace it.
    return false;
}
void FAuroraPassthroughModule::PostCreateInstance(XrInstance Instance)
{
    LoadAnchorFunctions(Instance);
    if (!GetProc || !IOpenXRHMDModule::Get().IsExtensionEnabled(TEXT("XR_FB_passthrough"))) return;
    GetProc(Instance, "xrCreatePassthroughFB", reinterpret_cast<PFN_xrVoidFunction*>(&Create));
    GetProc(Instance, "xrDestroyPassthroughFB", reinterpret_cast<PFN_xrVoidFunction*>(&Destroy));
    GetProc(Instance, "xrCreatePassthroughLayerFB", reinterpret_cast<PFN_xrVoidFunction*>(&CreateLayer));
    GetProc(Instance, "xrDestroyPassthroughLayerFB", reinterpret_cast<PFN_xrVoidFunction*>(&DestroyLayer));
    GetProc(Instance, "xrPassthroughLayerSetStyleFB", reinterpret_cast<PFN_xrVoidFunction*>(&SetStyle));
}
void FAuroraPassthroughModule::PostCreateSession(XrSession Session)
{
    bReady.Store(false);
    if (!Create || !Destroy || !CreateLayer || !DestroyLayer || !SetStyle) return;
    XrPassthroughCreateInfoFB Info{XR_TYPE_PASSTHROUGH_CREATE_INFO_FB};
    Info.flags = XR_PASSTHROUGH_IS_RUNNING_AT_CREATION_BIT_FB;
    XrResult Result = Create(Session, &Info, &Passthrough);
    if (XR_FAILED(Result)) { UE_LOG(LogAuroraPassthrough, Warning, TEXT("Passthrough unavailable: %d"), Result); return; }
    XrPassthroughLayerCreateInfoFB LayerInfo{XR_TYPE_PASSTHROUGH_LAYER_CREATE_INFO_FB};
    LayerInfo.passthrough = Passthrough;
    LayerInfo.flags = XR_PASSTHROUGH_IS_RUNNING_AT_CREATION_BIT_FB;
    LayerInfo.purpose = XR_PASSTHROUGH_LAYER_PURPOSE_RECONSTRUCTION_FB;
    Result = CreateLayer(Session, &LayerInfo, &Layer);
    if (XR_FAILED(Result)) { Destroy(Passthrough); Passthrough = XR_NULL_HANDLE; UE_LOG(LogAuroraPassthrough, Warning, TEXT("Passthrough layer failed: %d"), Result); return; }
    XrPassthroughStyleFB Style{XR_TYPE_PASSTHROUGH_STYLE_FB};
    Style.textureOpacityFactor = 1.0f;
    Style.edgeColor = {0,0,0,0};
    SetStyle(Layer, &Style);
    Composition.space = XR_NULL_HANDLE;
    Composition.layerHandle = Layer;
    bReady.Store(true);
    UE_LOG(LogAuroraPassthrough, Display, TEXT("Passthrough underlay created"));
}
void FAuroraPassthroughModule::OnDestroySession(XrSession Session)
{
    if(Anchor&&DestroySpace)DestroySpace(Anchor);Anchor=XR_NULL_HANDLE;bAnchorLocated=false;bQueryStarted=false;bCreateQueued=false;bSavePending=false;bSaveIssued=false;
    bReady.Store(false);
    if (Layer && DestroyLayer) DestroyLayer(Layer);
    if (Passthrough && Destroy) Destroy(Passthrough);
    Layer = XR_NULL_HANDLE; Passthrough = XR_NULL_HANDLE;
}
void FAuroraPassthroughModule::UpdateCompositionLayers_RHIThread(XrSession Session, TArray<XrCompositionLayerBaseHeader*>& Headers)
{
    if (bReady.Load() && bRequested.Load()) Headers.Insert(reinterpret_cast<XrCompositionLayerBaseHeader*>(&Composition), 0);
}
const void* FAuroraPassthroughModule::OnEndProjectionLayer_RHIThread(XrSession Session, int32 Index, const void* Next, XrCompositionLayerFlags& Flags)
{
    if (bReady.Load() && bRequested.Load()) Flags |= XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
    return Next;
}
