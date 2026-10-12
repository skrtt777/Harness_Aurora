#include "AuroraTwin.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

namespace AuroraTwin
{
    // The same colours as the Power BI scene (app/powerbiScene.js STATE).
    const FLinearColor Queue=FLinearColor::FromSRGBColor(FColor(0xF6,0xD3,0x65)),Prep=FLinearColor::FromSRGBColor(FColor(0x4B,0xAF,0xD9)),
        Serve=FLinearColor::FromSRGBColor(FColor(0x2F,0x6F,0xDB)),Road=FLinearColor::FromSRGBColor(FColor(0x8E,0x66,0xD9)),
        Late=FLinearColor::FromSRGBColor(FColor(0xD9,0x4B,0x4B)),Free=FLinearColor::FromSRGBColor(FColor(0x27,0xAE,0x60)),
        Busy=FLinearColor::FromSRGBColor(FColor(0x2B,0x3A,0x55)),Floor=FLinearColor(.004f,.012f,.03f,1),Text=FLinearColor(.85f,.92f,1,1);
    FString Str(const TSharedPtr<FJsonObject>& J,const TCHAR* K){FString V;if(J)J->TryGetStringField(K,V);return V;}
    FLinearColor Hex(const FString& H){return FLinearColor::FromSRGBColor(FColor::FromHex(H));}
}

