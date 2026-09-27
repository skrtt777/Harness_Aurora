#pragma once
#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "AuroraHelmetHUD.generated.h"

// Passive binocular visor. Interaction and long-form reading stay in the world panel.
UCLASS()
class AURORAXR_API UAuroraHelmetHUD : public UUserWidget
{
    GENERATED_BODY()
public:
    void Advance(float Delta, float InputLevel);
    FString Context, Status;
    bool bConnected=false, bChecked=false, bListening=false, bSpeaking=false, bBusy=false;
    bool bLeft=false, bRight=false, bPassthrough=false, bPanelOpen=false, bMinimal=false;
    int32 MemoryCount=0;
    float SummonProgress=0;
    FVector2D FrameSize=FVector2D(1,1);
protected:
    virtual void NativeOnInitialized() override;
    virtual int32 NativePaint(const FPaintArgs& Args, const FGeometry& Geo, const FSlateRect& Cull, FSlateWindowElementList& Out, int32 Layer, const FWidgetStyle& Style, bool Enabled) const override;
private:
    float Age=0, SampleAge=0;
    TArray<float> InputHistory;
};
