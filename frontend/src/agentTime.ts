import type { AgentTrigger } from './api';

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * When a scheduled agent works next, in words ("hoje às 08:00", "amanhã às 08:00", "qua às 08:00",
 * "em 25 min"). The same rule as the scheduler (agentScheduler.js scheduleDue).
 */
export function nextRunLabel(trigger: AgentTrigger, lastStart: string | null, now = new Date()): string | null {
  if (trigger.type !== 'schedule') return null;
  const last = lastStart ? new Date(lastStart) : null;
  if (trigger.everyMinutes) {
    const due = last ? new Date(last.getTime() + trigger.everyMinutes * 60_000) : now;
    const min = Math.ceil((due.getTime() - now.getTime()) / 60_000);
    return min <= 1 ? 'em instantes' : min < 120 ? `em ${min} min` : `às ${due.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const [h, m] = String(trigger.at || '').split(':').map(Number);
  const days = trigger.weekdays || [1, 2, 3, 4, 5];
  if (!Number.isInteger(h) || !Number.isInteger(m) || !days.length) return null;
  for (let d = 0; d <= 7; d += 1) {
    const at = new Date(now);
    at.setDate(now.getDate() + d);
    at.setHours(h, m, 0, 0);
    if (!days.includes(at.getDay())) continue;
    if (d === 0 && at <= now) { if (last && last >= at) continue; return 'em instantes'; }
    const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${d === 0 ? 'hoje' : d === 1 ? 'amanhã' : WEEKDAYS[at.getDay()].toLowerCase()} às ${hhmm}`;
  }
  return null;
}
