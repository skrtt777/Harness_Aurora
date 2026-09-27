#pragma once
#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "AuroraMRPanel.generated.h"

UCLASS()
class AURORAXR_API UAuroraMRPanel : public UUserWidget
{
    GENERATED_BODY()
public:
    TFunction<void(int32)> OnChoose, OnRow, OnAction;
    TFunction<void()> OnDismiss;
    TFunction<void()> OnHUDToggle;
    TFunction<void(float,float)> OnHUDAdjust;
    TFunction<void(float,float)> OnHUDResize;
    TFunction<void()> OnHUDReset;
    FVector2D HUDOffset=FVector2D::ZeroVector;
    FVector2D HUDSize=FVector2D(1,1);
    FString ConnectionStatus=TEXT("Conectando…"), BodyText;
    FString SpatialStatus;
    FString TeacherLabel=TEXT("Codex");
    TArray<FString> Rows;
    int32 BodyPage=0;
    bool bListening=false;
    bool bWakeEnabled=true;
    bool bShowClosedHint=true, bMinimalHUD=false;
    void SetPage(int32 Page) { Selected=Page; bMenuOpen=false; }
    void Advance(float Delta);
    void TogglePanel();
    void SetSummonProgress(float Value) { SummonProgress=Value; }
    void ClearPointer() { Hover=FVector2D(-100,-100); }
    void SetPointerPosition(FVector2D Position) { Hover=Position; }
    void SetSpatialPresentation(bool Positioning,bool Dragging,bool Following,bool Located,bool RightTracked,bool Desktop);
    FString GetPlacementLabel() const;
    FString GetInteractionHint() const;
    bool IsControlHovered(float X,float Y,float W,float H) const;
    bool CanShowPointerFocus() const;
    void SetTracking(bool Hands, bool Passthrough) { bHands = Hands; bPassthrough = Passthrough; }
    UFUNCTION(BlueprintCallable) void ActivateAt(FVector2D Position);
    UFUNCTION(BlueprintCallable) void ReplayEntrance();
    UFUNCTION(BlueprintPure) FString GetSelectedOption() const;
    UFUNCTION(BlueprintPure) bool IsMenuOpen() const { return bMenuOpen; }
    bool IsPanelOpen() const { return bOpen; }
protected:
    virtual void NativeOnInitialized() override;
    virtual int32 NativePaint(const FPaintArgs& Args, const FGeometry& Geo, const FSlateRect& Cull, FSlateWindowElementList& Out, int32 Layer, const FWidgetStyle& Style, bool Enabled) const override;
    virtual FReply NativeOnMouseButtonDown(const FGeometry& Geo, const FPointerEvent& Event) override;
    virtual FReply NativeOnMouseMove(const FGeometry& Geo, const FPointerEvent& Event) override;
    virtual void NativeOnMouseLeave(const FPointerEvent& Event) override;
private:
    float Age = 0, Reveal = 0, MenuReveal = 0, SummonProgress=0;
    bool bOpen = true, bMenuOpen = true, bHands = false, bPassthrough = false;
    // Presentation snapshots only: the pawn and spatial module own these states.
    bool bPositioning=false, bDragging=false, bFollowingAnchor=false, bAnchorLocated=false;
    bool bRightTracked=false, bDesktopInput=false;
    bool bHUDSettings=false;
    bool bHUDSizeTab=true;
    int32 Selected = -1;
    FVector2D Hover = FVector2D(-100,-100);
    int32 GetPageCount() const;
    int32 WrappedFontSize=0, BodyLinesPerPage=9;
    float WrappedWidth=0, BodyLineHeight=35;
    FString WrappedBody;
    TArray<FString> BodyLines;
};