FAuroraTwinLayout FAuroraTwinLayout::Build(const TSharedPtr<FJsonObject>& State,const FString& Wanted)
{
    using namespace AuroraTwin;
    FAuroraTwinLayout L;
    if(!State)return L;
    L.Title=Str(State,TEXT("title"));
    L.bOperation=Str(State,TEXT("kind"))==TEXT("operacao");
    const TSharedPtr<FJsonObject>* Numbers=nullptr;
    if(State->TryGetObjectField(TEXT("numbers"),Numbers))for(const auto& Pair:(*Numbers)->Values)if(L.Numbers.Num()<5)L.Numbers.Add(FString::Printf(TEXT("%s: %s"),*FString(Pair.Key),*Pair.Value->AsString()));
    const TArray<TSharedPtr<FJsonValue>>* Notes=nullptr;
    if(State->TryGetArrayField(TEXT("notes"),Notes))for(const auto& N:*Notes)if(L.Notes.Num()<3)L.Notes.Add(Str(N->AsObject(),TEXT("when"))+TEXT(" ")+Str(N->AsObject(),TEXT("text")));
    const TSharedPtr<FJsonObject>* Highlight=nullptr;TSet<FString> Lit;
    if(State->TryGetObjectField(TEXT("highlight"),Highlight)){L.Note=Str(*Highlight,TEXT("note"));const TArray<TSharedPtr<FJsonValue>>* V=nullptr;if((*Highlight)->TryGetArrayField(TEXT("values"),V))for(const auto& X:*V)Lit.Add(X->AsString());}
    const TArray<TSharedPtr<FJsonValue>>* Units=nullptr;
    if(!L.bOperation||!State->TryGetArrayField(TEXT("units"),Units)||Units->IsEmpty())return L;
    for(const auto& U:*Units)L.Units.Add(Str(U->AsObject(),TEXT("name")));
    TSharedPtr<FJsonObject> Unit=(*Units)[0]->AsObject();
    for(const auto& U:*Units)if(Str(U->AsObject(),TEXT("name"))==Wanted)Unit=U->AsObject();
    L.Unit=Str(Unit,TEXT("name"));
    const FString Glyph=Str(State,TEXT("glyph"));
    const bool Vehicles=Glyph==TEXT("veiculo"),People=Glyph==TEXT("pessoa");
    // Each one by name (its stage, colour, delay), for the unit shown.
    TMap<FString,TSharedPtr<FJsonObject>> ByName;
    const TArray<TSharedPtr<FJsonValue>>* Entities=nullptr;
    if(State->TryGetArrayField(TEXT("entities"),Entities))for(const auto& E:*Entities){auto O=E->AsObject();if(Str(O,TEXT("unit"))==L.Unit)ByName.Add(Str(O,TEXT("name")),O);}
    TMap<FString,FString> StageOf;const TArray<TSharedPtr<FJsonValue>>* Stages=nullptr;
    if(State->TryGetArrayField(TEXT("stages"),Stages))for(const auto& S:*Stages)StageOf.Add(Str(S->AsObject(),TEXT("label")),Str(S->AsObject(),TEXT("key")));
    TMap<FString,FLinearColor> Palette;const TSharedPtr<FJsonObject>* ColorBy=nullptr;
    if(State->TryGetObjectField(TEXT("colorBy"),ColorBy)){const TArray<TSharedPtr<FJsonValue>>* V=nullptr;if((*ColorBy)->TryGetArrayField(TEXT("values"),V))for(const auto& P:*V){const auto& Pair=P->AsArray();if(Pair.Num()==2)Palette.Add(Pair[0]->AsString().ToLower(),Hex(Pair[1]->AsString()));}}
    auto ColourOf=[&](const FString& Name)->FLinearColor{
        const auto* Found=ByName.Find(Name);if(!Found)return Serve;const auto& O=*Found;
        if(const FLinearColor* C=Palette.Find(Str(O,TEXT("color")).ToLower()))return *C;
        bool Delayed=false;O->TryGetBoolField(TEXT("late"),Delayed);if(Delayed)return Late;
        const FString Key=StageOf.FindRef(Str(O,TEXT("status")));
        return Key==TEXT("fila")?Queue:Key==TEXT("separacao")?Prep:Key==TEXT("transito")?Road:Serve;
    };
    const auto Kind=Vehicles?FAuroraTwinItem::EKind::Vehicle:People?FAuroraTwinItem::EKind::Person:FAuroraTwinItem::EKind::Load;
    auto Add=[&](const FString& Name,const FVector& At){FAuroraTwinItem I;I.Kind=Kind;I.Position=At;I.Color=ColourOf(Name);I.Label=Name;I.bHighlight=Lit.Contains(Name);
        I.Size=Vehicles?FVector(5.f,2.f,2.2f):People?FVector(1.4f,1.4f,3.2f):FVector(2.2f);L.Items.Add(I);++L.Drawn;};
    // The places in a row at the back; who is served in front of each; its own line toward the viewer.
    const TArray<TSharedPtr<FJsonValue>>* Places=nullptr;Unit->TryGetArrayField(TEXT("places"),Places);
    const int32 N=Places?Places->Num():0;const float Step=Vehicles?7.f:4.5f,Width=FMath::Max(30.f,N*Step);
    const float Y0=-Width/2+Step/2;
    FAuroraTwinItem Ground;Ground.Kind=FAuroraTwinItem::EKind::Floor;Ground.Position=FVector(4,0,-.5f);Ground.Size=FVector(46,Width+20,1);Ground.Color=AuroraTwin::Floor;L.Items.Add(Ground);
    for(int32 P=0;P<N;++P){
        auto Place=(*Places)[P]->AsObject();const float Y=Y0+P*Step;
        const TArray<TSharedPtr<FJsonValue>>* Serving=nullptr;const TArray<TSharedPtr<FJsonValue>>* Waiting=nullptr;
        Place->TryGetArrayField(TEXT("serving"),Serving);Place->TryGetArrayField(TEXT("waiting"),Waiting);
        const bool IsFree=(!Serving||Serving->IsEmpty())&&(!Waiting||Waiting->IsEmpty());
        FAuroraTwinItem Spot;Spot.Kind=FAuroraTwinItem::EKind::Place;Spot.Position=FVector(20,Y,Vehicles?3:1.5f);Spot.Size=FVector(1.2f,Step*.8f,Vehicles?6:3);
        Spot.Color=IsFree?Free:Busy;Spot.Label=Str(Place,TEXT("name"));Spot.bHighlight=Lit.Contains(Spot.Label);L.Items.Add(Spot);
        if(Serving)for(int32 K=0;K<Serving->Num()&&K<3;++K)Add((*Serving)[K]->AsString(),FVector(Vehicles?16-K*6.f:16,Vehicles?Y:Y+(K-(Serving->Num()-1)/2.f)*1.6f,0));
        if(Waiting)for(int32 K=0;K<Waiting->Num()&&K<(Vehicles?2:4);++K)Add((*Waiting)[K]->AsString(),FVector((Vehicles?4:12)-K*(Vehicles?6:2.4f),Y,0));
    }
    // The general line in rows, nearest the viewer; the way out on the left.
    const TArray<TSharedPtr<FJsonValue>>* Line=nullptr;Unit->TryGetArrayField(TEXT("queue"),Line);
    const int32 Cols=Vehicles?5:10;
    if(Line)for(int32 K=0;K<Line->Num()&&K<20;++K)Add((*Line)[K]->AsString(),FVector(-6-(K/Cols)*(Vehicles?6.f:3.f),-Width/2+3+(K%Cols)*(Vehicles?3.f:2.4f),0));
    const TArray<TSharedPtr<FJsonValue>>* Leaving=nullptr;Unit->TryGetArrayField(TEXT("road"),Leaving);
    if(Leaving)for(int32 K=0;K<Leaving->Num()&&K<8;++K)Add((*Leaving)[K]->AsString(),FVector(18-(K/2)*7.f,-Width/2-6-(K%2)*3.f,0));
    const TSharedPtr<FJsonObject>* Counts=nullptr;double Total=0;
    if(Unit->TryGetObjectField(TEXT("counts"),Counts))(*Counts)->TryGetNumberField(TEXT("total"),Total);
    L.Total=FMath::RoundToInt(Total);
    // The unit's name over the places, and the seal.
    FAuroraTwinItem Name;Name.Kind=FAuroraTwinItem::EKind::Text;Name.Position=FVector(22,0,10);Name.Size=FVector(3);Name.Color=Text;Name.Label=L.Unit.ToUpper();L.Items.Add(Name);
    FAuroraTwinItem Seal;Seal.Kind=FAuroraTwinItem::EKind::Text;Seal.Position=FVector(-14,Width/2,1);Seal.Size=FVector(1.6f);
    Seal.Color=L.Drawn==L.Total?Free:Queue;Seal.Label=FString::Printf(TEXT("%s %d de %d desenhados"),L.Drawn==L.Total?TEXT("✓"):TEXT("◐"),L.Drawn,L.Total);L.Items.Add(Seal);
    return L;
}

