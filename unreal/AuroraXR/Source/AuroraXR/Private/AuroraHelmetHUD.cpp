#include "AuroraHelmetHUD.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Brushes/SlateColorBrush.h"

void UAuroraHelmetHUD::NativeOnInitialized()
{
    Super::NativeOnInitialized();
    WidgetTree->RootWidget=WidgetTree->ConstructWidget<UCanvasPanel>();
    SetVisibility(ESlateVisibility::HitTestInvisible);
    InputHistory.Init(0,24);
}
void UAuroraHelmetHUD::Advance(float Delta,float InputLevel)
{
    Age+=Delta;SampleAge+=Delta;
    if(SampleAge>=.06f){SampleAge=0;InputHistory.RemoveAt(0);InputHistory.Add(bListening?FMath::Clamp(InputLevel*4,0.f,1.f):0.f);}
    InvalidateLayoutAndVolatility();
}
int32 UAuroraHelmetHUD::NativePaint(const FPaintArgs& Args,const FGeometry& G,const FSlateRect& Cull,FSlateWindowElementList& Out,int32 Layer,const FWidgetStyle& Style,bool Enabled) const
{
    // The MR scene has no persistent head-locked interface.
    return Layer;
}
