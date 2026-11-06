import { type Rng, pick } from '../core/rng';

/** What a visitor wants to do today, and the membership plans that cover it. */
export type Activity = 'swim' | 'gym' | 'bowling';
export type Plan = 'SWIM' | 'GYM' | 'BOWLING' | 'ALL-IN';
export const ACTIVITIES: Activity[] = ['swim', 'gym', 'bowling'];
export const PLAN_COVERS: Record<Plan, Activity[]> = {
  SWIM: ['swim'],
  GYM: ['gym'],
  BOWLING: ['bowling'],
  'ALL-IN': ['swim', 'gym', 'bowling'],
};

export interface MemberCard {
  /** No card at all ("I left it in the car, honest"). */
  missing: boolean;
  name: string;
  plan: Plan;
  expires: Date;
  /** Portrait id shown on the card. Not the visitor's own face when they've borrowed someone's card. */
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
 * A visitor at reception with a membership card. A card is good when it is theirs (photo matches),
 * its plan covers what they want to do, and it has not expired (valid on its expiry date).
 */
export function makeMemberCheck(rng: Rng, today: Date, legitChance: number, visitor: { id: string; name: string }, others: string[]): MemberCheck {
  const activity = pick(rng, ACTIVITIES);
  const plans = (Object.keys(PLAN_COVERS) as Plan[]).filter((p) => PLAN_COVERS[p].includes(activity));
  const good: MemberCard = { missing: false, name: visitor.name, plan: pick(rng, plans), expires: addDays(today, Math.floor(rng() * 300)), photo: visitor.id };
  const base = { visitor: visitor.id, visitorName: visitor.name, activity };
  if (rng() < legitChance) return { ...base, card: good, legit: true, problem: null };
  const kinds = ['expired', 'plan', 'none', ...(others.length ? ['photo'] : [])];
  const kind = pick(rng, kinds);
  if (kind === 'none') return { ...base, card: { ...good, missing: true }, legit: false, problem: 'No card at all' };
  if (kind === 'expired') return { ...base, card: { ...good, expires: addDays(today, -1 - Math.floor(rng() * 60)) }, legit: false, problem: 'Membership has expired' };
  if (kind === 'photo') return { ...base, card: { ...good, photo: pick(rng, others) }, legit: false, problem: "It's someone else's card" };
  const wrong = (Object.keys(PLAN_COVERS) as Plan[]).filter((p) => !PLAN_COVERS[p].includes(activity));
  return { ...base, card: { ...good, plan: pick(rng, wrong) }, legit: false, problem: `Their plan doesn't cover ${activity === 'swim' ? 'swimming' : activity}` };
}

/** True when Andy's call (let them in = true) matches the card. */
export function isCorrectDecision(c: MemberCheck, letIn: boolean): boolean {
  return letIn === c.legit;
}

/** Card check on its own (used by tests): does this card let this person do this activity today? */
export function cardIsValid(card: MemberCard, visitor: string, activity: Activity, today: Date): boolean {
  if (card.missing || card.photo !== visitor) return false;
  if (!PLAN_COVERS[card.plan].includes(activity)) return false;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return card.expires.getTime() >= day.getTime();
}

export function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export const activityLabel = (a: Activity) => (a === 'swim' ? 'a swim' : a === 'gym' ? 'the gym' : 'a game of bowling');
