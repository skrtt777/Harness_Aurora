// Ephemeral device observations for the original Harness, on every platform.
// This supplies evidence to the model; it does not generate a canned answer.
export function clockObservation(input, {now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}) {
  const text=String(input||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!/\bque horas? (?:sao|e)\b|\b(?:hora|horario|data) atual\b|\b(?:que|qual) (?:dia|data) (?:e|de) hoje\b|\bdata de hoje\b/.test(text))return null;
  const local=new Intl.DateTimeFormat('pt-BR',{timeZone,dateStyle:'full',timeStyle:'long'}).format(now);
  return {source:'device-clock',observedAt:now.toISOString(),timeZone,local,
    // Stated positively: a small model reads "do not invent access to sensors" as a cue to refuse.
    block:`Hora atual deste dispositivo: ${local} (fuso ${timeZone}). Para perguntas sobre hora ou data, responda com este valor; ele vale mais que horários citados no histórico.`};
}
