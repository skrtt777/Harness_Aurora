#pragma once
#include "CoreMinimal.h"

enum class EAuroraVoiceCommand { None, Stop, Repeat, Help };

// Match a whole short command, so quoted words in normal requests do not cancel a turn.
inline EAuroraVoiceCommand AuroraVoiceCommand(FString Text)
{
    Text=Text.ToLower();
    for(const TCHAR* Mark:{TEXT("."),TEXT(","),TEXT("!"),TEXT("?"),TEXT(":"),TEXT(";")})Text.ReplaceInline(Mark,TEXT(" "));
    TArray<FString> Words;Text.ParseIntoArrayWS(Words);Text=FString::Join(Words,TEXT(" "));
    if(Text.StartsWith(TEXT("aurora ")))Text.RightChopInline(7);
    if(Text==TEXT("pare")||Text==TEXT("parar")||Text==TEXT("parar conversa")||Text==TEXT("pare de falar")||Text==TEXT("cancelar resposta")||Text==TEXT("cancele a resposta")||Text==TEXT("silêncio")||Text==TEXT("silencio"))return EAuroraVoiceCommand::Stop;
    if(Text==TEXT("repita")||Text==TEXT("repetir resposta")||Text==TEXT("repita a resposta"))return EAuroraVoiceCommand::Repeat;
    if(Text==TEXT("ajuda")||Text==TEXT("como usar")||Text==TEXT("comandos de voz"))return EAuroraVoiceCommand::Help;
    return EAuroraVoiceCommand::None;
}