AAuroraTwinActor::AAuroraTwinActor()
{
    PrimaryActorTick.bCanEverTick=false;
    Root=CreateDefaultSubobject<USceneComponent>(TEXT("Root"));RootComponent=Root;
    static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));if(CubeMesh.Succeeded())Cube=CubeMesh.Object;
    static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderMesh(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));if(CylinderMesh.Succeeded())Cylinder=CylinderMesh.Object;
    static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));if(SphereMesh.Succeeded())Sphere=SphereMesh.Object;
}

void AAuroraTwinActor::AddMesh(UStaticMesh* Mesh,const FVector& At,const FVector& Size,const FLinearColor& Color)
{
    if(!Mesh)return;
    auto* Part=NewObject<UStaticMeshComponent>(this);Part->SetStaticMesh(Mesh);Part->SetupAttachment(Root);Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    // Basic shapes are 100 cm: the size in centimetres, standing on the floor of the miniature.
    Part->SetRelativeLocation(At+FVector(0,0,Size.Z/2));Part->SetRelativeScale3D(Size/100.f);
    if(Glow){auto* M=UMaterialInstanceDynamic::Create(Glow,this);M->SetVectorParameterValue(TEXT("Tint"),Color);Part->SetMaterial(0,M);}
    Part->RegisterComponent();Parts.Add(Part);
}

void AAuroraTwinActor::AddText(const TArray<FString>& Texts,const TArray<FLinearColor>& Colors,const FVector& At,float WidthCm,float HeightCm,bool Row,int32 FontSize)
{
    // 20 pixels per centimetre, the widget scaled down to the miniature; its face turned to the viewer.
    auto* Part=NewObject<UWidgetComponent>(this);Part->SetupAttachment(Root);Part->SetWidgetSpace(EWidgetSpace::World);
    Part->SetWidgetClass(UAuroraTwinText::StaticClass());Part->SetDrawSize(FVector2D(WidthCm*20,HeightCm*20));Part->SetBlendMode(EWidgetBlendMode::Transparent);
    Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);Part->SetRelativeLocation(At);Part->SetRelativeRotation(FRotator(0,180,0));Part->SetRelativeScale3D(FVector(.05f));
    Part->RegisterComponent();Part->InitWidget();
    if(auto* W=Cast<UAuroraTwinText>(Part->GetUserWidgetObject())){W->Texts=Texts;W->Colors=Colors;W->bRow=Row;W->FontSize=FontSize;}
    Parts.Add(Part);
}

