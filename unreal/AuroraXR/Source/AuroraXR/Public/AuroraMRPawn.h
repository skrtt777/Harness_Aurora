#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/GameModeBase.h"
#include "AuroraMRPawn.generated.h"
class UCameraComponent;
class UWidgetComponent;
class UWidgetInteractionComponent;
class UAuroraMRPanel;
class UAuroraHarnessClient;
class UAuroraHelmetHUD;
class UStaticMeshComponent;
class UProceduralMeshComponent;

// Centimeter thresholds with hysteresis; release immediately on loss of tracking.
struct FAuroraPinch
{
    bool bDown = false;
    bool bArmed = false;
    bool Update(bool Tracked, float Distance)
    {
        if (!Tracked) { bDown=false; bArmed=false; return false; }
        if (Distance >= 3.5f) bArmed=true;
        bDown = bArmed && (bDown ? Distance < 3.5f : Distance < 2.2f);
        return bDown;
    }
};

// Fires once after a deliberate hold. Tracking loss never rearms or closes UI.
struct FAuroraSummonGesture
{
    float Hold=0, Release=0;
    bool bLatched=false;
    bool Update(bool Tracked, bool OpenPalm, float Delta)
    {
        Delta=FMath::Clamp(Delta,0.f,.05f);
        if (!Tracked) { Hold=0; Release=0; return false; }
        if (!OpenPalm)
        {
            Hold=0; Release+=Delta;
            if (Release>=.25f) bLatched=false;
            return false;
        }
        Release=0;
        if (bLatched) return false;
        Hold+=Delta;
        if (Hold>=.8f) { bLatched=true; return true; }
        return false;
    }
    float Progress() const { return FMath::Clamp(Hold/.8f,0.f,1.f); }
};

UCLASS()
class AURORAXR_API AAuroraMRPawn : public APawn
{
    GENERATED_BODY()
public:
    AAuroraMRPawn();
    virtual void BeginPlay() override;
    virtual void Tick(float Delta) override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    UFUNCTION(BlueprintCallable) void RecenterPanel();
    UFUNCTION(BlueprintCallable) void ReplayPanel();
    UFUNCTION(BlueprintCallable) void ToggleHelmetHUD();
    UFUNCTION(BlueprintCallable) void AdjustHelmetHUD(float X,float Y);
    UFUNCTION(BlueprintCallable) void ResetHelmetHUD();
    UFUNCTION(BlueprintCallable) void ResizeHelmetHUD(float Width,float Height);
    UFUNCTION(BlueprintPure) FVector2D GetHelmetSize() const { return HelmetSize; }
    UFUNCTION(BlueprintPure) FVector2D GetHelmetOffset() const { return HelmetOffset; }
    UPROPERTY(BlueprintReadOnly) TObjectPtr<UAuroraMRPanel> PanelWidget;
protected:
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> Origin;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> Camera;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UWidgetComponent> Panel;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UWidgetComponent> Visor;
    UPROPERTY() TObjectPtr<UAuroraHelmetHUD> HelmetHUD;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UWidgetInteractionComponent> Pointer;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UAuroraHarnessClient> Harness;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Presence;
    UPROPERTY() TArray<TObjectPtr<UProceduralMeshComponent>> Rings;
private:
    FVector2D HelmetOffset=FVector2D::ZeroVector;
    FVector2D HelmetSize=FVector2D(1,1);
    void ApplyHelmetOffset();
    void SaveHelmetOffset();
    FAuroraPinch Right;
    FAuroraSummonGesture Summon;
    float PlacementDelay=0;
    bool bPlaced=false;
    bool bPointerPressed=false, bDesktop=false;
    FVector SmoothDirection=FVector::ForwardVector;
    bool bPositionMode=false;
    float PresenceAge=0;
    bool bFollowAnchor=true;
    bool bPositionPinch=false;
    TArray<float> ActiveFrameTimes;
    double LastFrameTime=0;
};

UCLASS()
class AURORAXR_API AAuroraMRGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AAuroraMRGameMode();
};
