#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Dom/JsonObject.h"
#include "Blueprint/UserWidget.h"
#include "AuroraTwin.generated.h"
class UStaticMesh;
class UMaterialInterface;
class UWidgetComponent;

// Text in the miniature drawn like the panel (Slate: readable without light in the passthrough): a row
// of names spread over its width (the places), or a few lines (the unit, the seal).
UCLASS()
class AURORAXR_API UAuroraTwinText : public UUserWidget
{
    GENERATED_BODY()
public:
    TArray<FString> Texts;
    TArray<FLinearColor> Colors;
    bool bRow=false;
    int32 FontSize=28;
    virtual int32 NativePaint(const FPaintArgs& Args,const FGeometry& G,const FSlateRect& Cull,FSlateWindowElementList& Out,int32 Layer,const FWidgetStyle& Style,bool Enabled) const override;
};

// The Power BI the Aurora keeps open, as a miniature in the room: the same state as its scene
// (docs/GEMEO_DIGITAL_CONTRATO.md): one object per entity, where it is; places free in green; the
// colour of the stage, or of the risk/priority when the data has it; the rest written ("N de N").
struct FAuroraTwinItem
{
    enum class EKind : uint8 { Floor, Place, Person, Vehicle, Load, Text };
    EKind Kind=EKind::Load;
    FVector Position=FVector::ZeroVector; // centimetres, local: X away from the viewer, Y to the right
    FVector Size=FVector(2);
    FLinearColor Color=FLinearColor::White;
    FString Label;
    bool bHighlight=false;
    bool bFree=false;
};

struct AURORAXR_API FAuroraTwinLayout
{
    TArray<FAuroraTwinItem> Items;
    TArray<FString> Units, Numbers, Notes;
    FString Title, Unit, Note, Environment;
    int32 Drawn=0, Total=0;
    bool bOperation=false;
    // Pure: the twin's JSON and the unit chosen (empty: the first) -> what to draw and where.
    static FAuroraTwinLayout Build(const TSharedPtr<FJsonObject>& State,const FString& Unit);
};

UCLASS()
class AURORAXR_API AAuroraTwinActor : public AActor
{
    GENERATED_BODY()
public:
    AAuroraTwinActor();
    void Apply(const FAuroraTwinLayout& Layout);
private:
    UPROPERTY() TObjectPtr<USceneComponent> Root;
    UPROPERTY() TArray<TObjectPtr<USceneComponent>> Parts;
    UPROPERTY() TObjectPtr<UStaticMesh> Cube;
    UPROPERTY() TObjectPtr<UStaticMesh> Cylinder;
    UPROPERTY() TObjectPtr<UStaticMesh> Sphere;
    UPROPERTY() TObjectPtr<UMaterialInterface> Glow;
    void AddMesh(UStaticMesh* Mesh,const FVector& At,const FVector& Size,const FLinearColor& Color);
    void AddText(const TArray<FString>& Texts,const TArray<FLinearColor>& Colors,const FVector& At,float WidthCm,float HeightCm,bool Row,int32 FontSize);
};
