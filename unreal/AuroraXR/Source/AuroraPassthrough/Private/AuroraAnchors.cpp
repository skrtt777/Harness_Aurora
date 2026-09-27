#include "AuroraPassthrough.h"
#include "IOpenXRHMDModule.h"
#include "OpenXRCore.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

namespace {FString AnchorFile(){return FPaths::ProjectSavedDir()/TEXT("aurora-anchor.uuid");}}
void FAuroraPassthroughModule::LoadAnchorFunctions(XrInstance Instance)
{
    if(!GetProc||!IOpenXRHMDModule::Get().IsExtensionEnabled(TEXT("XR_FB_spatial_entity"))||!IOpenXRHMDModule::Get().IsExtensionEnabled(TEXT("XR_FB_spatial_entity_storage"))||!IOpenXRHMDModule::Get().IsExtensionEnabled(TEXT("XR_FB_spatial_entity_query")))return;
#define AURORA_XR_PROC(Name,Field) GetProc(Instance,Name,reinterpret_cast<PFN_xrVoidFunction*>(&Field))
    AURORA_XR_PROC("xrCreateSpatialAnchorFB",CreateAnchor);
    AURORA_XR_PROC("xrSetSpaceComponentStatusFB",SetComponent);
    AURORA_XR_PROC("xrGetSpaceComponentStatusFB",GetComponent);
    AURORA_XR_PROC("xrSaveSpaceFB",SaveSpace);
    AURORA_XR_PROC("xrQuerySpacesFB",QuerySpaces);
    AURORA_XR_PROC("xrRetrieveSpaceQueryResultsFB",RetrieveSpaces);
    AURORA_XR_PROC("xrLocateSpace",LocateSpace);
    AURORA_XR_PROC("xrDestroySpace",DestroySpace);
#undef AURORA_XR_PROC
    AnchorStatus=TEXT("Âncoras disponíveis • posicione para salvar");
}
void FAuroraPassthroughModule::SavePlacement(const FTransform& Pose,float Scale)
{
    if(!CreateAnchor){AnchorStatus=TEXT("Âncoras indisponíveis • posição só nesta sessão");return;}
    if(bCreateQueued||bSavePending){AnchorStatus=TEXT("Aguarde a gravação da posição");return;}
    PendingPose=Pose;AnchorScale=Scale;bCreateQueued=true;bAnchorLocated=false;AnchorStatus=TEXT("Criando âncora espacial…");
}
void FAuroraPassthroughModule::EnableAnchorComponents(bool Store)
{
    if(!Anchor||!GetComponent||!SetComponent)return;
    for(auto Type:{XR_SPACE_COMPONENT_TYPE_LOCATABLE_FB,XR_SPACE_COMPONENT_TYPE_STORABLE_FB}){
        if(Type==XR_SPACE_COMPONENT_TYPE_STORABLE_FB&&!Store)continue;
        XrSpaceComponentStatusFB Status{XR_TYPE_SPACE_COMPONENT_STATUS_FB};
        if(XR_SUCCEEDED(GetComponent(Anchor,Type,&Status))&&!Status.enabled&&!Status.changePending){
            XrSpaceComponentStatusSetInfoFB Info{XR_TYPE_SPACE_COMPONENT_STATUS_SET_INFO_FB};Info.componentType=Type;Info.enabled=XR_TRUE;Info.timeout=0;
            XrAsyncRequestIdFB Id;const auto Result=SetComponent(Anchor,&Info,&Id);
            if(XR_FAILED(Result))AnchorStatus=TEXT("Não foi possível ativar a âncora");
        }
    }
}
void FAuroraPassthroughModule::UpdateDeviceLocations(XrSession Session,XrTime Time,XrSpace TrackingSpace)
{
    if(!CreateAnchor||!LocateSpace||!GetComponent||!SetComponent||!SaveSpace||!QuerySpaces||!RetrieveSpaces||!DestroySpace)return;
    if(!bQueryStarted){
        bQueryStarted=true;TArray<uint8> Uuid;
        if(FPaths::FileExists(AnchorFile())&&FFileHelper::LoadFileToArray(Uuid,*AnchorFile())&&Uuid.Num()==16){
            FMemory::Memcpy(AnchorUuid.data,Uuid.GetData(),16);
            XrSpaceStorageLocationFilterInfoFB Location{XR_TYPE_SPACE_STORAGE_LOCATION_FILTER_INFO_FB};Location.location=XR_SPACE_STORAGE_LOCATION_LOCAL_FB;
            XrSpaceUuidFilterInfoFB Filter{XR_TYPE_SPACE_UUID_FILTER_INFO_FB};Filter.uuidCount=1;Filter.uuids=&AnchorUuid;Filter.next=&Location;
            XrSpaceQueryInfoFB Info{XR_TYPE_SPACE_QUERY_INFO_FB};Info.queryAction=XR_SPACE_QUERY_ACTION_LOAD_FB;Info.maxResultCount=1;Info.timeout=0;Info.filter=reinterpret_cast<XrSpaceFilterInfoBaseHeaderFB*>(&Filter);
            const auto R=QuerySpaces(Session,reinterpret_cast<XrSpaceQueryInfoBaseHeaderFB*>(&Info),&QueryId);
            AnchorStatus=XR_SUCCEEDED(R)?TEXT("Procurando posição salva…"):TEXT("Posição não localizada • reposicione");
        }
    }
    if(bCreateQueued){
        bCreateQueued=false;if(Anchor){DestroySpace(Anchor);Anchor=XR_NULL_HANDLE;}
        XrSpatialAnchorCreateInfoFB Info{XR_TYPE_SPATIAL_ANCHOR_CREATE_INFO_FB};Info.space=TrackingSpace;Info.poseInSpace=ToXrPose(PendingPose,AnchorScale);Info.time=Time;
        const auto R=CreateAnchor(Session,&Info,&CreateId);bSavePending=XR_SUCCEEDED(R);bSaveIssued=false;
        if(XR_FAILED(R))AnchorStatus=TEXT("Criação da âncora falhou • posição manual");
    }
    if(!Anchor)return;
    if(bSavePending&&!bSaveIssued){
        XrSpaceComponentStatusFB Status{XR_TYPE_SPACE_COMPONENT_STATUS_FB};
        if(XR_SUCCEEDED(GetComponent(Anchor,XR_SPACE_COMPONENT_TYPE_STORABLE_FB,&Status))&&Status.enabled){
            XrSpaceSaveInfoFB Info{XR_TYPE_SPACE_SAVE_INFO_FB};Info.space=Anchor;Info.location=XR_SPACE_STORAGE_LOCATION_LOCAL_FB;Info.persistenceMode=XR_SPACE_PERSISTENCE_MODE_INDEFINITE_FB;
            const auto R=SaveSpace(Session,&Info,&SaveId);bSaveIssued=XR_SUCCEEDED(R);if(XR_FAILED(R)){bSavePending=false;AnchorStatus=TEXT("Âncora não salva • tente reposicionar");}
        }
    }
    XrSpaceLocation Location{XR_TYPE_SPACE_LOCATION};const auto R=LocateSpace(Anchor,TrackingSpace,Time,&Location);
    const auto Required=XR_SPACE_LOCATION_ORIENTATION_VALID_BIT|XR_SPACE_LOCATION_POSITION_VALID_BIT;
    const bool PreviouslyLocated=bAnchorLocated;
    bAnchorLocated=XR_SUCCEEDED(R)&&(Location.locationFlags&Required)==Required;
    if(bAnchorLocated&&!PreviouslyLocated){if(!bSavePending)AnchorStatus=TEXT("Posição salva localizada");UE_LOG(LogTemp,Display,TEXT("Aurora spatial anchor located"));}
    if(!bAnchorLocated&&PreviouslyLocated)AnchorStatus=TEXT("Localização perdida • procurando posição salva");
    if(bAnchorLocated)AnchorPose=ToFTransform(Location.pose,AnchorScale);
}
void FAuroraPassthroughModule::OnEvent(XrSession Session,const XrEventDataBaseHeader* Header)
{
    if(Header->type==XR_TYPE_EVENT_DATA_SPATIAL_ANCHOR_CREATE_COMPLETE_FB){
        const auto* E=reinterpret_cast<const XrEventDataSpatialAnchorCreateCompleteFB*>(Header);if(E->requestId!=CreateId)return;
        if(XR_FAILED(E->result)){bSavePending=false;AnchorStatus=TEXT("Criação da âncora recusada");return;}
        Anchor=E->space;AnchorUuid=E->uuid;EnableAnchorComponents(true);
    }
    if(Header->type==XR_TYPE_EVENT_DATA_SPACE_SAVE_COMPLETE_FB){
        const auto* E=reinterpret_cast<const XrEventDataSpaceSaveCompleteFB*>(Header);if(E->requestId!=SaveId)return;bSavePending=false;
        if(XR_SUCCEEDED(E->result)){TArray<uint8> Data;Data.Append(E->uuid.data,16);const bool Saved=FFileHelper::SaveArrayToFile(Data,*AnchorFile());AnchorStatus=Saved?TEXT("Posição espacial salva no Quest"):TEXT("Falha salvando referência local");UE_LOG(LogTemp,Display,TEXT("Aurora spatial anchor save completed: %d"),Saved);}
        else AnchorStatus=TEXT("Não foi possível persistir a posição");
    }
    if(Header->type==XR_TYPE_EVENT_DATA_SPACE_QUERY_RESULTS_AVAILABLE_FB){
        const auto* E=reinterpret_cast<const XrEventDataSpaceQueryResultsAvailableFB*>(Header);if(E->requestId!=QueryId)return;
        XrSpaceQueryResultsFB Results{XR_TYPE_SPACE_QUERY_RESULTS_FB};
        if(XR_FAILED(RetrieveSpaces(Session,QueryId,&Results))||!Results.resultCountOutput)return;
        TArray<XrSpaceQueryResultFB> Items;Items.SetNum(Results.resultCountOutput);Results.resultCapacityInput=Items.Num();Results.results=Items.GetData();
        if(XR_SUCCEEDED(RetrieveSpaces(Session,QueryId,&Results))&&Results.resultCountOutput){
            if(Anchor)DestroySpace(Anchor);Anchor=Items[0].space;AnchorUuid=Items[0].uuid;EnableAnchorComponents(false);AnchorStatus=TEXT("Posição recuperada • aguardando localização");
            for(int I=1;I<Items.Num();++I)DestroySpace(Items[I].space);
        }
    }
    if(Header->type==XR_TYPE_EVENT_DATA_SPACE_QUERY_COMPLETE_FB){
        const auto* E=reinterpret_cast<const XrEventDataSpaceQueryCompleteFB*>(Header);if(E->requestId==QueryId&&!Anchor)AnchorStatus=TEXT("Posição não encontrada • reposicione");
    }
}
