#include "AuroraMRPanel.h"
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
const FLinearColor White(.98,.98,.94,1),Muted(.86,.88,.85,1),Gold(1.f,.64f,.025f,.94f),Selection(.25f,.12f,.01f,.88f),Glass(.025f,.035f,.045f,.46f);
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
int ActionFor(int Selected,bool Settings,int I){const int General[]={0,1,2,5,12,11},Projects[]={12,5,8,9,10,11},Environment[]={4,3,0,1,12,11},Options[]={6,7,8,9,10,1};return Settings?Options[I]:Selected==2?Projects[I]:Selected==3?Environment[I]:General[I];}
FString ActionName(int I,bool Listening,bool Wake){switch(I){case 0:return Listening?TEXT("Enviar fala"):TEXT("Falar com Aurora");case 1:return TEXT("Parar conversa");case 2:return TEXT("Guardar resposta");case 3:return TEXT("Posicionar menu");case 4:return TEXT("Ler ambiente");case 5:return TEXT("Nova conversa");case 6:return TEXT("Ouvir a voz");case 7:return Wake?TEXT("Pausar chamada por nome"):TEXT("Ativar chamada por nome");case 8:return TEXT("Professor / Codex");case 9:return TEXT("Professor / Claude");case 10:return TEXT("Pedir revisão ao professor");case 11:return TEXT("Ver referências");case 12:return TEXT("Retomar contexto");default:return TEXT("");}}
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
 const auto Font=AuroraUI::FontFor(22,SY,HUDSize.Y);const float Width=510*SX;
 if(WrappedBody!=BodyText||WrappedFontSize!=Font.Size||!FMath::IsNearlyEqual(WrappedWidth,Width)){
  const bool Changed=WrappedBody!=BodyText;WrappedBody=BodyText;WrappedFontSize=Font.Size;WrappedWidth=Width;
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
FString UAuroraMRPanel::GetSelectedOption() const{return Selected>=0&&Selected<4?AuroraUI::Names[Selected]:TEXT("");}
void UAuroraMRPanel::ActivateAt(FVector2D P){
 using namespace AuroraUI;if(!bOpen||Reveal<.94f)return;
 if(Hit(P,600,165,60,65)){TogglePanel();return;}
 auto Choose=[&](int I){bHUDSettings=I==4;bMenuOpen=false;BodyPage=0;MenuReveal=0;if(I<4){Selected=I;if(OnChoose)OnChoose(I);}};
 for(int I=0;I<5;++I)if(Rail(P,I)){Choose(I);return;}
 if(bMenuOpen){for(int I=0;I<4;++I)if(Hit(P,875,255+I*85,625,72)){Choose(I);return;}return;}
 for(int I=0;I<6;++I)if(Hit(P,875,255+I*85,625,72)){if(OnAction)OnAction(ActionFor(Selected,bHUDSettings,I));return;}
 if(bHUDSettings){
 if(Hit(P,100,310,245,55)){bHUDSizeTab=true;return;}if(Hit(P,365,310,245,55)){bHUDSizeTab=false;return;}
 auto Change=[&](float X,float Y){if(bHUDSizeTab){if(OnHUDResize)OnHUDResize(X*.05f,Y*.05f);}else if(OnHUDAdjust)OnHUDAdjust(X,Y);};
 if(Hit(P,100,430,130,65))Change(-1,0);else if(Hit(P,480,430,130,65))Change(1,0);else if(Hit(P,100,550,130,65))Change(0,-1);else if(Hit(P,480,550,130,65))Change(0,1);
 else if(Hit(P,100,690,510,60)&&OnHUDReset)OnHUDReset();return;}
 for(int I=0;I<5;++I)if(Hit(P,100,310+I*66,510,58)&&Rows.IsValidIndex(BodyPage*5+I)){if(OnRow)OnRow(BodyPage*5+I);return;}
 if(Hit(P,100,690,175,55)){BodyPage=FMath::Clamp(BodyPage-1,0,GetPageCount()-1);return;}
 if(Hit(P,435,690,175,55)){BodyPage=FMath::Clamp(BodyPage+1,0,GetPageCount()-1);return;}
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
 auto Button=[&](float X,float Y,float W,float H,const FString& S,int Size=20,bool Available=true){bool Hot=Available&&IsControlHovered(X,Y,W,H);if(Hot){FocusLabel=S;FocusFrame(X,Y,W,H);}Rect(X,Y,W,H,Hot?Selection:Glass,1);const auto Font=FontFor(Size,SY,HUDSize.Y);const float TextHeight=FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(S,Font).Y/SY;Label(X+12,Y+(H-TextHeight)*.5f,S,Size,Available?White:FLinearColor(.55,.58,.57,1),W-24);if(!Available)Rect(X,Y+H-2,W,2,FLinearColor(.45,.48,.47,.55),2);};
 // Three detached surfaces match the supplied references: profile/details, circular rail, cascading options.
 Rect(70,160,590,660,FLinearColor(.015,.025,.035,.64));Rect(70,160,590,75,Glass,1);
 Rect(865,770,650,222,FLinearColor(.015f,.025f,.035f,.64f));
 Label(105,180,bHUDSettings?TEXT("Ajustes"):bMenuOpen?TEXT("A U R O R A"):GetSelectedOption(),29,White);Button(600,165,60,65,TEXT("×"),26);
 Path({{90,237},{640,237}},Muted,1);Label(100,260,ConnectionStatus,15,White);
 if(bMenuOpen){
   // Abstract assistant profile, not body tracking or simulated game statistics.
   Disk(355,378,27,FLinearColor(.96,.97,.93,.65));Path({{335,420},{375,420},{391,515},{377,515},{371,596},{358,596},{355,526},{351,596},{338,596},{332,515},{320,515},{335,420}},White,4);
   Path({{335,429},{302,488},{287,476}},White,4);Path({{375,429},{408,488},{423,476}},White,4);
   for(int I=0;I<4;++I){float Y=368+I*74;Circle(180,Y,10,Muted);Circle(530,Y,10,Muted);Path({{192,Y},{315,465}},FLinearColor(.9,.94,.9,.32),1);Path({{518,Y},{395,465}},FLinearColor(.9,.94,.9,.32),1);}
   Label(100,663,TEXT("Assistente pessoal"),24,White);Label(100,706,TEXT("Conversas · projetos · memórias"),17,Muted);Label(100,750,TEXT("Selecione uma categoria ao lado"),16,Muted);
 }else if(bHUDSettings){
   Button(100,310,245,55,TEXT("Tamanho"));Button(365,310,245,55,TEXT("Posição"));Rect(bHUDSizeTab?100:365,362,245,3,Gold,3);
   Label(100,386,TEXT("Menu flutuante / salvo automaticamente"),15,Muted);
   Button(100,430,130,65,bHUDSizeTab?TEXT("Estreitar"):TEXT("Esquerda"),17);Button(480,430,130,65,bHUDSizeTab?TEXT("Alargar"):TEXT("Direita"),17);
   Label(288,426,bHUDSizeTab?TEXT("LARGURA"):TEXT("EIXO X"),15,Muted);Label(320,458,bHUDSizeTab?FString::Printf(TEXT("%.0f%%"),HUDSize.X*100):FString::Printf(TEXT("%+.0f°"),HUDOffset.X),23,White);
   Button(100,550,130,65,bHUDSizeTab?TEXT("Diminuir"):TEXT("Descer"),17);Button(480,550,130,65,bHUDSizeTab?TEXT("Aumentar"):TEXT("Subir"),17);
   Label(288,546,bHUDSizeTab?TEXT("ALTURA"):TEXT("EIXO Y"),15,Muted);Label(320,578,bHUDSizeTab?FString::Printf(TEXT("%.0f%%"),HUDSize.Y*100):FString::Printf(TEXT("%+.0f°"),HUDOffset.Y),23,White);
   Button(100,690,510,60,TEXT("Restaurar posição e tamanho"));Label(100,768,TEXT("Professor selecionado: ")+TeacherLabel,16,Muted);
 }else{
   if(!Rows.IsEmpty()){for(int I=0;I<5;++I){int Index=BodyPage*5+I;if(!Rows.IsValidIndex(Index))break;Button(100,310+I*66,510,58,Rows[Index],17);}}
   else{int Start=BodyPage*BodyLinesPerPage;for(int I=0;I<BodyLinesPerPage&&BodyLines.IsValidIndex(Start+I);++I)Label(100,310+I*BodyLineHeight/SY,BodyLines[Start+I],22,White);}
   Button(100,690,175,55,TEXT("‹ Anterior"),20,BodyPage>0);Button(435,690,175,55,TEXT("Próxima ›"),20,BodyPage+1<GetPageCount());Label(290,702,FString::Printf(TEXT("%d/%d"),BodyPage+1,GetPageCount()),20,White,130);Label(100,778,TEXT("Professor: ")+TeacherLabel+TEXT(" / conexão remota"),14,Muted);
 }
 for(int I=0;I<5;++I){float Y=235+I*115;bool Active=bHUDSettings?I==4:!bMenuOpen&&Selected==I;bool Hot=CanShowPointerFocus()&&Rail(Hover,I);if(Hot){FocusLabel=Names[I];Circle(740,Y,51,Gold,3.f);}Disk(740,Y,41,Active||Hot?Selection:Glass);Circle(740,Y,47,Active?Gold:Muted,1.5);Circle(740,Y,40,White,1.5);
   if(I==0)Path({{721,Y-14},{759,Y-14},{759,Y+10},{742,Y+10},{730,Y+21},{730,Y+10},{721,Y+10},{721,Y-14}},White);
   if(I==1){Path({{724,Y-20},{751,Y-20},{758,Y-12},{758,Y+20},{724,Y+20},{724,Y-20}},White);Path({{731,Y-5},{750,Y-5}},White);Path({{731,Y+5},{750,Y+5}},White);}
   if(I==2)Path({{719,Y-11},{734,Y-11},{740,Y-19},{761,Y-19},{761,Y+17},{719,Y+17},{719,Y-11}},White);
   if(I==3){Circle(740,Y-6,13,White);Path({{728,Y+2},{740,Y+25},{752,Y+2}},White);Circle(740,Y-6,4,White);}
   if(I==4){Circle(740,Y,16,White);Circle(740,Y,6,White);for(int J=0;J<8;++J){float A=J*PI/4;Path({FVector2D(740+17*FMath::Cos(A),Y+17*FMath::Sin(A)),FVector2D(740+24*FMath::Cos(A),Y+24*FMath::Sin(A))},White,3);}}
   if(Active){Path({{795,Y},{824,Y-12},{824,Y+12},{795,Y}},Gold,2);Path({{690,Y},{667,Y-12},{667,Y+12},{690,Y}},Gold,2);}
 }
 Label(890,195,bMenuOpen?TEXT("MENU"):bHUDSettings?TEXT("PREFERÊNCIAS"):TEXT("AÇÕES"),17,Muted);
 const int Count=bMenuOpen?4:6;
 for(int I=0;I<Count;++I){float A=FMath::Clamp(MenuReveal*1.7f-I*.12f,0.f,1.f),X=875+(1-A)*45,Y=255+I*85;
   bool Hot=IsControlHovered(875,Y,625,72);Rect(X,Y,625,72,Hot?Selection:FLinearColor(.015f,.025f,.035f,.64f*A),1);
   Disk(X+36,Y+36,20,Hot?FLinearColor(1,1,1,.25):FLinearColor(.05,.08,.06,.4));
   Label(X+29,Y+21,bMenuOpen?FString::FromInt(I+1):TEXT("›"),20,White);
   FString Text=bMenuOpen?Names[I]:ActionName(ActionFor(Selected,bHUDSettings,I),bListening,bWakeEnabled);if(Hot){FocusLabel=Text;FocusFrame(X,Y,625,72);}Label(X+76,Y+20,Text,21,FLinearColor(1,1,.95,A),529);
 }
 Label(875,778,GetPlacementLabel(),20,White,625);
 Label(875,820,GetInteractionHint(),20,White,625);
 Label(875,862,FocusLabel.IsEmpty()?(bPositioning?TEXT("Posicionamento em andamento"):TEXT("Mover: Ambiente > Posicionar menu")):TEXT("Foco: ")+FocusLabel,20,FocusLabel.IsEmpty()?Muted:Gold,625);
 Label(875,904,bWakeEnabled?TEXT("Diga Aurora para chamar / escuta ativada"):TEXT("Chamada por nome pausada"),20,Muted,625);
 Label(875,946,TEXT("Voz e professores usam a conexão com o PC"),20,Muted,625);
 if(CanShowPointerFocus()&&Hover.X>=0&&Hover.X<1600&&Hover.Y>=0&&Hover.Y<1000)Circle(Hover.X,Hover.Y,6,Gold,2);
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
 Widget->Advance(0);Widget->ActivateAt(FVector2D(500,710));TestEqual(TEXT("Second page"),Widget->BodyPage,1);
 Widget->ActivateAt(FVector2D(500,710));Widget->ActivateAt(FVector2D(500,710));TestEqual(TEXT("Last page clamps"),Widget->BodyPage,2);
 Widget->Rows.SetNum(1);Widget->Advance(0);TestEqual(TEXT("Shrinking list clamps page"),Widget->BodyPage,0);
 Widget->ActivateAt(FVector2D(150,710));TestEqual(TEXT("First page clamps"),Widget->BodyPage,0);
 // Presentation consumes existing tracking/placement state, never changes the anchor.
 Widget->SetSpatialPresentation(false,false,true,true,true,false);
 Widget->SpatialStatus=TEXT("Posição salva localizada");
 TestEqual(TEXT("Located followed anchor"),Widget->GetPlacementLabel(),FString(TEXT("Âncora fixada")));
 Widget->SetPointerPosition(FVector2D(150,330));
 TestTrue(TEXT("Tracked pointer focuses a row"),Widget->IsControlHovered(100,310,510,58));
 Widget->SetSpatialPresentation(false,false,true,false,false,false);
 Widget->SpatialStatus=TEXT("Localização perdida • procurando posição salva");
 TestEqual(TEXT("Loss has priority over searching text"),Widget->GetPlacementLabel(),FString(TEXT("Âncora perdida / reposicione")));
 TestFalse(TEXT("Tracking loss clears focus"),Widget->IsControlHovered(100,310,510,58));
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
 Widget->SetPointerPosition(FVector2D(150,330));
 TestFalse(TEXT("No selection focus while positioning"),Widget->IsControlHovered(100,310,510,58));
 TestEqual(TEXT("Ready to drag instruction"),Widget->GetInteractionHint(),FString(TEXT("Segure a pinça direita e arraste")));
 Widget->SetSpatialPresentation(true,true,false,false,true,false);
 TestEqual(TEXT("Dragging instruction"),Widget->GetInteractionHint(),FString(TEXT("Mova a mão / solte para fixar")));
 Widget->SetSpatialPresentation(false,false,false,false,false,true);
 TestEqual(TEXT("Desktop does not ask for hand tracking"),Widget->GetInteractionHint(),FString(TEXT("Clique para selecionar")));
 Widget->SetPointerPosition(FVector2D(150,330));TestTrue(TEXT("Desktop pointer focus"),Widget->IsControlHovered(100,310,510,58));
 Widget->SetSpatialPresentation(true,false,false,false,false,true);
 TestTrue(TEXT("Desktop controls remain usable in position mode"),Widget->IsControlHovered(100,310,510,58));
 Widget->SetSpatialPresentation(true,true,false,false,false,false);
 TestEqual(TEXT("Lost hand during drag asks to reacquire"),Widget->GetInteractionHint(),FString(TEXT("Mostre a mão direita para interagir")));
 Widget->SetSpatialPresentation(false,false,false,false,false,true);
 Widget->ClearPointer();TestFalse(TEXT("Leaving clears focus"),Widget->IsControlHovered(100,310,510,58));
 Widget->SetPointerPosition(FVector2D(150,330));Widget->TogglePanel();TestFalse(TEXT("Closed menu has no focus"),Widget->IsControlHovered(100,310,510,58));
 return true;
}
#endif
