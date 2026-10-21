// The Zeladora's legs, as plain numbers (no drawing): each foot stands on a real memory near where that leg
// reaches, and steps to another one — alternate legs, a lifted arc — when she has moved on. Kept apart from the
// scene so it can be tested: whatever she does, a foot is never left far behind.
import type { Vec3 } from "./layout";

export type Leg = { foot: Vec3; from: Vec3; to: Vec3; stepAt: number; on: string | null };
export type Nearest = (x: number, y: number, radius: number, taken: Set<string>) => { id: string; p: Vec3 } | null;
export type LegOptions = { count: number; reach: number; stepMs: number; maxStepping: number; lift: number };
export const LEG_DEFAULTS: LegOptions = { count: 16, reach: 24, stepMs: 190, maxStepping: 8, lift: 5 };

/** Where leg i would like to stand, for a body at `center` heading `heading` (radians). */
export function idealFoot(i: number, center: Vec3, heading: number, o: LegOptions = LEG_DEFAULTS): Vec3 {
  const ang = (i / o.count) * Math.PI * 2 + heading;
  return [center[0] + Math.cos(ang) * o.reach, center[1] + Math.sin(ang) * o.reach * 1.1, center[2]];
}

/**
 * One frame: finishes the steps that are done, starts new ones for legs left too far from where they would
 * stand (alternate legs first; a leg far behind steps anyway, and one very far is put back at once), and
 * returns where each foot is now (mid-step feet travel in a lifted arc).
 */
export function stepLegs(legs: Leg[], center: Vec3, heading: number, now: number, nearest: Nearest, o: LegOptions = LEG_DEFAULTS, velocity: Vec3 = [0, 0, 0]): Vec3[] {
  // A step aims a little ahead of where she is going (where the body will be when the foot lands).
  const lead = (o.stepMs / 1000) * 1.5;
  while (legs.length < o.count) legs.push({ foot: [...center] as Vec3, from: [...center] as Vec3, to: [...center] as Vec3, stepAt: -1, on: null });
  const taken = new Set<string>();
  for (const leg of legs) if (leg.on) taken.add(leg.on);
  const gait = Math.floor(now / o.stepMs) % 2;
  let stepping = 0;
  for (const leg of legs) {
    if (leg.stepAt >= 0 && now - leg.stepAt >= o.stepMs) { leg.foot = [...leg.to] as Vec3; leg.stepAt = -2; }
    if (leg.stepAt >= 0) stepping += 1;
  }
  const feet: Vec3[] = [];
  legs.forEach((leg, i) => {
    const ideal = idealFoot(i, [center[0] + velocity[0] * lead, center[1] + velocity[1] * lead, center[2]], heading, o);
    const resting = leg.stepAt < 0;
    const off = Math.hypot(leg.foot[0] - ideal[0], leg.foot[1] - ideal[1]);
    const plant = () => {
      if (leg.on) taken.delete(leg.on);
      const spot = nearest(ideal[0], ideal[1], o.reach * 0.55, taken);
      if (spot) { leg.to = [...spot.p] as Vec3; leg.on = spot.id; taken.add(spot.id); } else { leg.to = ideal; leg.on = null; }
    };
    if (resting && off > o.reach * 2.2) {
      // Far behind (she ran, or just appeared): the foot is put back at once.
      plant(); leg.foot = [...leg.to] as Vec3; leg.from = [...leg.to] as Vec3; leg.stepAt = -2;
    } else if (resting && (off > o.reach * 0.62 || leg.stepAt === -1) && (i % 2 === gait || off > o.reach * 1.3) && stepping < o.maxStepping) {
      leg.from = [...leg.foot] as Vec3; plant(); leg.stepAt = now; stepping += 1;
    }
    if (leg.stepAt >= 0) {
      const u = Math.min(1, (now - leg.stepAt) / o.stepMs);
      leg.foot = [leg.from[0] + (leg.to[0] - leg.from[0]) * u, leg.from[1] + (leg.to[1] - leg.from[1]) * u, leg.from[2] + (leg.to[2] - leg.from[2]) * u + Math.sin(Math.PI * u) * o.lift];
    }
    feet.push(leg.foot);
  });
  return feet;
}
