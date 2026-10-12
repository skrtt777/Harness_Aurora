#include "AuroraMRPanel.h"
#include "Engine/Texture2D.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Brushes/SlateColorBrush.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Framework/Application/SlateApplication.h"
#include "Fonts/FontMeasure.h"
#include "Internationalization/BreakIterator.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#endif
namespace AuroraUI {
const TCHAR* Names[]={TEXT("Conversar"),TEXT("Memórias"),TEXT("Projetos"),TEXT("Ambiente"),TEXT("Ajustes")};
const FLinearColor White(.98,.98,.94,1),Muted(.86,.88,.85,1),Gold(.25f,.78f,1.f,.94f),Selection(.08f,.3f,.42f,.48f),Glass(.015f,.04f,.065f,.24f);
// Measure exactly the font used for painting; compensate when the menu is shrunk.
FSlateFontInfo FontFor(int Size,float Scale,float MenuHeight){return FCoreStyle::GetDefaultFontStyle("Regular",FMath::Max(14,FMath::RoundToInt(FMath::Max(20,Size)*Scale/FMath::Clamp(MenuHeight,.7f,1.f))));}
float TextWidth(const FString& Text,const FSlateFontInfo& Font){return FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(Text,Font).X;}
int32 FittingPrefix(const FString& Text,const FSlateFontInfo& Font,float Width){
 auto It=FBreakIterator::CreateCharacterBoundaryIterator();It->SetString(Text);int32 Fit=0;
 for(int32 End=It->MoveToNext();End!=INDEX_NONE;End=It->MoveToNext()){if(TextWidth(Text.Left(End),Font)>Width)break;Fit=End;}return Fit;
}
FString Ellipsize(const FString& Text,const FSlateFontInfo& Font,float Width){
 if(TextWidth(Text,Font)<=Width)return Text;
 const FString Ellipsis=TEXT("…");if(TextWidth(Ellipsis,Font)>Width)return FString();
 return Text.Left(FittingPrefix(Text,Font,Width-TextWidth(Ellipsis,Font))).TrimEnd()+Ellipsis;
}
void WrapText(const FString& Text,const FSlateFontInfo& Font,float Width,TArray<FString>& Lines){
 Lines.Reset();TArray<FString> Paragraphs;Text.Replace(TEXT("\r\n"),TEXT("\n")).Replace(TEXT("\r"),TEXT("\n")).ParseIntoArray(Paragraphs,TEXT("\n"),false);
 for(const FString& Paragraph:Paragraphs){
  TArray<FString> Words;Paragraph.ParseIntoArrayWS(Words);FString Line;
  for(FString Word:Words){
   const FString Candidate=Line.IsEmpty()?Word:Line+TEXT(" ")+Word;
   if(TextWidth(Candidate,Font)<=Width){Line=Candidate;continue;}
   if(!Line.IsEmpty()){Lines.Add(Line);Line.Empty();}
   while(TextWidth(Word,Font)>Width){
    int32 End=FittingPrefix(Word,Font,Width);
    // Never split a surrogate pair or a combining accent, even in a tiny viewport.
    if(End==0){auto It=FBreakIterator::CreateCharacterBoundaryIterator();It->SetString(Word);End=It->MoveToNext();}
    if(End<=0)break;Lines.Add(Word.Left(End));Word.RightChopInline(End);
   }
   Line=Word;
  }
  if(!Line.IsEmpty()||Words.IsEmpty())Lines.Add(Line);
 }
}
bool Hit(FVector2D P,float X,float Y,float W,float H){return P.X>=X&&P.X<=X+W&&P.Y>=Y&&P.Y<=Y+H;}
bool Rail(FVector2D P,int I){return FVector2D::Distance(P,FVector2D(740,235+I*115))<=45;}
int ActionFor(int Selected,bool Settings,int I){const int Bench[]={19,18,15,16,17,3};if(Selected==6&&!Settings)return Bench[I];const int Twin[]={20,21,22,0,12,3};if(Selected==7&&!Settings)return Twin[I];const int General[]={2,5,12,11,13,3},Projects[]={12,5,8,9,10,11},Environment[]={4,3,0,1,12,11},Options[]={6,7,8,9,4,3};return Settings?Options[I]:Selected==2?Projects[I]:Selected==3?Environment[I]:General[I];}
FString ActionName(int I,bool Listening,bool Wake){switch(I){case 0:return Listening?TEXT("Enviar fala"):TEXT("Falar com Aurora");case 1:return TEXT("Parar conversa");case 2:return TEXT("Guardar resposta");case 3:return TEXT("Posicionar menu");case 4:return TEXT("Ler ambiente");case 5:return TEXT("Nova conversa");case 6:return TEXT("Ouvir a voz");case 7:return Wake?TEXT("Pausar por nome"):TEXT("Chamar por nome");case 8:return TEXT("Professor / Codex");case 9:return TEXT("Professor / Claude");case 10:return TEXT("Pedir revisão ao professor");case 11:return TEXT("Ver referências");case 12:return TEXT("Retomar contexto");case 13:return TEXT("Ver entregas");case 15:return TEXT("Atualizar bancada");case 16:return TEXT("Referência anterior");case 17:return TEXT("Próxima referência");case 18:return TEXT("Confirmar decisão");case 19:return TEXT("Revisar resposta");case 20:return TEXT("Atualizar operação");case 21:return TEXT("Trocar unidade");case 22:return TEXT("Mostrar / ocultar maquete");default:return TEXT("");}}
}
void UAuroraMRPanel::SetSpatialPresentation(bool Positioning,bool Dragging,bool Following,bool Located,bool RightTracked,bool Desktop){
 bPositioning=Positioning;bDragging=Dragging;bFollowingAnchor=Following;bAnchorLocated=Located;bRightTracked=RightTracked;bDesktopInput=Desktop;
 if((Positioning&&!Desktop)||(!RightTracked&&!Desktop))ClearPointer();
}
bool UAuroraMRPanel::CanShowPointerFocus() const{return bOpen&&Reveal>=.94f&&(bDesktopInput||(!bPositioning&&bRightTracked));}
bool UAuroraMRPanel::IsControlHovered(float X,float Y,float W,float H) const{return CanShowPointerFocus()&&AuroraUI::Hit(Hover,X,Y,W,H);}
FString UAuroraMRPanel::GetPlacementLabel() const{
 if(bPositioning)return TEXT("Posicionando menu");
 if(SpatialStatus.Contains(TEXT("indisponíveis")))return TEXT("Âncora indisponível / posição manual");
 // A located old anchor does not fix a menu that was summoned or moved manually.
 if(!bFollowingAnchor)return TEXT("Posição manual / não fixada");
 if(SpatialStatus.Contains(TEXT("não salva"))||SpatialStatus.Contains(TEXT("persistir"))||SpatialStatus.Contains(TEXT("Falha salvando")))return TEXT("Âncora não salva / reposicione");
 if(SpatialStatus.Contains(TEXT("falhou"))||SpatialStatus.Contains(TEXT("recusada"))||SpatialStatus.Contains(TEXT("ativar")))return TEXT("Falha na âncora / reposicione");
 if(bAnchorLocated)return TEXT("Âncora fixada");
 // Loss includes a search in progress; keep the loss visible until located again.
 if(SpatialStatus.Contains(TEXT("perdida"))||SpatialStatus.Contains(TEXT("não localizada"))||SpatialStatus.Contains(TEXT("não encontrada")))return TEXT("Âncora perdida / reposicione");
 if(SpatialStatus.Contains(TEXT("Criando")))return TEXT("Criando âncora…");
 if(SpatialStatus.Contains(TEXT("gravação")))return TEXT("Salvando posição…");
 if(SpatialStatus.Contains(TEXT("Procurando"))||SpatialStatus.Contains(TEXT("aguardando localização"))||SpatialStatus.Contains(TEXT("salva")))return TEXT("Âncora procurando…");
 return TEXT("Posição manual / não fixada");
}
FString UAuroraMRPanel::GetInteractionHint() const{
 if(bDesktopInput)return bPositioning?TEXT("Arraste disponível no headset"):TEXT("Clique para selecionar");
 if(!bRightTracked)return TEXT("Mostre a mão direita para interagir");
 if(bPositioning)return bDragging?TEXT("Mova a mão / solte para fixar"):TEXT("Segure a pinça direita e arraste");
 return TEXT("Pinça direita para selecionar");
}
void UAuroraMRPanel::NativeOnInitialized(){Super::NativeOnInitialized();WidgetTree->RootWidget=WidgetTree->ConstructWidget<UCanvasPanel>();SetVisibility(ESlateVisibility::Visible);SetIsFocusable(true);}
void UAuroraMRPanel::Advance(float Delta){
 const FVector2D Size=GetCachedGeometry().GetLocalSize();
 const float SX=Size.X>0?Size.X/1600.f:1.f,SY=Size.Y>0?Size.Y/1000.f:1.f;
 const auto Font=AuroraUI::FontFor(22,SY,HUDSize.Y);const float Width=730*SX;
 if(WrappedBody!=BodyText||WrappedFontSize!=Font.Size||!FMath::IsNearlyEqual(WrappedWidth,Width)){
  const bool Changed=WrappedBody!=BodyText&&!BodyText.StartsWith(WrappedBody);WrappedBody=BodyText;WrappedFontSize=Font.Size;WrappedWidth=Width;
  AuroraUI::WrapText(BodyText,Font,Width,BodyLines);if(Changed)BodyPage=0;
 }
 const auto Measure=FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
 BodyLineHeight=FMath::Max(35.f*SY,float(Measure->Measure(TEXT("Ágj"),Font).Y)+6.f*SY);
 BodyLinesPerPage=FMath::Max(1,FMath::FloorToInt(340.f*SY/BodyLineHeight));
 BodyPage=FMath::Clamp(BodyPage,0,GetPageCount()-1);
 Age+=Delta;Reveal=FMath::FInterpConstantTo(Reveal,bOpen?1.f:0.f,Delta,2.8f);MenuReveal=FMath::FInterpConstantTo(MenuReveal,1.f,Delta,3.5f);InvalidateLayoutAndVolatility();
}
int32 UAuroraMRPanel::GetPageCount() const{return FMath::Max(1,FMath::DivideAndRoundUp(Rows.IsEmpty()?BodyLines.Num():Rows.Num(),Rows.IsEmpty()?BodyLinesPerPage:5));}
void UAuroraMRPanel::TogglePanel(){bOpen=!bOpen;if(bOpen){Age=MenuReveal=0;bMenuOpen=true;bHUDSettings=false;Selected=-1;}else if(OnDismiss)OnDismiss();}
void UAuroraMRPanel::ReplayEntrance(){bOpen=true;Reveal=MenuReveal=Age=0;bMenuOpen=true;bHUDSettings=false;Selected=-1;}
FString UAuroraMRPanel::GetSelectedOption() const{return Selected==7?TEXT("Operação ao vivo"):Selected==6?TEXT("Bancada criativa"):Selected==5?TEXT("Entregas"):Selected>=0&&Selected<4?AuroraUI::Names[Selected]:TEXT("");}
void UAuroraMRPanel::ActivateAt(FVector2D P){
 using namespace AuroraUI;if(!bOpen||Reveal<.94f)return;
 if(Hit(P,50,730,245,65)){if(OnAction)OnAction(15);return;}
 if(Hit(P,50,650,245,60)){if(OnAction)OnAction(20);return;}
 if(Selected==6&&!bHUDSettings&&!bMenuOpen&&Hit(P,775,650,335,45)){++BenchTextPage;return;}
 if(Hit(P,1190,915,340,56)){if(OnAction)OnAction(14);return;}
 if(Hit(P,380,710,490,72)){if(OnAction)OnAction(0);return;}
 if(Hit(P,890,710,220,72)){if(OnAction)OnAction(1);return;}
 if(Hit(P,1060,165,60,60)){TogglePanel();return;}
 for(int I=0;I<5;++I)if(Hit(P,350+I*158,830,150,72)){
   if(I==3){if(OnAction)OnAction(13);return;}
   const int Pages[]={0,2,1,5,4};const int Page=Pages[I];
   bHUDSettings=Page==4;bMenuOpen=false;BodyPage=0;MenuReveal=0;
   if(Page<4){Selected=Page;if(OnChoose)OnChoose(Page);}return;
 }
 for(int I=0;I<6;++I)if(Hit(P,1205,390+I*66,310,56)){
   if(OnAction)OnAction(ActionFor(Selected,bHUDSettings,I));return;
 }
 if(bMenuOpen){if(Hit(P,380,555,730,64)){SetPage(0);if(OnChoose)OnChoose(0);}return;}
 if(bHUDSettings){
   if(Hit(P,380,310,350,55)){bHUDSizeTab=true;return;}if(Hit(P,760,310,350,55)){bHUDSizeTab=false;return;}
   auto Change=[&](float X,float Y){if(bHUDSizeTab){if(OnHUDResize)OnHUDResize(X*.05f,Y*.05f);}else if(OnHUDAdjust)OnHUDAdjust(X,Y);};
   if(Hit(P,380,415,210,65))Change(-1,0);else if(Hit(P,900,415,210,65))Change(1,0);
   else if(Hit(P,380,515,210,65))Change(0,-1);else if(Hit(P,900,515,210,65))Change(0,1);
   else if(Hit(P,380,620,730,55)&&OnHUDReset)OnHUDReset();return;
 }
 for(int I=0;I<5;++I)if(Hit(P,380,310+I*66,730,58)&&Rows.IsValidIndex(BodyPage*5+I)){if(OnRow)OnRow(BodyPage*5+I);return;}
 if(Hit(P,380,650,200,45)){BodyPage=FMath::Clamp(BodyPage-1,0,GetPageCount()-1);return;}
 if(Hit(P,910,650,200,45)){BodyPage=FMath::Clamp(BodyPage+1,0,GetPageCount()-1);return;}
}
FReply UAuroraMRPanel::NativeOnMouseButtonDown(const FGeometry& G,const FPointerEvent& E){if(E.GetEffectingButton()==EKeys::LeftMouseButton){ActivateAt(G.AbsoluteToLocal(E.GetScreenSpacePosition())*FVector2D(1600.f/G.GetLocalSize().X,1000.f/G.GetLocalSize().Y));return FReply::Handled();}return FReply::Unhandled();}
FReply UAuroraMRPanel::NativeOnMouseMove(const FGeometry& G,const FPointerEvent& E){SetPointerPosition(G.AbsoluteToLocal(E.GetScreenSpacePosition())*FVector2D(1600.f/G.GetLocalSize().X,1000.f/G.GetLocalSize().Y));return FReply::Handled();}
void UAuroraMRPanel::NativeOnMouseLeave(const FPointerEvent& E){ClearPointer();Super::NativeOnMouseLeave(E);}
int32 UAuroraMRPanel::NativePaint(const FPaintArgs& Args,const FGeometry& G,const FSlateRect& Cull,FSlateWindowElementList& Out,int32 Layer,const FWidgetStyle& Style,bool Enabled)const{
 using namespace AuroraUI;if(Reveal<.005f)return Layer;const float Ease=1-FMath::Pow(1-Reveal,3),SX=G.GetLocalSize().X/1600.f,SY=G.GetLocalSize().Y/1000.f;
 auto Rect=[&](float X,float Y,float W,float H,FLinearColor C,int L=0){static FSlateColorBrush Brush(FLinearColor::White);C.A*=Ease;FSlateDrawElement::MakeBox(Out,Layer+L,G.ToPaintGeometry(FVector2D(W*SX,H*SY),FSlateLayoutTransform(FVector2D(X*SX,Y*SY))),&Brush,ESlateDrawEffect::None,C);};
 auto Label=[&](float X,float Y,const FString& S,int Size,FLinearColor C,float Width=510.f){const auto Font=FontFor(Size,SY,HUDSize.Y);const FString Text=Ellipsize(S,Font,Width*SX);FSlateDrawElement::MakeText(Out,Layer+4,G.ToPaintGeometry(FVector2D(Width*SX,60*SY),FSlateLayoutTransform(FVector2D((X+1)*SX,(Y+2)*SY))),Text,Font,ESlateDrawEffect::None,FLinearColor(0,0,0,.95f*Ease));C.A*=Ease;FSlateDrawElement::MakeText(Out,Layer+5,G.ToPaintGeometry(FVector2D(Width*SX,60*SY),FSlateLayoutTransform(FVector2D(X*SX,Y*SY))),Text,Font,ESlateDrawEffect::None,C);};
 auto Path=[&](TArray<FVector2D> P,FLinearColor C,float Width=2.f){for(auto& V:P){V.X*=SX;V.Y*=SY;}C.A*=Ease;FSlateDrawElement::MakeLines(Out,Layer+3,G.ToPaintGeometry(),P,ESlateDrawEffect::None,C,true,Width*SY);};
 auto Circle=[&](float X,float Y,float R,FLinearColor C,float Width=2.f){TArray<FVector2D>P;for(int I=0;I<=64;++I){float A=2*PI*I/64;P.Add(FVector2D(X+R*FMath::Cos(A),Y+R*FMath::Sin(A)));}Path(P,C,Width);};
 auto Disk=[&](float X,float Y,float R,FLinearColor C){FSlateRoundedBoxBrush Brush(FLinearColor::White,R*SY);C.A*=Ease;FSlateDrawElement::MakeBox(Out,Layer+2,G.ToPaintGeometry(FVector2D(R*2*SX,R*2*SY),FSlateLayoutTransform(FVector2D((X-R)*SX,(Y-R)*SY))),&Brush,ESlateDrawEffect::None,C);};
 FString FocusLabel;
 auto FocusFrame=[&](float X,float Y,float W,float H){Path({{X,Y},{X+W,Y},{X+W,Y+H},{X,Y+H},{X,Y}},Gold,3.f);};
 auto Button=[&](float X,float Y,float W,float H,const FString& S,int Size=20,bool Available=true,FLinearColor Tint=Glass){bool Hot=Available&&IsControlHovered(X,Y,W,H);if(Hot){FocusLabel=S;FocusFrame(X,Y,W,H);}FSlateRoundedBoxBrush ButtonBrush(FLinearColor::White,14.f*SY);FLinearColor Fill=Hot?Selection:Tint;Fill.A*=Ease;FSlateDrawElement::MakeBox(Out,Layer+1,G.ToPaintGeometry(FVector2D(W*SX,H*SY),FSlateLayoutTransform(FVector2D(X*SX,Y*SY))),&ButtonBrush,ESlateDrawEffect::None,Fill);const auto Font=FontFor(Size,SY,HUDSize.Y);const float TextHeight=FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(S,Font).Y/SY;Label(X+12,Y+(H-TextHeight)*.5f,S,Size,Available?White:FLinearColor(.55,.58,.57,1),W-24);if(!Available)Rect(X,Y+H-2,W,2,FLinearColor(.45,.48,.47,.55),2);};
 // Transparent holographic surfaces; activity follows the actual Harness state.
 auto Card=[&](float X,float Y,float W,float H){
   FSlateRoundedBoxBrush Brush(FLinearColor::White,24.f*SY);
   FSlateDrawElement::MakeBox(Out,Layer,G.ToPaintGeometry(FVector2D(W*SX,H*SY),FSlateLayoutTransform(FVector2D(X*SX,Y*SY))),&Brush,ESlateDrawEffect::None,FLinearColor(.008f,.025f,.045f,.28f*Ease));
   Path({{X+24,Y+1},{X+W-24,Y+1}},FLinearColor(.2f,.85f,1.f,.65f),1.5f);
   for(int I=0;I<2;++I){const float A=I?X+W:X,D=I?-1.f:1.f;
     Path({{A+D*32,Y},{A,Y},{A,Y+32}},Gold,2.f);
     Path({{A+D*32,Y+H},{A,Y+H},{A,Y+H-32}},Gold,2.f);}
   Path({{X+28,Y+H-1},{X+W-28,Y+H-1}},FLinearColor(.25f,.65f,1.f,.28f),1.f);
 };
 const FString State=!bConnected?TEXT("Conectando"):bListening?TEXT("Ouvindo você"):bSpeaking?TEXT("Aurora falando"):bBusy?TEXT("Em andamento"):TEXT("Pronta para conversar");
 const FLinearColor Accent=bListening?FLinearColor(.1f,1,.75f,1):bBusy?FLinearColor(.65f,.4f,1,1):Gold;
 const float Pulse=1.f+.035f*FMath::Sin(Age*(bListening?6.f:1.8f));
 for(int I=0;I<3;++I)Disk(170,435,(64+I*14)*Pulse,FLinearColor(.15f,.3f,.85f,.035f));
 Disk(170,435,39*Pulse,FLinearColor(.34f,.44f,.86f,.95f));Disk(161,423,22*Pulse,FLinearColor(.6f,.85f,1,.8f));
 for(int I=0;I<2;++I){TArray<FVector2D> Points;for(int J=0;J<=48;++J){const float A=J/48.f*PI*1.45f+Age*(I?.12f:-.10f)+I*PI;Points.Add(FVector2D(170+FMath::Cos(A)*(88+I*18),435+FMath::Sin(A)*(88+I*18)));}Path(Points,I?FLinearColor(.6f,.3f,1,1):Accent,5);}
 Label(88,585,TEXT("A U R O R A"),25,White,240);
 Button(50,730,245,65,TEXT("Bancada"),24);
 Button(50,650,245,60,TEXT("Operação"),24);
 Label(52,615,!bConnected?TEXT("Aguardando conexão"):bListening?TEXT("Estou ouvindo"):bSpeaking?TEXT("Respondendo"):bBusy?TEXT("Trabalhando"):TEXT("Aqui com você"),20,Muted,265);
 Card(340,145,810,655);
 const FString Title=bHUDSettings?TEXT("Seu espaço, seu jeito"):bMenuOpen?TEXT("Vamos continuar?"):GetSelectedOption();
 Label(380,175,Title,36,White,660);Button(1060,165,60,60,TEXT("×"),26);
 Label(380,238,ContextLabel.IsEmpty()?TEXT("Conversa geral"):ContextLabel,22,Muted,470);
 Disk(912,252,5,bConnected?FLinearColor(.2f,.9f,.65f,1):FLinearColor(.9f,.55f,.2f,1));
 Label(930,238,bConnected?(bUsingPc?TEXT("PC conectado"):TEXT("No Quest")):TEXT("Sem conexão"),20,Muted,195);
 if(bMenuOpen){
   Label(380,333,TEXT("O que vamos fazer agora?"),29,White,730);
   Label(380,398,TEXT("Converse, retome um projeto ou peça uma tarefa."),23,Muted,730);
   Label(380,446,TEXT("Acompanhe a execução e encontre suas entregas."),23,Muted,730);
   Button(380,555,730,64,TEXT("Ver minhas conversas"),23);
 }else if(bHUDSettings){
   Button(380,310,350,55,TEXT("Tamanho"));Button(760,310,350,55,TEXT("Posição"));Rect(bHUDSizeTab?380:760,362,350,3,Gold,3);
   Button(380,415,210,65,bHUDSizeTab?TEXT("Estreitar"):TEXT("Esquerda"));Button(900,415,210,65,bHUDSizeTab?TEXT("Alargar"):TEXT("Direita"));
   Label(675,423,bHUDSizeTab?FString::Printf(TEXT("%.0f%%"),HUDSize.X*100):FString::Printf(TEXT("%+.0f°"),HUDOffset.X),28,White,210);
   Button(380,515,210,65,bHUDSizeTab?TEXT("Diminuir"):TEXT("Descer"));Button(900,515,210,65,bHUDSizeTab?TEXT("Aumentar"):TEXT("Subir"));
   Label(675,523,bHUDSizeTab?FString::Printf(TEXT("%.0f%%"),HUDSize.Y*100):FString::Printf(TEXT("%+.0f°"),HUDOffset.Y),28,White,210);
   Button(380,620,730,55,TEXT("Restaurar posição e tamanho"));
 }else if(Selected==7){
   // The Power BI the Aurora keeps open, read from the PC: its numbers here, its miniature in front.
   Label(380,302,TwinUnit.IsEmpty()?TEXT("POWER BI NO PC"):TwinUnit.ToUpper(),20,Gold,350);
   Label(380,339,TwinTitle,22,White,350);
   for(int I=0;I<FMath::Min(5,TwinLines.Num());++I)Label(380,385+I*36,TwinLines[I],21,White,350);
   Label(380,600,TwinSeal,21,TwinSeal.StartsWith(TEXT("✓"))?FLinearColor(.4f,1.f,.72f,1):Gold,350);
   Label(775,302,TEXT("O QUE MUDOU"),20,Gold,335);
   if(!TwinNote.IsEmpty())Label(775,335,TEXT("Aurora: ")+TwinNote,20,FLinearColor(.8f,.6f,1,1),335);
   int Row=0;for(const FString& Note:TwinNotes){TArray<FString> Lines;WrapText(Note,FontFor(20,SY,HUDSize.Y),335*SX,Lines);for(const FString& Line:Lines){if(Row>=9)break;Label(775,372+Row*30,Line,20,Muted,335);++Row;}}
   if(TwinNotes.IsEmpty())Label(775,372,TEXT("As mudanças aparecem a cada atualização do PC."),20,Muted,335);
   Label(775,650,TwinUnitCount>1?FString::Printf(TEXT("%d unidades • Trocar unidade à direita"),TwinUnitCount):TEXT("Maquete à sua frente"),18,Muted,335);
 }else if(Selected==6){
   Label(380,302,BenchCount?FString::Printf(TEXT("REFERÊNCIA %d / %d"),BenchIndex+1,BenchCount):TEXT("RECEBIDOS"),20,Gold,350);
   Label(380,339,BenchTitle.IsEmpty()?TEXT("Envie pelo Telegram"):BenchTitle,22,White,350);
   if(BenchImage){
     const float Fit=FMath::Min(350.f/BenchImage->GetSizeX(),210.f/BenchImage->GetSizeY());
     const float W=BenchImage->GetSizeX()*Fit,H=BenchImage->GetSizeY()*Fit;
     FSlateBrush ImageBrush;ImageBrush.SetResourceObject(BenchImage);ImageBrush.ImageSize=FVector2D(W,H);
     FSlateDrawElement::MakeBox(Out,Layer+2,G.ToPaintGeometry(FVector2D(W*SX,H*SY),FSlateLayoutTransform(FVector2D((380+(350-W)/2)*SX,382*SY))),&ImageBrush,ESlateDrawEffect::None,FLinearColor(1,1,1,Ease));
   }else{
     TArray<FString> Lines;WrapText(BenchNote.IsEmpty()?TEXT("No celular: /bancada nome do projeto. Depois envie uma foto ou /referencia sua ideia."):BenchNote,FontFor(22,SY,HUDSize.Y),350*SX,Lines);
     for(int I=0;I<FMath::Min(7,Lines.Num());++I)Label(380,385+I*32,Lines[I],22,White,350);
   }
   Label(380,615,TEXT("Origem: Telegram / PC"),20,Muted,350);
   Label(775,302,bBenchDraft?TEXT("REVISE ANTES DE SALVAR"):bBenchSaved?TEXT("SALVA NO PC"):TEXT("SUA PRÓXIMA DECISÃO"),20,bBenchSaved?FLinearColor(.4f,1.f,.72f,1):Gold,335);
   Label(775,335,bBenchSaved?TEXT("Memória do projeto"):TEXT("Confirme à direita"),18,Muted,335);
   TArray<FString> DecisionLines;WrapText(BenchDecision.IsEmpty()?TEXT("Diga: registrar decisão, seguido da sua ideia. Depois use Confirmar decisão."):BenchDecision,FontFor(22,SY,HUDSize.Y),335*SX,DecisionLines);
   const int Pages=FMath::Max(1,FMath::DivideAndRoundUp(DecisionLines.Num(),8));const int Page=BenchTextPage%Pages;
   for(int I=0;I<8&&DecisionLines.IsValidIndex(Page*8+I);++I)Label(775,374+I*32,DecisionLines[Page*8+I],22,White,335);
   Button(775,650,335,45,FString::Printf(TEXT("Ler %d / %d  ›"),Page+1,Pages),20);
 }else{
   if(!Rows.IsEmpty()){for(int I=0;I<5;++I){const int Index=BodyPage*5+I;if(!Rows.IsValidIndex(Index))break;Button(380,310+I*66,730,58,Rows[Index],22);}}
   else{const int Start=BodyPage*BodyLinesPerPage;for(int I=0;I<BodyLinesPerPage&&BodyLines.IsValidIndex(Start+I);++I)Label(380,310+I*BodyLineHeight/SY,BodyLines[Start+I],22,White,730);}
   Button(380,650,200,45,TEXT("‹ Anterior"),20,BodyPage>0);Button(910,650,200,45,TEXT("Próxima ›"),20,BodyPage+1<GetPageCount());Label(704,658,FString::Printf(TEXT("%d / %d"),BodyPage+1,GetPageCount()),20,Muted,180);
 }
 Button(380,710,490,72,bListening?TEXT("Enviar fala"):TEXT("Falar com Aurora"),26,true,FLinearColor(.04f,.28f,.42f,.55f));
 Button(890,710,220,72,TEXT("Parar"),24);
 Card(340,815,810,100);
 const TCHAR* Dock[]={TEXT("Chat"),TEXT("Projetos"),TEXT("Memórias"),TEXT("Entregas"),TEXT("Ajustes")};
 const int DockPage[]={0,2,1,5,4};
 for(int I=0;I<5;++I){Button(350+I*158,830,150,72,Dock[I],20);if((bHUDSettings&&I==4)||(!bHUDSettings&&!bMenuOpen&&Selected==DockPage[I]))Rect(366+I*158,897,118,3,Gold,3);}
 Card(1190,175,340,615);
 Label(1205,202,bUsingPc?TEXT("NO SEU PC"):TEXT("AURORA"),20,Muted,310);
 Label(1205,247,State,25,Accent,310);
 TArray<FString> StatusLines;WrapText(ConnectionStatus,FontFor(20,SY,HUDSize.Y),310*SX,StatusLines);
 for(int I=0;I<FMath::Min(3,StatusLines.Num());++I)Label(1205,295+I*27,StatusLines[I],20,Muted,310);
 for(int I=0;I<6;++I)Button(1205,390+I*66,310,56,ActionName(ActionFor(Selected,bHUDSettings,I),bListening,bWakeEnabled),20);
 Label(350,940,FocusLabel.IsEmpty()?GetInteractionHint():TEXT("Selecionar: ")+FocusLabel,20,Muted,790);
 Label(1190,825,bWakeEnabled?TEXT("Chamada por nome ativa"):TEXT("Chamada por nome pausada"),20,Muted,340);
 Label(1190,870,TEXT("Palma esquerda: menu"),20,Muted,340);
 Button(1190,915,340,56,bContours?TEXT("Contornos: ligados"):TEXT("Contornos: desligados"),20);
 if(CanShowPointerFocus()&&Hover.X>=0&&Hover.X<1600&&Hover.Y>=0&&Hover.Y<1000)Circle(Hover.X,Hover.Y,7,Gold,2);
 return Layer+6;
}

