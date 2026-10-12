#include "AuroraMRPawn.h"
#include "AuroraVoiceCommands.h"
#include "AuroraMRPanel.h"
#include "Misc/AutomationTest.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Slate/WidgetRenderer.h"
#include "Engine/TextureRenderTarget2D.h"
#include "ImageUtils.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#endif
#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraRenderTest,"Aurora.UI.RenderPresence",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraRenderTest::RunTest(const FString& Parameters)
{
    auto Panel=NewObject<UAuroraMRPanel>();Panel->Initialize();Panel->Advance(1.f);
    Panel->ContextLabel=TEXT("Prévia visual");Panel->ConnectionStatus=TEXT("Aguardando conexão com o PC");
    Panel->SetSpatialPresentation(false,false,false,false,false,true);
    FWidgetRenderer Renderer(true);
    auto SlateWidget=Panel->TakeWidget();
    auto Target=Renderer.DrawWidget(SlateWidget,FVector2D(1600,1000));
    if(!TestNotNull(TEXT("Render target created"),Target))return false;
    auto Capture=[&](const TCHAR* Name){
        Panel->Advance(1.f);Renderer.DrawWidget(Target,SlateWidget,FVector2D(1600,1000),0.f);
        TArray<FColor> Pixels;FReadSurfaceDataFlags ReadFlags;ReadFlags.SetLinearToGamma(false);
        if(!TestTrue(TEXT("UI pixels readable"),Target->GameThread_GetRenderTargetResource()->ReadPixels(Pixels,ReadFlags)))return;
        TArray64<uint8> Png;FImageUtils::PNGCompressImageArray(1600,1000,Pixels,Png);
        TestTrue(TEXT("UI image saved"),FFileHelper::SaveArrayToFile(Png,*(FPaths::ProjectSavedDir()/Name)));
    };
    Capture(TEXT("PresenceHome.png"));
    Panel->ActivateAt(FVector2D(1050,865));Capture(TEXT("PresenceSettings.png"));
    Panel->SetPage(0);Panel->Rows.Empty();Panel->BodyText=TEXT("Esta é uma prévia de leitura. A resposta aparece aqui, enquanto os controles de voz permanecem disponíveis. O painel lateral mostra o estado da conexão e as ações da conversa.");
    Capture(TEXT("PresenceConversation.png"));
    Panel->SetPage(6);Panel->BenchCount=1;Panel->BenchTitle=TEXT("Referência de teste");Panel->BenchNote=TEXT("Uma bancada criativa com espaço livre para desenhar e luz indireta.");Panel->bBenchDraft=true;Panel->BenchDecision=TEXT("Decisão em revisão: manter a superfície livre e usar iluminação ciano indireta. Esta é uma prévia de teste.");
    Capture(TEXT("BenchQuestPreview.png"));
    Panel->bBenchDraft=false;Panel->bBenchSaved=true;Panel->BenchDecision=TEXT("Manter a superfície livre para desenhar e usar luz ciano indireta.");
    Capture(TEXT("BenchQuestSaved.png"));
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraVoiceControlsTest,"Aurora.MR.VoiceControls",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraVoiceControlsTest::RunTest(const FString& Parameters)
{
    TestTrue(TEXT("Named stop with punctuation"),AuroraVoiceCommand(TEXT("Aurora, pare!"))==EAuroraVoiceCommand::Stop);
    TestTrue(TEXT("Repeat response"),AuroraVoiceCommand(TEXT("Repita a resposta."))==EAuroraVoiceCommand::Repeat);
    TestTrue(TEXT("Help"),AuroraVoiceCommand(TEXT("comandos de voz"))==EAuroraVoiceCommand::Help);
    TestTrue(TEXT("Normal request is not a stop"),AuroraVoiceCommand(TEXT("Explique como parar conversa no aplicativo"))==EAuroraVoiceCommand::None);
    auto Panel=NewObject<UAuroraMRPanel>();Panel->Advance(1.f);
    int Action=-1;Panel->OnAction=[&](int Value){Action=Value;};
    Panel->ActivateAt(FVector2D(500,745));TestEqual(TEXT("Talk on home screen"),Action,0);
    Panel->ActivateAt(FVector2D(1050,865)); // Settings category.
    Panel->ActivateAt(FVector2D(1000,745));TestEqual(TEXT("Stop in settings"),Action,1);
    Panel->ActivateAt(FVector2D(870,865));TestEqual(TEXT("Deliveries shortcut uses real artifact route"),Action,13);
    Panel->ActivateAt(FVector2D(1350,943));TestEqual(TEXT("Contour control uses its own action"),Action,14);
    Panel->ActivateAt(FVector2D(150,760));TestEqual(TEXT("Workbench entry"),Action,15);
    Panel->SetPage(6);Panel->ActivateAt(FVector2D(1300,480));TestEqual(TEXT("Explicit decision confirmation"),Action,18);
    int Chosen=-1;Panel->OnChoose=[&](int Value){Chosen=Value;};
    Panel->ActivateAt(FVector2D(570,865));TestEqual(TEXT("Projects dock"),Chosen,2);
    Panel->ActivateAt(FVector2D(720,865));TestEqual(TEXT("Memories dock"),Chosen,1);
    Panel->TogglePanel();Action=-1;Panel->ActivateAt(FVector2D(500,745));TestEqual(TEXT("Hidden buttons cannot activate"),Action,-1);
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraPinchTest,"Aurora.MR.PinchTrackingAndHysteresis",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraPinchTest::RunTest(const FString& Parameters)
{
    FAuroraPinch P;
    TestFalse(TEXT("Open hand"),P.Update(true,5));
    TestTrue(TEXT("Pinch starts"),P.Update(true,2));
    TestTrue(TEXT("Noise near threshold does not release"),P.Update(true,2.8f));
    TestFalse(TEXT("Tracking loss releases"),P.Update(false,0));
    TestFalse(TEXT("Reacquired hand in hysteresis band does not click"),P.Update(true,2.8f));
    TestFalse(TEXT("Reacquired pinched hand must open first"),P.Update(true,1.8f));
    TestFalse(TEXT("Open hand rearms"),P.Update(true,4));
    TestTrue(TEXT("New pinch"),P.Update(true,1.8f));
    TestFalse(TEXT("Open fingers release"),P.Update(true,4));
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraSummonTest,"Aurora.MR.OpenHandHoldDoesNotToggle",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraSummonTest::RunTest(const FString& Parameters)
{
    FAuroraSummonGesture G;
    int Fired=0;
    for (int I=0;I<10;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Brief gesture does not open"),Fired,0);
    for (int I=0;I<40;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Sustained gesture fires once"),Fired,1);
    for (int I=0;I<10;++I) Fired+=G.Update(false,false,.05f);
    for (int I=0;I<30;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Tracking loss and reacquisition do not retrigger"),Fired,1);
    for (int I=0;I<6;++I) Fired+=G.Update(true,false,.05f);
    for (int I=0;I<30;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Deliberately reset pose can summon again"),Fired,2);
    return true;
}
#endif