int32 UAuroraTwinText::NativePaint(const FPaintArgs& Args,const FGeometry& G,const FSlateRect& Cull,FSlateWindowElementList& Out,int32 Layer,const FWidgetStyle& Style,bool Enabled) const
{
    const FVector2D Size=G.GetLocalSize();
    const auto Font=FCoreStyle::GetDefaultFontStyle("Bold",FontSize);
    const auto Measure=FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
    for(int32 I=0;I<Texts.Num();++I){
        const FVector2D TextSize=Measure->Measure(Texts[I],Font);
        // A row: each name centred over its place; lines: one under the other, centred.
        const FVector2D At=bRow?FVector2D((I+.5f)*Size.X/FMath::Max(1,Texts.Num())-TextSize.X/2,(Size.Y-TextSize.Y)/2):FVector2D((Size.X-TextSize.X)/2,I*TextSize.Y*1.15f);
        const FLinearColor C=Colors.IsValidIndex(I)?Colors[I]:FLinearColor::White;
        FSlateDrawElement::MakeText(Out,Layer,G.ToPaintGeometry(TextSize+FVector2D(4),FSlateLayoutTransform(At+FVector2D(2))),Texts[I],Font,ESlateDrawEffect::None,FLinearColor(0,0,0,.9f));
        FSlateDrawElement::MakeText(Out,Layer+1,G.ToPaintGeometry(TextSize+FVector2D(4),FSlateLayoutTransform(At)),Texts[I],Font,ESlateDrawEffect::None,C);
    }
    return Layer+1;
}

void AAuroraTwinActor::Apply(const FAuroraTwinLayout& Layout)
{
    if(!Glow)Glow=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Aurora/Materials/M_AuroraPresence.M_AuroraPresence"));
    for(auto& Part:Parts)if(Part)Part->DestroyComponent();
    Parts.Reset();
    using EKind=FAuroraTwinItem::EKind;
    TArray<FString> PlaceNames,Lines;TArray<FLinearColor> PlaceColors,LineColors;float RowX=20,RowTop=0,RowMin=FLT_MAX,RowMax=-FLT_MAX;
    for(const auto& I:Layout.Items){
        switch(I.Kind){
        case EKind::Floor:AddMesh(Cube,I.Position,I.Size,I.Color);break;
        case EKind::Place:AddMesh(Cube,I.Position-FVector(0,0,I.Size.Z/2),I.Size,I.Color);PlaceNames.Add(I.Label.Right(2));PlaceColors.Add(I.bHighlight?FLinearColor(.8f,.6f,1,1):AuroraTwin::Text);
            RowX=I.Position.X;RowTop=FMath::Max(RowTop,I.Position.Z+I.Size.Z/2);RowMin=FMath::Min(RowMin,I.Position.Y-I.Size.Y/2);RowMax=FMath::Max(RowMax,I.Position.Y+I.Size.Y/2);break;
        case EKind::Vehicle:AddMesh(Cube,I.Position,FVector(I.Size.X*.72f,I.Size.Y,I.Size.Z),I.Color);
            AddMesh(Cube,I.Position-FVector(I.Size.X*.48f,0,0),FVector(I.Size.X*.24f,I.Size.Y*.95f,I.Size.Z*.8f),FLinearColor(.9f,.93f,.97f,1));break;
        case EKind::Person:AddMesh(Cylinder,I.Position,FVector(I.Size.X,I.Size.Y,I.Size.Z*.7f),I.Color);
            AddMesh(Sphere,I.Position+FVector(0,0,I.Size.Z*.72f),FVector(I.Size.X*.8f),FLinearColor(.79f,.6f,.45f,1));break;
        case EKind::Load:AddMesh(Cube,I.Position,I.Size,I.Color);break;
        case EKind::Text:Lines.Add(I.Label);LineColors.Add(I.Color);break;
        }
        // What the Aurora was asked to show: a violet ring over it.
        if(I.bHighlight)AddMesh(Cylinder,I.Position+FVector(0,0,-.4f),FVector(I.Size.Y+3,I.Size.Y+3,.3f),FLinearColor(.69f,.29f,1,1));
    }
    // The places' numbers in a strip over the row; the unit and the seal on a card above the middle.
    if(PlaceNames.Num())AddText(PlaceNames,PlaceColors,FVector(RowX,(RowMin+RowMax)/2,RowTop+1.6f),RowMax-RowMin,2.4f,true,26);
    if(Lines.Num())AddText(Lines,LineColors,FVector(RowX+2,(RowMin==FLT_MAX?0:(RowMin+RowMax)/2),RowTop+6),40,7,false,40);
}
