import { type Rng, pick } from '../core/rng';

/**
 * Signing in a player at the start of a session. Each kid has a registration card: their photo,
 * the squads it covers, and the date their subs are paid up to.
 */
export type Activity = 'u8' | 'u10' | 'u12';
export type Plan = 'U8s' | 'U10s' | 'U12s' | 'ALL SQUADS';
export const ACTIVITIES: Activity[] = ['u8', 'u10', 'u12'];
export const PLAN_COVERS: Record<Plan, Activity[]> = {
  U8s: ['u8'],
  U10s: ['u10'],
  U12s: ['u12'],
  'ALL SQUADS': ['u8', 'u10', 'u12'],
};

export interface MemberCard {
  /** No form at all ("My mum's got it in the car"). */
  missing: boolean;
  name: string;
  plan: Plan;
  /** Subs paid up to this date. */
  expires: Date;
  /** Portrait id shown on the card. Not the kid's own face when they've borrowed someone's card. */
  photo: string;
}

export interface MemberCheck {
  visitor: string;
  visitorName: string;
  activity: Activity;
  card: MemberCard;
  legit: boolean;
  /** Why it is not legit (for the result message). */
  problem: string | null;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * A kid at the sign-in table with a registration card. It is good when it is theirs (photo matches),
 * it covers the squad they want to train with, and their subs are paid up (the paid-until date has not passed).
 */
export function makeMemberCheck(rng: Rng, today: Date, legitChance: number, visitor: { id: string; name: string }, others: string[]): MemberCheck {
  const activity = pick(rng, ACTIVITIES);
  const plans = (Object.keys(PLAN_COVERS) as Plan[]).filter((p) => PLAN_COVERS[p].includes(activity));
  const good: MemberCard = { missing: false, name: visitor.name, plan: pick(rng, plans), expires: addDays(today, Math.floor(rng() * 200)), photo: visitor.id };
  const base = { visitor: visitor.id, visitorName: visitor.name, activity };
  if (rng() < legitChance) return { ...base, card: good, legit: true, problem: null };
  const kinds = ['expired', 'plan', 'none', ...(others.length ? ['photo'] : [])];
  const kind = pick(rng, kinds);
  if (kind === 'none') return { ...base, card: { ...good, missing: true }, legit: false, problem: 'No registration form' };
  if (kind === 'expired') return { ...base, card: { ...good, expires: addDays(today, -1 - Math.floor(rng() * 60)) }, legit: false, problem: "Subs haven't been paid" };
  if (kind === 'photo') return { ...base, card: { ...good, photo: pick(rng, others) }, legit: false, problem: "It's someone else's card" };
  const wrong = (Object.keys(PLAN_COVERS) as Plan[]).filter((p) => !PLAN_COVERS[p].includes(activity));
  return { ...base, card: { ...good, plan: pick(rng, wrong) }, legit: false, problem: `Not registered for the ${squadName(activity)}` };
}

/** True when Andy's call (let them train = true) matches the card. */
export function isCorrectDecision(c: MemberCheck, letIn: boolean): boolean {
  return letIn === c.legit;
}

/** Card check on its own (used by tests): can this kid train with this squad today? */
export function cardIsValid(card: MemberCard, visitor: string, activity: Activity, today: Date): boolean {
  if (card.missing || card.photo !== visitor) return false;
  if (!PLAN_COVERS[card.plan].includes(activity)) return false;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return card.expires.getTime() >= day.getTime();
}

export function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export const squadName = (a: Activity) => (a === 'u8' ? 'Under-8s' : a === 'u10' ? 'Under-10s' : 'Under-12s');
export const activityLabel = squadName;
