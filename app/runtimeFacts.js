// Ephemeral device observations for the original Harness, on every platform.
// This supplies evidence to the model; it does not generate a canned answer.
export function clockObservation(input, {now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}) {
  const text=String(input||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!/\bque horas? (?:sao|e)\b|\b(?:hora|horario|data) atual\b|\b(?:que|qual) (?:dia|data) (?:e|de) hoje\b|\bdata de hoje\b/.test(text))return null;
  const local=new Intl.DateTimeFormat('pt-BR',{timeZone,dateStyle:'full',timeStyle:'long'}).format(now);
  return {source:'device-clock',observedAt:now.toISOString(),timeZone,local,
    block:`Observação atual do relógio do dispositivo (dado transitório, não memória): ${local}. Fuso: ${timeZone}. Instante UTC: ${now.toISOString()}. Para este pedido, use esta leitura em vez de horários citados no histórico; não invente acesso a sensores ou serviços.`};
}
