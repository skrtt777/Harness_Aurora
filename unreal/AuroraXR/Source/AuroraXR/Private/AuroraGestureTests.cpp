#include "AuroraMRPawn.h"
#include "Misc/AutomationTest.h"
#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraPinchTest,"Aurora.MR.PinchTrackingAndHysteresis",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraPinchTest::RunTest(const FString& Parameters)
{
    FAuroraPinch P;
    TestFalse(TEXT("Open hand"),P.Update(true,5));
    TestTrue(TEXT("Pinch starts"),P.Update(true,2));
    TestTrue(TEXT("Noise near threshold does not release"),P.Update(true,2.8f));
    TestFalse(TEXT("Tracking loss releases"),P.Update(false,0));
    TestFalse(TEXT("Reacquired hand in hysteresis band does not click"),P.Update(true,2.8f));
    TestFalse(TEXT("Reacquired pinched hand must open first"),P.Update(true,1.8f));
    TestFalse(TEXT("Open hand rearms"),P.Update(true,4));
    TestTrue(TEXT("New pinch"),P.Update(true,1.8f));
    TestFalse(TEXT("Open fingers release"),P.Update(true,4));
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAuroraSummonTest,"Aurora.MR.OpenHandHoldDoesNotToggle",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAuroraSummonTest::RunTest(const FString& Parameters)
{
    FAuroraSummonGesture G;
    int Fired=0;
    for (int I=0;I<10;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Brief gesture does not open"),Fired,0);
    for (int I=0;I<40;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Sustained gesture fires once"),Fired,1);
    for (int I=0;I<10;++I) Fired+=G.Update(false,false,.05f);
    for (int I=0;I<30;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Tracking loss and reacquisition do not retrigger"),Fired,1);
    for (int I=0;I<6;++I) Fired+=G.Update(true,false,.05f);
    for (int I=0;I<30;++I) Fired+=G.Update(true,true,.05f);
    TestEqual(TEXT("Deliberately reset pose can summon again"),Fired,2);
    return true;
}
#endif