#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraPanelReadingTest,"Aurora.UI.MeasuredReading",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraPanelReadingTest::RunTest(const FString& Parameters){
 using namespace AuroraUI;
 const auto Font=FontFor(22,1,1);TArray<FString> Lines;
 const FString Accents=TEXT("Ação memória revisão português ÁÉÍÓÚ ç a\u0301");
 WrapText(Accents,Font,180,Lines);
 TestEqual(TEXT("Accents survive wrapping"),FString::Join(Lines,TEXT(" ")),Accents);
 for(const auto& Line:Lines)TestTrue(TEXT("Line fits measured width"),TextWidth(Line,Font)<=180.1f);
 WrapText(TEXT("WWWWWWWWWWWWWWWW"),Font,100,Lines);const int WideCount=Lines.Num();
 WrapText(TEXT("iiiiiiiiiiiiiiii"),Font,100,Lines);TestTrue(TEXT("Width, not character count"),WideCount>Lines.Num());
 const FString Token=TEXT("a\u0301a\u0301a\u0301a\u0301a\u0301");WrapText(Token,Font,45,Lines);
 TestEqual(TEXT("Unbroken token preserves graphemes"),FString::Join(Lines,TEXT("")),Token);
 for(const auto& Line:Lines)TestFalse(TEXT("No detached combining accent"),Line.StartsWith(TEXT("\u0301")));
 WrapText(TEXT("ação\r\n\r\nmemória"),Font,510,Lines);TestEqual(TEXT("Blank paragraphs preserved"),Lines.Num(),3);
 const FString Name=TEXT("Projeto de revisão das memórias e decisões da Aurora");
 const FString Short=Ellipsize(Name,Font,180);TestTrue(TEXT("Ellipsis shown"),Short.EndsWith(TEXT("…")));TestTrue(TEXT("Ellipsis fits"),TextWidth(Short,Font)<=180.1f);
 TestEqual(TEXT("Short names unchanged"),Ellipsize(TEXT("Ação"),Font,180),FString(TEXT("Ação")));
 auto Widget=NewObject<UAuroraMRPanel>();Widget->Advance(1.f);Widget->SetPage(0);
 for(int I=0;I<11;++I)Widget->Rows.Add(FString::FromInt(I));
 Widget->Advance(0);Widget->ActivateAt(FVector2D(1000,670));TestEqual(TEXT("Second page"),Widget->BodyPage,1);
 Widget->ActivateAt(FVector2D(1000,670));Widget->ActivateAt(FVector2D(1000,670));TestEqual(TEXT("Last page clamps"),Widget->BodyPage,2);
 Widget->Rows.SetNum(1);Widget->Advance(0);TestEqual(TEXT("Shrinking list clamps page"),Widget->BodyPage,0);
 Widget->ActivateAt(FVector2D(450,670));TestEqual(TEXT("First page clamps"),Widget->BodyPage,0);
 // Presentation consumes existing tracking/placement state, never changes the anchor.
 Widget->SetSpatialPresentation(false,false,true,true,true,false);
 Widget->SpatialStatus=TEXT("Posição salva localizada");
 TestEqual(TEXT("Located followed anchor"),Widget->GetPlacementLabel(),FString(TEXT("Âncora fixada")));
 Widget->SetPointerPosition(FVector2D(450,330));
 TestTrue(TEXT("Tracked pointer focuses a row"),Widget->IsControlHovered(380,310,730,58));
 Widget->SetSpatialPresentation(false,false,true,false,false,false);
 Widget->SpatialStatus=TEXT("Localização perdida • procurando posição salva");
 TestEqual(TEXT("Loss has priority over searching text"),Widget->GetPlacementLabel(),FString(TEXT("Âncora perdida / reposicione")));
 TestFalse(TEXT("Tracking loss clears focus"),Widget->IsControlHovered(380,310,730,58));
 TestEqual(TEXT("Only right hand enables interaction"),Widget->GetInteractionHint(),FString(TEXT("Mostre a mão direita para interagir")));
 Widget->SetSpatialPresentation(false,false,true,false,true,false);
 Widget->SpatialStatus=TEXT("Posição recuperada • aguardando localização");
 TestEqual(TEXT("Restore is searching until located"),Widget->GetPlacementLabel(),FString(TEXT("Âncora procurando…")));
 Widget->SpatialStatus=TEXT("Posição espacial salva no Quest");
 TestEqual(TEXT("Saved does not imply located"),Widget->GetPlacementLabel(),FString(TEXT("Âncora procurando…")));
 Widget->SetSpatialPresentation(false,false,false,true,true,false);
 TestEqual(TEXT("Recentered menu does not claim old anchor"),Widget->GetPlacementLabel(),FString(TEXT("Posição manual / não fixada")));
 Widget->SetSpatialPresentation(false,false,true,true,true,false);
 Widget->SpatialStatus=TEXT("Âncora não salva • tente reposicionar");
 TestEqual(TEXT("Save failure remains visible when located"),Widget->GetPlacementLabel(),FString(TEXT("Âncora não salva / reposicione")));
 Widget->SetSpatialPresentation(true,false,false,true,true,false);
 Widget->SetPointerPosition(FVector2D(450,330));
 TestFalse(TEXT("No selection focus while positioning"),Widget->IsControlHovered(380,310,730,58));
 TestEqual(TEXT("Ready to drag instruction"),Widget->GetInteractionHint(),FString(TEXT("Segure a pinça direita e arraste")));
 Widget->SetSpatialPresentation(true,true,false,false,true,false);
 TestEqual(TEXT("Dragging instruction"),Widget->GetInteractionHint(),FString(TEXT("Mova a mão / solte para fixar")));
 Widget->SetSpatialPresentation(false,false,false,false,false,true);
 TestEqual(TEXT("Desktop does not ask for hand tracking"),Widget->GetInteractionHint(),FString(TEXT("Clique para selecionar")));
 Widget->SetPointerPosition(FVector2D(450,330));TestTrue(TEXT("Desktop pointer focus"),Widget->IsControlHovered(380,310,730,58));
 Widget->SetSpatialPresentation(true,false,false,false,false,true);
 TestTrue(TEXT("Desktop controls remain usable in position mode"),Widget->IsControlHovered(380,310,730,58));
 Widget->SetSpatialPresentation(true,true,false,false,false,false);
 TestEqual(TEXT("Lost hand during drag asks to reacquire"),Widget->GetInteractionHint(),FString(TEXT("Mostre a mão direita para interagir")));
 Widget->SetSpatialPresentation(false,false,false,false,false,true);
 Widget->ClearPointer();TestFalse(TEXT("Leaving clears focus"),Widget->IsControlHovered(380,310,730,58));
 Widget->SetPointerPosition(FVector2D(450,330));Widget->TogglePanel();TestFalse(TEXT("Closed menu has no focus"),Widget->IsControlHovered(380,310,730,58));
 return true;
}
#endif
