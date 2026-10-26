// Gym streak maths. Weeks run Monday–Sunday in STREAK_TZ.
import { STREAK_TZ } from './config.js';

export const DEFAULT_GOAL = 3;

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const o = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday);
  return { y: +o.year, m: +o.month, d: +o.day, wd };
}
const key = (t) => new Date(t).toISOString().slice(0, 10);

export function dayKey(date = new Date(), tz = STREAK_TZ) {
  const p = parts(new Date(date), tz);
  return key(Date.UTC(p.y, p.m - 1, p.d));
}

export function weekKey(date = new Date(), tz = STREAK_TZ) {
  const p = parts(new Date(date), tz);
  return key(Date.UTC(p.y, p.m - 1, p.d - p.wd));
}

export function addDays(k, n) {
  const t = Date.parse(k + 'T00:00:00Z') + n * 86400000;
  return key(t);
}

export function daysLeftInWeek(date = new Date(), tz = STREAK_TZ) {
  return 6 - parts(date, tz).wd;
}

export function goalFor(wk, goals) {
  let g = DEFAULT_GOAL;
  for (const row of [...goals].sort((a, b) => (a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : (a.created_at < b.created_at ? -1 : 1)))) {
    if (row.effective_from <= wk) g = row.goal;
  }
  return g;
}

// posts: gym posts only ({ author, created_at }). members: [id, id].
export function computeStreak(posts, goals, members, now = new Date()) {
  const thisWeek = weekKey(now);
  const counts = new Map(); // week -> Map(member -> n)
  for (const p of posts) {
    const wk = weekKey(new Date(p.created_at));
    if (!counts.has(wk)) counts.set(wk, new Map());
    const m = counts.get(wk);
    m.set(p.author, (m.get(p.author) || 0) + 1);
  }
  const goal = goalFor(thisWeek, goals);
  const thisCounts = Object.fromEntries(members.map((id) => [id, (counts.get(thisWeek) && counts.get(thisWeek).get(id)) || 0]));
  const metWeek = (wk) => {
    const g = goalFor(wk, goals);
    const m = counts.get(wk);
    return !!m && members.every((id) => (m.get(id) || 0) >= g);
  };

  const weeks = [...counts.keys()].sort();
  let streak = 0, best = 0;
  if (weeks.length) {
    let run = 0;
    for (let wk = weeks[0]; wk < thisWeek; wk = addDays(wk, 7)) {
      run = metWeek(wk) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    streak = run;
  }
  const thisWeekDone = members.length > 0 && metWeek(thisWeek);
  const shown = streak + (thisWeekDone ? 1 : 0);
  best = Math.max(best, shown);
  return { streak: shown, best, goal, thisCounts, thisWeekDone, daysLeft: daysLeftInWeek(now) };
}

export function nextMonday(now = new Date()) {
  return addDays(weekKey(now), 7);
}
