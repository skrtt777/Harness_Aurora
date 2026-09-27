#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "AudioCaptureCore.h"
#include "Dom/JsonObject.h"
#include "AuroraHarnessClient.generated.h"
class UAuroraMRPanel;
class UAudioComponent;
class USoundWaveProcedural;
using FAuroraJson = TSharedPtr<FJsonObject>;

UCLASS()
class AURORAXR_API UAuroraHarnessClient : public UActorComponent
{
    GENERATED_BODY()
public:
    UAuroraHarnessClient();
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    virtual void TickComponent(float Delta,ELevelTick Type,FActorComponentTickFunction* Fn) override;
    void AttachPanel(UAuroraMRPanel* Value);
    void SelectPage(int32 Page);
    void SelectRow(int32 Index);
    void Action(int32 Index);
    void SendText(const FString& Text);
    void ObserveImage(const TArray<uint8>& Bytes);
    void HandleUtterance(const FString& Text);
    bool IsListening() const { return bListening&&!bWakeCapture; }
    bool IsBusy() const { return bTeacherUpdating||!OperationId.IsEmpty(); }
    bool IsSpeaking() const;
    bool IsConnected() const { return bBridgeConnected; }
    bool HasConnectionResult() const { return bConnectionChecked; }
    float GetInputLevel() const { return InputLevel; }
    int32 GetMemoryReferenceCount() const { return UsedMemoryIds.Num(); }
    FString GetContextLabel() const { return ProjectId.IsEmpty()?TEXT("Conversa geral"):(ProjectName.IsEmpty()?TEXT("Projeto em uso"):ProjectName); }
    void SetVoiceOrigin(const FVector& Position);
    TFunction<void()> OnPosition;
    TFunction<void()> OnObserve;
    TFunction<void()> OnAnchor;
    TFunction<void()> OnSummon;
private:
    using FReplyJson=TFunction<void(bool,FAuroraJson)>;
    void Request(const FString& Path,const FString& Method,FAuroraJson Body,FReplyJson Reply);
    void Submit(const FString& Path,FAuroraJson Body,const FString& Kind);
    void Poll();
    void Complete(const FString& Kind,FAuroraJson Result);
    void SetStatus(const FString& Value);
    void Show(const FString& Text);
    void RefreshRows(const TArray<TSharedPtr<FJsonValue>>& Values,const FString& Field);
    void StartListening(bool WakeOnly=false);
    void StopListening(bool SubmitAudio);
    void Speak(const FString& Text);
    void SaveSession();
    void UseRoute(bool Pc);
    void Probe(const FString& ProbeEndpoint,const FString& ProbeToken,TFunction<void(bool)> Done);
    void ProbePc(TFunction<void(bool)> Done){Probe(PcEndpoint,PcToken,MoveTemp(Done));}
    void WantLocalRuntime(bool Wanted) const;
    void FallBackToQuest();
    bool LoadRouteConfig(const TCHAR* Name,FString& OutEndpoint,FString& OutToken) const;
    void ShowSources();
    void ShowArtifacts();
    void RefreshProjectName();
    FString ProjectName;
    FString TeacherProvider=TEXT("codex"),LastMessageId;
    float ConfigRetryDelay=0;
    bool bBridgeConnected=false,bConnectionChecked=false,bHeartbeatActive=false;
    float HeartbeatDelay=10,InputLevel=0;
    // Paired PC first (same Harness and GPU as the desktop app); Harness embedded in the Quest as fallback.
    FString PcEndpoint,PcToken,LocalEndpoint,LocalToken;
    bool bUsingPc=false,bRouteProbe=false;
    int32 HeartbeatFailures=0;
    float RouteRetryDelay=30;
    FString Endpoint,Token,ConversationId,ProjectId,OperationId,OperationKind,QueuedText,LastAnswer;
    TArray<FString> RowIds;
    TArray<FString> UsedMemoryIds;
    int32 CurrentPage=0;
    bool bPollActive=false,bListening=false,bSpeechSuppressed=false,bConversationMode=false;
    bool bDiscardTurn=false;
    bool bTeacherUpdating=false;
    bool bShuttingDown=false;
    bool bWakeCapture=false,bWakeRequest=false,bWakeEnabled=true;
    int32 WakeGeneration=0;
    float WakeDelay=2;
    float PollDelay=0,RecordingAge=0,SilenceAge=0;
    float SpeechRemaining=0;
    float ProbeDelay=1;
    bool bHeardSpeech=false;
    TUniquePtr<Audio::FAudioCapture> Capture;
    FCriticalSection AudioLock;
    TArray<int16> Samples;
    int32 RecordingRate=48000;
    float Peak=0;
    UPROPERTY() TObjectPtr<UAuroraMRPanel> Panel;
    UPROPERTY() TObjectPtr<UAudioComponent> Speaker;
    UPROPERTY() TObjectPtr<USoundWaveProcedural> Speech;
};
