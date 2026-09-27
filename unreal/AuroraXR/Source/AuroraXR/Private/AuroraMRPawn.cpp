#include "AuroraMRPawn.h"
#include "AuroraMRPanel.h"
#include "AuroraHarnessClient.h"
#include "AuroraHelmetHUD.h"
#include "Components/StaticMeshComponent.h"
#include "UObject/ConstructorHelpers.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "AuroraPassthrough.h"
#include "Camera/CameraComponent.h"
#include "Components/WidgetComponent.h"
#include "Components/WidgetInteractionComponent.h"
#include "HeadMountedDisplayFunctionLibrary.h"
#include "GameFramework/PlayerController.h"
#include "Blueprint/WidgetLayoutLibrary.h"
#if PLATFORM_ANDROID
#include "Android/AndroidApplication.h"
#include "Android/AndroidJNI.h"
#include "AndroidPermissionFunctionLibrary.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogAuroraGesture,Log,All);

AAuroraMRGameMode::AAuroraMRGameMode() { DefaultPawnClass=AAuroraMRPawn::StaticClass(); }
AAuroraMRPawn::AAuroraMRPawn()
{
    PrimaryActorTick.bCanEverTick=true;
    Harness=CreateDefaultSubobject<UAuroraHarnessClient>(TEXT("HarnessConnection"));
    Origin=CreateDefaultSubobject<USceneComponent>(TEXT("TrackingOrigin")); SetRootComponent(Origin);
    Camera=CreateDefaultSubobject<UCameraComponent>(TEXT("Head")); Camera->SetupAttachment(Origin);
    Camera->SetRelativeLocation(FVector(0,0,160)); Camera->bLockToHmd=true;
    Visor=CreateDefaultSubobject<UWidgetComponent>(TEXT("HelmetVisor"));Visor->SetupAttachment(Camera);
    Visor->SetWidgetClass(UAuroraHelmetHUD::StaticClass());Visor->SetDrawSize(FVector2D(1600,1000));
    Visor->SetWidgetSpace(EWidgetSpace::World);Visor->SetBlendMode(EWidgetBlendMode::Transparent);
    Visor->SetBackgroundColor(FLinearColor::Transparent);Visor->SetTwoSided(false);
    Visor->SetRelativeLocation(FVector(120,0,0));Visor->SetRelativeRotation(FRotator(0,180,0));
    Visor->SetRelativeScale3D(FVector(.1f));Visor->SetPivot(FVector2D(.5f,.5f));
    Visor->SetCollisionEnabled(ECollisionEnabled::NoCollision);Visor->SetCastShadow(false);
    Presence=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AuroraPresence"));Presence->SetupAttachment(Origin);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));if(Sphere.Succeeded())Presence->SetStaticMesh(Sphere.Object);
    Presence->SetCollisionEnabled(ECollisionEnabled::NoCollision);Presence->SetRelativeScale3D(FVector(.055f));Presence->SetCastShadow(false);
    for(int I=0;I<2;++I){auto Ring=CreateDefaultSubobject<UProceduralMeshComponent>(*FString::Printf(TEXT("AuroraRing%d"),I));Ring->SetupAttachment(Origin);Ring->SetCollisionEnabled(ECollisionEnabled::NoCollision);Ring->SetCastShadow(false);Rings.Add(Ring);}
    Panel=CreateDefaultSubobject<UWidgetComponent>(TEXT("HolographicPanel")); Panel->SetupAttachment(Origin);
    Panel->SetWidgetClass(UAuroraMRPanel::StaticClass()); Panel->SetDrawSize(FVector2D(1600,1000));
    Panel->SetWidgetSpace(EWidgetSpace::World); Panel->SetBlendMode(EWidgetBlendMode::Transparent);
    Panel->SetTwoSided(false); Panel->SetBackgroundColor(FLinearColor::Transparent);
    Panel->SetPivot(FVector2D(.5f,.5f)); Panel->SetRelativeScale3D(FVector(.055f));
    Panel->SetCollisionEnabled(ECollisionEnabled::QueryOnly); Panel->SetCollisionResponseToAllChannels(ECR_Ignore);
    Panel->SetCollisionResponseToChannel(ECC_Visibility,ECR_Block);
    Pointer=CreateDefaultSubobject<UWidgetInteractionComponent>(TEXT("RightHandPointer")); Pointer->SetupAttachment(Origin);
    Pointer->InteractionDistance=250; Pointer->VirtualUserIndex=0; Pointer->PointerIndex=1;
    Pointer->TraceChannel=ECC_Visibility; Pointer->bShowDebug=false;
    Pointer->PrimaryComponentTick.AddPrerequisite(this, PrimaryActorTick);
}
void AAuroraMRPawn::BeginPlay()
{
    Super::BeginPlay();
    UMaterialInterface* Glow=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Aurora/Materials/M_AuroraPresence.M_AuroraPresence"));
    if(Glow){auto Material=UMaterialInstanceDynamic::Create(Glow,this);Material->SetVectorParameterValue(TEXT("Tint"),FLinearColor(1,.55f,.16f));Presence->SetMaterial(0,Material);}
    for(int RingIndex=0;RingIndex<Rings.Num();++RingIndex){
        TArray<FVector> Vertices,Normals;TArray<FVector2D> UV;TArray<int32> Triangles;TArray<FLinearColor> Colors;TArray<FProcMeshTangent> Tangents;
        constexpr int Segments=48,Sides=6;const float Radius=9.f+RingIndex*3.f;
        for(int S=0;S<=Segments;++S)for(int T=0;T<Sides;++T){float A=2*PI*.82f*S/Segments,B=2*PI*T/Sides;FVector N(FMath::Cos(A)*FMath::Cos(B),FMath::Sin(A)*FMath::Cos(B),FMath::Sin(B));
            Vertices.Add(FVector(FMath::Cos(A)*Radius,FMath::Sin(A)*Radius,0)+N*.22f);Normals.Add(N);UV.Add(FVector2D(float(S)/Segments,float(T)/Sides));
            if(S<Segments){int X=S*Sides+T,Y=S*Sides+(T+1)%Sides;Triangles.Append({X,Y,X+Sides,Y,Y+Sides,X+Sides});}}
        Rings[RingIndex]->SetRelativeScale3D(FVector(.55f));
        Rings[RingIndex]->CreateMeshSection_LinearColor(0,Vertices,Triangles,Normals,UV,Colors,Tangents,false);
        if(Glow){auto M=UMaterialInstanceDynamic::Create(Glow,this);M->SetVectorParameterValue(TEXT("Tint"),RingIndex?FLinearColor(.9f,.94f,1):FLinearColor(1,.43f,.065f));Rings[RingIndex]->SetMaterial(0,M);}
    }
    bDesktop=!UHeadMountedDisplayFunctionLibrary::IsHeadMountedDisplayEnabled();
    UHeadMountedDisplayFunctionLibrary::SetTrackingOrigin(EHMDTrackingOrigin::Stage);
    auto PC=Cast<APlayerController>(GetController());
    Visor->InitWidget();HelmetHUD=Cast<UAuroraHelmetHUD>(Visor->GetUserWidgetObject());
    if (bDesktop && PC)
    {
        Visor->SetVisibility(false);
        HelmetHUD=CreateWidget<UAuroraHelmetHUD>(PC,UAuroraHelmetHUD::StaticClass());HelmetHUD->AddToViewport(-1);
        Panel->SetVisibility(false); Panel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        PanelWidget=CreateWidget<UAuroraMRPanel>(PC,UAuroraMRPanel::StaticClass());
        PanelWidget->AddToViewport();
        int W,H; PC->GetViewportSize(W,H);
        const float Height=FMath::Min(float(H)*.94f,float(W)/1.6f);
        const float Dpi=UWidgetLayoutLibrary::GetViewportScale(this);
        PanelWidget->SetDesiredSizeInViewport(FVector2D(Height*1.6f,Height)/Dpi);
        PanelWidget->SetAlignmentInViewport(FVector2D(.5f,.5f));
        PanelWidget->SetPositionInViewport(FVector2D(W*.5f,H*.5f),true);
        PC->bShowMouseCursor=true;
        FInputModeGameAndUI Mode; Mode.SetHideCursorDuringCapture(false); PC->SetInputMode(Mode);
    }
    else
    {
        Panel->InitWidget(); PanelWidget=Cast<UAuroraMRPanel>(Panel->GetUserWidgetObject());
        if (PanelWidget) PanelWidget->TogglePanel(); // MR starts with the gesture hint only.
        if (PanelWidget) PanelWidget->bShowClosedHint=false; // The summon hint now lives at the visor rim.
    }
    FAuroraPassthroughModule::Get().SetRequested(!bDesktop);
    if(HelmetHUD){FString Preference;FFileHelper::LoadFileToString(Preference,*(FPaths::ProjectSavedDir()/TEXT("aurora-visor.txt")));HelmetHUD->bMinimal=Preference.TrimStartAndEnd()==TEXT("minimal");}
    if(PanelWidget)PanelWidget->bShowClosedHint=false;
    if(PanelWidget)Harness->AttachPanel(PanelWidget);
    Harness->OnSummon=[this](){ReplayPanel();};
    if(PanelWidget){PanelWidget->OnHUDToggle=[this](){ToggleHelmetHUD();};PanelWidget->bMinimalHUD=HelmetHUD&&HelmetHUD->bMinimal;}
    FString Layout;
    if(FFileHelper::LoadFileToString(Layout,*(FPaths::ProjectSavedDir()/TEXT("aurora-hud-layout.json")))){
        TSharedPtr<FJsonObject> J;if(FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Layout),J)&&J){double X=0,Y=0;J->TryGetNumberField(TEXT("x"),X);J->TryGetNumberField(TEXT("y"),Y);
            HelmetOffset=FVector2D(FMath::IsFinite(X)?FMath::Clamp(X,-10.,10.):0,FMath::IsFinite(Y)?FMath::Clamp(Y,-8.,8.):0);
            double W=1,H=1;J->TryGetNumberField(TEXT("width"),W);J->TryGetNumberField(TEXT("height"),H);
            HelmetSize=FVector2D(FMath::IsFinite(W)?FMath::Clamp(W,.7,1.5):1,FMath::IsFinite(H)?FMath::Clamp(H,.7,1.5):1);}
    }
    ApplyHelmetOffset();
    if(PanelWidget){PanelWidget->OnHUDAdjust=[this](float X,float Y){AdjustHelmetHUD(X,Y);};PanelWidget->OnHUDReset=[this](){ResetHelmetHUD();};}
    if(PanelWidget)PanelWidget->OnHUDResize=[this](float W,float H){ResizeHelmetHUD(W,H);};
    Harness->OnPosition=[this](){bPositionMode=!bPositionMode;bFollowAnchor=false;if(PanelWidget)PanelWidget->ConnectionStatus=bPositionMode?TEXT("Segure a pinça direita para posicionar; solte para fixar"):TEXT("Posição manual");};
    Harness->OnAnchor=[this](){FAuroraPassthroughModule::Get().SavePlacement(Panel->GetComponentTransform().GetRelativeTransform(UHeadMountedDisplayFunctionLibrary::GetTrackingToWorldTransform(this)),UHeadMountedDisplayFunctionLibrary::GetWorldToMetersScale(this));bFollowAnchor=true;};
    Harness->OnObserve=[this](){
#if PLATFORM_ANDROID
        TArray<FString> Permissions={TEXT("android.permission.CAMERA"),TEXT("horizonos.permission.HEADSET_CAMERA")};
        for(const auto& Permission:Permissions)if(!UAndroidPermissionFunctionLibrary::CheckPermission(Permission)){UAndroidPermissionFunctionLibrary::AcquirePermissions(Permissions);PanelWidget->ConnectionStatus=TEXT("Autorize a câmera e toque Ler ambiente novamente");return;}
        if(JNIEnv* Env=FAndroidApplication::GetJavaEnv()){auto Method=FJavaWrapper::FindMethod(Env,FJavaWrapper::GameActivityClassID,"Aurora_CaptureStart","()V",false);FJavaWrapper::CallVoidMethod(Env,FJavaWrapper::GameActivityThis,Method);PanelWidget->ConnectionStatus=TEXT("Capturando imagem • leitura local no PC");}
#else
        PanelWidget->ConnectionStatus=TEXT("A câmera do ambiente está disponível no Quest");
#endif
    };
    RecenterPanel();
}
void AAuroraMRPawn::RecenterPanel()
{
    const FRotator Facing(0,Camera->GetComponentRotation().Yaw,0);
    Panel->SetWorldLocation(Camera->GetComponentLocation()+Facing.RotateVector(FVector(95.f,95*FMath::Tan(FMath::DegreesToRadians(HelmetOffset.X)),-8+95*FMath::Tan(FMath::DegreesToRadians(HelmetOffset.Y)))));
    Panel->SetWorldRotation(FRotator(0,Facing.Yaw+180,0));
    Presence->SetWorldLocation(Panel->GetComponentLocation()+Facing.RotateVector(FVector(-5,-46,15)));
}
void AAuroraMRPawn::ReplayPanel() { bFollowAnchor=false; RecenterPanel(); if (PanelWidget) PanelWidget->ReplayEntrance(); }
void AAuroraMRPawn::ToggleHelmetHUD()
{
    if(!HelmetHUD)return;HelmetHUD->bMinimal=!HelmetHUD->bMinimal;
    if(PanelWidget)PanelWidget->bMinimalHUD=HelmetHUD->bMinimal;
    FFileHelper::SaveStringToFile(HelmetHUD->bMinimal?TEXT("minimal"):TEXT("full"),*(FPaths::ProjectSavedDir()/TEXT("aurora-visor.txt")));
    UE_LOG(LogTemp,Display,TEXT("Aurora visor mode: %s"),HelmetHUD->bMinimal?TEXT("minimal"):TEXT("full"));
}
void AAuroraMRPawn::ApplyHelmetOffset()
{
    Panel->SetRelativeScale3D(FVector(.055f,.055f*HelmetSize.X,.055f*HelmetSize.Y));
    bFollowAnchor=false;RecenterPanel();
    if(bDesktop&&PanelWidget){PanelWidget->SetRenderScale(HelmetSize);PanelWidget->SetRenderTranslation(FVector2D(HelmetOffset.X*8,-HelmetOffset.Y*8));}
    // User X is horizontal and Y is vertical. Unreal camera axes are Y-right/Z-up.
    const double Horizontal=120*FMath::Tan(FMath::DegreesToRadians(HelmetOffset.X));
    const double Up=120*FMath::Tan(FMath::DegreesToRadians(HelmetOffset.Y));
    Visor->SetRelativeLocation(FVector(120,Horizontal,Up));
    Visor->SetDrawSize(FVector2D(FMath::RoundToInt(1600*HelmetSize.X),FMath::RoundToInt(1000*HelmetSize.Y)));
    if(HelmetHUD)HelmetHUD->FrameSize=HelmetSize;
    if(PanelWidget){PanelWidget->HUDOffset=HelmetOffset;PanelWidget->HUDSize=HelmetSize;}
    if(bDesktop&&HelmetHUD){auto PC=Cast<APlayerController>(GetController());if(PC){int W,H;PC->GetViewportSize(W,H);const float Dpi=UWidgetLayoutLibrary::GetViewportScale(this);
        HelmetHUD->SetDesiredSizeInViewport(FVector2D(W*HelmetSize.X,H*HelmetSize.Y)/Dpi);
        HelmetHUD->SetAlignmentInViewport(FVector2D(.5,.5));HelmetHUD->SetPositionInViewport(FVector2D(W*.5,H*.5),true);
        HelmetHUD->SetRenderTranslation(FVector2D(Horizontal/.1*W/1600./Dpi,-Up/.1*H/1000./Dpi));}}
}
void AAuroraMRPawn::SaveHelmetOffset()
{
    const FString Json=FString::Printf(TEXT("{\"x\":%.1f,\"y\":%.1f,\"width\":%.3f,\"height\":%.3f}"),HelmetOffset.X,HelmetOffset.Y,HelmetSize.X,HelmetSize.Y);
    if(!FFileHelper::SaveStringToFile(Json,*(FPaths::ProjectSavedDir()/TEXT("aurora-hud-layout.json")))&&PanelWidget)PanelWidget->ConnectionStatus=TEXT("Ajuste aplicado; não foi possível salvar a posição");
}
void AAuroraMRPawn::AdjustHelmetHUD(float X,float Y)
{
    if(!FMath::IsFinite(X)||!FMath::IsFinite(Y))return;
    HelmetOffset.X=FMath::Clamp(HelmetOffset.X+X,-10.,10.);HelmetOffset.Y=FMath::Clamp(HelmetOffset.Y+Y,-8.,8.);
    ApplyHelmetOffset();SaveHelmetOffset();
}
void AAuroraMRPawn::ResizeHelmetHUD(float Width,float Height)
{
    if(!FMath::IsFinite(Width)||!FMath::IsFinite(Height))return;
    HelmetSize.X=FMath::Clamp(HelmetSize.X+Width,.7,1.5);HelmetSize.Y=FMath::Clamp(HelmetSize.Y+Height,.7,1.5);
    ApplyHelmetOffset();SaveHelmetOffset();
}
void AAuroraMRPawn::ResetHelmetHUD(){HelmetOffset=FVector2D::ZeroVector;HelmetSize=FVector2D(1,1);ApplyHelmetOffset();SaveHelmetOffset();}
void AAuroraMRPawn::Tick(float Delta)
{
    Super::Tick(Delta);
    if (!PanelWidget) return;
    PanelWidget->Advance(Delta);
    if(HelmetHUD){
        HelmetHUD->bConnected=Harness->IsConnected();HelmetHUD->bChecked=Harness->HasConnectionResult();
        HelmetHUD->bListening=Harness->IsListening();HelmetHUD->bSpeaking=Harness->IsSpeaking();HelmetHUD->bBusy=Harness->IsBusy();
        HelmetHUD->Context=Harness->GetContextLabel();HelmetHUD->Status=PanelWidget->ConnectionStatus;HelmetHUD->MemoryCount=Harness->GetMemoryReferenceCount();
        HelmetHUD->bPanelOpen=PanelWidget->IsPanelOpen();HelmetHUD->bPassthrough=FAuroraPassthroughModule::Get().IsReady();
        HelmetHUD->SummonProgress=Summon.Progress();HelmetHUD->Advance(Delta,Harness->GetInputLevel());
    }
    auto UpdateSpatialPresentation=[this](bool RightTracked){
        auto& Spatial=FAuroraPassthroughModule::Get();FTransform LocatedPose;
        PanelWidget->SpatialStatus=Spatial.GetAnchorStatus();
        PanelWidget->SetSpatialPresentation(bPositionMode,bPositionPinch,bFollowAnchor,Spatial.GetPlacement(LocatedPose),RightTracked,bDesktop);
    };
    PresenceAge+=Delta;
    Harness->SetVoiceOrigin(Presence->GetComponentLocation());
#if PLATFORM_ANDROID
    if(JNIEnv* Env=FAndroidApplication::GetJavaEnv()){
        static jmethodID Result=FJavaWrapper::FindMethod(Env,FJavaWrapper::GameActivityClassID,"Aurora_CameraResult","()[B",false);
        jbyteArray Data=(jbyteArray)FJavaWrapper::CallObjectMethod(Env,FJavaWrapper::GameActivityThis,Result);
        if(Data){int32 N=Env->GetArrayLength(Data);TArray<uint8> Bytes;Bytes.SetNumUninitialized(N);Env->GetByteArrayRegion(Data,0,N,(jbyte*)Bytes.GetData());Env->DeleteLocalRef(Data);Harness->ObserveImage(Bytes);}
        static jmethodID ErrorMethod=FJavaWrapper::FindMethod(Env,FJavaWrapper::GameActivityClassID,"Aurora_CameraError","()Ljava/lang/String;",false);
        jstring Error=(jstring)FJavaWrapper::CallObjectMethod(Env,FJavaWrapper::GameActivityThis,ErrorMethod);
        if(Error){const char* Chars=Env->GetStringUTFChars(Error,nullptr);if(Chars&&Chars[0])PanelWidget->ConnectionStatus=UTF8_TO_TCHAR(Chars);if(Chars)Env->ReleaseStringUTFChars(Error,Chars);Env->DeleteLocalRef(Error);}
    }
#endif
    Presence->SetVisibility(false);
    Presence->SetRelativeScale3D(FVector(.055f*(1.f+.08f*FMath::Sin(PresenceAge*(Harness->IsListening()?7.f:2.f)))));
    for(int I=0;I<Rings.Num();++I){Rings[I]->SetVisibility(false);Rings[I]->SetWorldLocation(Presence->GetComponentLocation());Rings[I]->SetWorldRotation(FRotator(35+I*70,PresenceAge*(I?13:-17),I*40));}
    auto PC=Cast<APlayerController>(GetController());
    if (PC && PC->WasInputKeyJustPressed(EKeys::M)) ReplayPanel();
    if (PC && PC->WasInputKeyJustPressed(EKeys::V)) ToggleHelmetHUD();
    if (PC && PC->WasInputKeyJustPressed(EKeys::SpaceBar)) PanelWidget->TogglePanel();
    if (bDesktop) { PanelWidget->SetTracking(false,false); UpdateSpatialPresentation(false); return; }
    FTransform AnchorPose;
    if(bFollowAnchor&&!bPositionMode&&FAuroraPassthroughModule::Get().GetPlacement(AnchorPose)){
        const FTransform WorldPose=AnchorPose*UHeadMountedDisplayFunctionLibrary::GetTrackingToWorldTransform(this);
        Panel->SetWorldLocationAndRotation(WorldPose.GetLocation(),WorldPose.GetRotation());
        Presence->SetWorldLocation(Panel->GetComponentLocation()+Panel->GetRightVector()*46+FVector(0,0,15));
    }
    PlacementDelay+=Delta;
    if (!bPlaced && PlacementDelay>.35f && UHeadMountedDisplayFunctionLibrary::HasValidTrackingPosition()) { RecenterPanel(); bPlaced=true; }
    bool UseFocus=false, HasFocus=true;
    UHeadMountedDisplayFunctionLibrary::GetVRFocusState(UseFocus,HasFocus);
    const double Now=FPlatformTime::Seconds();
    if(LastFrameTime>0&&PlacementDelay>5&&(!UseFocus||HasFocus))ActiveFrameTimes.Add(float((Now-LastFrameTime)*1000));LastFrameTime=Now;
    if(ActiveFrameTimes.Num()>=1024){
        float Total=0;for(float Ms:ActiveFrameTimes)Total+=Ms;ActiveFrameTimes.Sort();
        const float Mean=Total/ActiveFrameTimes.Num(),P95=ActiveFrameTimes[FMath::FloorToInt(ActiveFrameTimes.Num()*.95f)];
        const FString Report=FString::Printf(TEXT("{\"samples\":%d,\"meanGameFrameMs\":%.3f,\"p95GameFrameMs\":%.3f,\"estimatedGameFPS\":%.2f,\"gpuMeasured\":false}"),ActiveFrameTimes.Num(),Mean,P95,1000.f/Mean);
        FFileHelper::SaveStringToFile(Report,*(FPaths::ProjectSavedDir()/TEXT("aurora-performance.json")));UE_LOG(LogTemp,Display,TEXT("Aurora frame sample: mean %.2f ms, p95 %.2f ms"),Mean,P95);ActiveFrameTimes.Reset();
    }
    FXRHandTrackingState L,R;
    UHeadMountedDisplayFunctionLibrary::GetHandTrackingState(this,EXRSpaceType::UnrealWorldSpace,EControllerHand::Left,L);
    UHeadMountedDisplayFunctionLibrary::GetHandTrackingState(this,EXRSpaceType::UnrealWorldSpace,EControllerHand::Right,R);
    auto Valid=[&](const FXRHandTrackingState& S) { return (!UseFocus || HasFocus) && S.bValid && S.TrackingStatus==ETrackingStatus::Tracked && S.HandKeyLocations.Num()>=26; };
    auto Distance=[](const FXRHandTrackingState& S) { return FVector::Distance(S.HandKeyLocations[5],S.HandKeyLocations[10]); }; // OpenXR ThumbTip, IndexTip.
    const bool LV=Valid(L), RV=Valid(R);
    if(HelmetHUD){HelmetHUD->bLeft=LV;HelmetHUD->bRight=RV;}
    const bool RP=Right.Update(RV,RV?Distance(R):1000);
    bool OpenPalm=false;
    if (LV)
    {
        const auto& J=L.HandKeyLocations;
        const FVector Wrist=J[1];
        // Four extended fingers plus a spread thumb. Uses distances, independent
        // of left/right joint rotation conventions. Plane must face the viewer.
        const bool Extended=FVector::Distance(J[10],Wrist)>FVector::Distance(J[7],Wrist)*1.35f
            && FVector::Distance(J[15],Wrist)>FVector::Distance(J[12],Wrist)*1.35f
            && FVector::Distance(J[20],Wrist)>FVector::Distance(J[17],Wrist)*1.3f
            && FVector::Distance(J[25],Wrist)>FVector::Distance(J[22],Wrist)*1.25f;
        const FVector ToHead=(Camera->GetComponentLocation()-J[0]).GetSafeNormal();
        const FVector Normal=FVector::CrossProduct(J[7]-Wrist,J[22]-Wrist).GetSafeNormal();
        const float DistanceToHead=FVector::Distance(J[0],Camera->GetComponentLocation());
        const bool Facing=FMath::Abs(FVector::DotProduct(Normal,ToHead))>.55f;
        const bool InFront=FVector::DotProduct((J[0]-Camera->GetComponentLocation()).GetSafeNormal(),Camera->GetForwardVector())>.35f;
        OpenPalm=Extended && Facing && InFront && DistanceToHead>18 && DistanceToHead<90
            && FVector::Distance(J[5],J[10])>5.f;
    }
    if (Summon.Update(LV,OpenPalm,Delta))
    {
        if (!PanelWidget->IsPanelOpen()) ReplayPanel();
        else {bFollowAnchor=false;RecenterPanel();} // Calling an already-open panel never hides it.
        UE_LOG(LogAuroraGesture,Display,TEXT("Left open-hand summon; panel visible"));
    }
    PanelWidget->SetSummonProgress(Summon.Progress());
    if (!RV) {PanelWidget->ClearPointer();bPositionPinch=false;}
    Pointer->bEnableHitTesting=RV && PanelWidget->IsPanelOpen();
    if (RV)
    {
        const FVector Index=R.HandKeyLocations[7];
        const FVector Shoulder=Camera->GetComponentLocation()+Camera->GetRightVector()*18+FVector(0,0,-18);
        const FVector Direction=(Index-Shoulder).GetSafeNormal();
        SmoothDirection=FMath::VInterpTo(SmoothDirection,Direction,Delta,18).GetSafeNormal();
        Pointer->SetWorldLocationAndRotation(Index,SmoothDirection.Rotation());
        if(bPositionMode&&RP){bPositionPinch=true;Panel->SetWorldLocation(Index+SmoothDirection*65);Panel->SetWorldRotation((Camera->GetComponentLocation()-Panel->GetComponentLocation()).Rotation());Presence->SetWorldLocation(Panel->GetComponentLocation()+Camera->GetRightVector()*-46+FVector(0,0,15));}
        if(bPositionMode&&bPositionPinch&&!RP){bPositionMode=false;bPositionPinch=false;FAuroraPassthroughModule::Get().SavePlacement(Panel->GetComponentTransform().GetRelativeTransform(UHeadMountedDisplayFunctionLibrary::GetTrackingToWorldTransform(this)),UHeadMountedDisplayFunctionLibrary::GetWorldToMetersScale(this));bFollowAnchor=true;PanelWidget->ConnectionStatus=FAuroraPassthroughModule::Get().GetAnchorStatus();}
    }
    const bool WantPress=RP && Pointer->bEnableHitTesting && !bPositionMode;
    if (WantPress && !bPointerPressed) { Pointer->PressPointerKey(EKeys::LeftMouseButton); bPointerPressed=true; }
    if (!WantPress && bPointerPressed) { Pointer->ReleasePointerKey(EKeys::LeftMouseButton); bPointerPressed=false; }
    PanelWidget->SetTracking(LV||RV,FAuroraPassthroughModule::Get().IsReady());
    UpdateSpatialPresentation(RV);
}
void AAuroraMRPawn::EndPlay(const EEndPlayReason::Type Reason)
{
    if (bPointerPressed) Pointer->ReleasePointerKey(EKeys::LeftMouseButton);
    FAuroraPassthroughModule::Get().SetRequested(false);
    if (bDesktop && PanelWidget) PanelWidget->RemoveFromParent();
    if (bDesktop && HelmetHUD) HelmetHUD->RemoveFromParent();
    Super::EndPlay(Reason);
}
