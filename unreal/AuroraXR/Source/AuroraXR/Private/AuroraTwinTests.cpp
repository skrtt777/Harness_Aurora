#include "AuroraTwin.h"
#include "Misc/AutomationTest.h"
#include "Serialization/JsonSerializer.h"
#if WITH_DEV_AUTOMATION_TESTS

namespace
{
    TSharedPtr<FJsonObject> Parse(const FString& Text){TSharedPtr<FJsonObject> J;FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text),J);return J;}
    // A CD with two units (the contract's shape, as the PC sends it).
    const TCHAR* Cd=TEXT(R"({"version":1,"kind":"operacao","title":"Operação dos CDs","glyph":"veiculo","placeLabel":"Doca",
      "stages":[{"key":"fila","label":"Pedido recebido"},{"key":"carregando","label":"Carregando"},{"key":"transito","label":"Em trânsito"}],
      "units":[{"name":"CD Betim","places":[{"name":"Doca 01","serving":["ABC-1"],"waiting":[]},{"name":"Doca 02","serving":[],"waiting":[]}],"queue":["DEF-2"],"road":["GHI-3"],"counts":{"total":3}},
               {"name":"CD Contagem","places":[{"name":"Doca 01","serving":["JKL-4","MNO-5"],"waiting":["PQR-6"]}],"queue":[],"road":[],"counts":{"total":3}}],
      "entities":[{"name":"ABC-1","status":"Carregando","where":"doca","unit":"CD Betim","late":false},{"name":"DEF-2","status":"Pedido recebido","where":"fila","unit":"CD Betim","late":false},
                  {"name":"GHI-3","status":"Em trânsito","where":"estrada","unit":"CD Betim","late":true},{"name":"JKL-4","status":"Carregando","where":"doca","unit":"CD Contagem"},
                  {"name":"MNO-5","status":"Carregando","where":"doca","unit":"CD Contagem"},{"name":"PQR-6","status":"Pedido recebido","where":"filalocal","unit":"CD Contagem"}],
      "numbers":{"Caminhões nas docas":"3"},"highlight":{"values":["Doca 02"],"note":"Doca 02 livre"},"notes":[{"when":"14:10","text":"ABC-1 entrou na Doca 01."}]})");
    int32 Count(const FAuroraTwinLayout& L,FAuroraTwinItem::EKind K){int32 N=0;for(const auto& I:L.Items)if(I.Kind==K)++N;return N;}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraTwinLayoutTest,"Aurora.Twin.Layout",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraTwinLayoutTest::RunTest(const FString&)
{
    const auto State=Parse(Cd);
    // The first unit by default: one truck per entity, every place, the seal counts them.
    const auto Betim=FAuroraTwinLayout::Build(State,FString());
    TestEqual(TEXT("unit"),Betim.Unit,FString(TEXT("CD Betim")));
    TestEqual(TEXT("units"),Betim.Units.Num(),2);
    TestEqual(TEXT("one vehicle per entity"),Count(Betim,FAuroraTwinItem::EKind::Vehicle),3);
    TestEqual(TEXT("every place"),Count(Betim,FAuroraTwinItem::EKind::Place),2);
    TestEqual(TEXT("drawn = total"),Betim.Drawn,Betim.Total);
    // A free place is green; the late truck red; the highlighted place carries the ring.
    for(const auto& I:Betim.Items){
        if(I.Kind==FAuroraTwinItem::EKind::Place&&I.Label==TEXT("Doca 02")){TestTrue(TEXT("free in green"),I.Color.G>I.Color.R);TestTrue(TEXT("highlighted"),I.bHighlight);}
        if(I.Label==TEXT("GHI-3"))TestTrue(TEXT("late in red"),I.Color.R>I.Color.B);
    }
    TestEqual(TEXT("note"),Betim.Note,FString(TEXT("Doca 02 livre")));
    TestEqual(TEXT("what changed"),Betim.Notes.Num(),1);
    // The other unit: its own entities only.
    const auto Contagem=FAuroraTwinLayout::Build(State,TEXT("CD Contagem"));
    TestEqual(TEXT("other unit"),Contagem.Unit,FString(TEXT("CD Contagem")));
    TestEqual(TEXT("its trucks"),Count(Contagem,FAuroraTwinItem::EKind::Vehicle),3);
    // No report open: nothing drawn, no crash.
    const auto Empty=FAuroraTwinLayout::Build(Parse(TEXT(R"({"version":1,"kind":"vazio","title":"Nenhum Power BI aberto pela Aurora","units":[]})")),FString());
    TestFalse(TEXT("not an operation"),Empty.bOperation);
    TestEqual(TEXT("nothing drawn"),Empty.Items.Num(),0);
    return true;
}
#endif
