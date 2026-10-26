// Our Tree: tree types, growth, seasons and live weather.
import { LOCATIONS } from './config.js';
import { dayKey } from './streak.js';

export const TREES = {
  mango:     { label: 'Mango',     evergreen: true,  tender: true,  w: 10, h: 12, scale: 2, seasons: ['summer'], blossom: '#F3E6A8' },
  papaya:    { label: 'Papaya',    evergreen: true,  tender: true,  w: 10, h: 12, scale: 2, seasons: ['spring', 'summer', 'fall', 'winter'], blossom: null },
  jackfruit: { label: 'Jackfruit', evergreen: true,  tender: true,  w: 10, h: 11, scale: 3, seasons: ['summer'], blossom: null },
  apple:     { label: 'Apple',     evergreen: false, tender: false, w: 10, h: 13, scale: 2, seasons: ['fall'], blossom: '#FFFFFF' },
  cherry:    { label: 'Cherry',    evergreen: false, tender: false, w: 11, h: 13, scale: 2, seasons: ['summer'], blossom: '#F7B6C8' },
  lemon:     { label: 'Lemon',     evergreen: true,  tender: true,  w: 10, h: 13, scale: 2, seasons: ['winter', 'spring'], blossom: '#FFFFFF' },
  orange:    { label: 'Orange',    evergreen: true,  tender: true,  w: 9,  h: 14, scale: 2, seasons: ['winter'], blossom: '#FFFFFF' },
  banana:    { label: 'Banana',    evergreen: true,  tender: true,  w: 13, h: 9,  scale: 2, seasons: ['spring', 'summer', 'fall', 'winter'], blossom: null }
};

export const STAGES = ['Seed', 'Sprout', 'Sapling', 'Young', 'Grown', 'Fruiting'];
const STAGE_DAYS = [0, 3, 7, 14, 30, 50];

// Leafy sprites per stage (stage 4 and 5 use your tree at 3× and 4×).
export const LEAFY = [
  { src: 'assets/tree/tree1.png', w: 16, h: 12, s: 2 },
  { src: 'assets/tree/tree2.png', w: 34, h: 27, s: 2 },
  { src: 'assets/tree/tree3.png', w: 33, h: 38, s: 2 },
  { src: 'assets/tree/tree4.png', w: 50, h: 64, s: 2 },
  { src: 'assets/tree/tree-grown.png', w: 90, h: 95, s: 3 },
  { src: 'assets/tree/tree-grown.png', w: 90, h: 95, s: 4 }
];
export const BARE = [
  { src: 'assets/tree/bare1.png', w: 16, h: 8, s: 2 },
  { src: 'assets/tree/bare2.png', w: 16, h: 19, s: 2 },
  { src: 'assets/tree/bare3.png', w: 26, h: 28, s: 2 },
  { src: 'assets/tree/bare4.png', w: 44, h: 54, s: 2 },
  { src: 'assets/tree/bare5.png', w: 80, h: 122, s: 3 },
  { src: 'assets/tree/bare5.png', w: 80, h: 122, s: 3 }
];
// Fruit spots on the grown tree, in sprite pixels.
export const SPOTS = [[41, 10], [24, 18], [58, 18], [75, 25], [13, 30], [36, 28], [54, 36], [24, 42]];

export const FILTERS = {
  summer: 'none',
  spring: 'hue-rotate(-12deg) saturate(1.1) brightness(1.12)',
  fall: 'sepia(0.9) hue-rotate(-48deg) saturate(2.6) brightness(0.7)',
  fallmild: 'sepia(0.45) hue-rotate(-25deg) saturate(1.4) brightness(0.9)',
  resting: 'saturate(0.45) brightness(0.9)',
  bare: 'none'
};

export function stageFor(wateredDays) {
  let s = 0;
  STAGE_DAYS.forEach((d, i) => { if (wateredDays >= d) s = i; });
  return s;
}
export function daysToNextStage(wateredDays) {
  const next = STAGE_DAYS.find((d) => d > wateredDays);
  return next == null ? 0 : next - wateredDays;
}

// waterings: [{ user_id, day }]. Returns distinct days, today's waterers, droop.
export function wateringSummary(waterings, tz) {
  const days = [...new Set(waterings.map((w) => w.day))].sort();
  const today = dayKey(new Date(), tz);
  const todayBy = new Set(waterings.filter((w) => w.day === today).map((w) => w.user_id));
  let run = 0;
  for (let k = today; days.includes(k); k = shift(k, -1)) run++;
  if (!todayBy.size) { // a streak that ended yesterday is still alive today
    run = 0;
    for (let k = shift(today, -1); days.includes(k); k = shift(k, -1)) run++;
  }
  const lastDay = days[days.length - 1];
  const sinceLast = lastDay ? Math.round((Date.parse(today) - Date.parse(lastDay)) / 86400000) : Infinity;
  return { wateredDays: days.length, todayBy, run, drooping: days.length > 0 && sinceLast >= 2, today };
}
function shift(k, n) { return new Date(Date.parse(k + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

export function localMonth(tz, now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).format(now)) - 1;
}

export function dateLabel(tz, now = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(now);
}

// Season from the calendar, nudged by real weather where it matters.
export function seasonFor(locKey, weather, now = new Date()) {
  const loc = LOCATIONS[locKey];
  const m = localMonth(loc.tz, now);
  let s = m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'fall' : 'winter';
  if (loc.cold && weather) {
    if (m === 8 && weather.avgMin7 != null && weather.avgMin7 >= 50) s = 'summer';   // leaves wait for cold nights
    if ((m === 10 || m === 2) && weather.snowDepth > 0) s = 'winter';                 // early or late snow
  }
  return s;
}

// What the tree looks like for a type, place, season and growth stage.
export function look(kind, locKey, season, stage, weather) {
  const tree = TREES[kind] || TREES.apple;
  const cold = LOCATIONS[locKey].cold;
  let mode = 'summer', blossoms = false, ground = '#9CC07A', sky = '#DCEBF5', note = 'Full and green.';
  let snow = false;
  if (!tree.evergreen) {
    if (season === 'spring') { mode = 'spring'; blossoms = true; sky = '#E4F0E6'; note = 'New leaves and blossoms are coming out.'; }
    if (season === 'fall') {
      if (cold) { mode = 'fall'; sky = '#F3E6D6'; ground = '#8E8A4A'; note = 'Cold nights: the leaves are turning and dropping.'; }
      else { mode = 'fallmild'; sky = '#ECEEE6'; note = 'Mild fall: only a few leaves turn.'; }
    }
    if (season === 'winter') {
      mode = 'bare';
      if (cold) { sky = '#E3E7EB'; note = 'Bare branches. It rests until spring.'; } else { ground = '#A5C48A'; sky = '#E6ECF0'; note = 'Bare for a short, mild winter.'; }
    }
  } else {
    note = 'Stays green all year.';
    if (season === 'spring') { mode = 'spring'; blossoms = !!tree.blossom; sky = '#E4F0E6'; note = tree.blossom ? 'Flowering, with fresh leaves.' : 'Fresh leaves coming in.'; }
    if (cold && tree.tender && (season === 'fall' || season === 'winter')) {
      mode = 'resting'; sky = '#E6E9EC';
      note = `Too cold for a ${tree.label.toLowerCase()} tree outside here, so it rests until it warms up.`;
    }
  }
  if (cold && season === 'winter' && (!weather || weather.snowDepth > 0)) { ground = '#F5F5F2'; snow = true; }
  if (snow && mode === 'bare') note = 'Bare branches under the snow. It rests until spring.';
  const bare = mode === 'bare';
  const grown = stage === 5;
  if (!grown) blossoms = false;
  const fruiting = grown && !bare && mode !== 'resting' && tree.seasons.includes(season);
  if (fruiting) note += ' Fruit is ready to pick.';
  else if (grown && !bare && mode !== 'resting') note += ` ${tree.label} fruits in ${tree.seasons.join(' and ')}.`;
  const hillsSeason = cold ? (snow || season !== 'winter' ? season : 'fall') : ({ spring: 'spring', summer: 'fall', fall: 'fall', winter: 'spring' })[season];
  return { tree, mode, bare, blossoms, ground, sky, note, fruiting, snow, hills: 'assets/hills/' + hillsSeason + '.png' };
}

// Open-Meteo: free, no key. Cached for 30 minutes per place.
export async function getWeather(locKey) {
  const loc = LOCATIONS[locKey];
  const ck = 'sj-wx-' + locKey;
  try {
    const c = JSON.parse(sessionStorage.getItem(ck) || 'null');
    if (c && Date.now() - c.at < 30 * 60 * 1000) return c.data;
  } catch (e) {}
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
    '&current=temperature_2m,snow_depth,weather_code&daily=temperature_2m_min&past_days=7&forecast_days=1' +
    '&temperature_unit=fahrenheit&timezone=' + encodeURIComponent(loc.tz);
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  const mins = (j.daily && j.daily.temperature_2m_min || []).filter((v) => v != null);
  const data = {
    temp: Math.round(j.current.temperature_2m),
    snowDepth: j.current.snow_depth || 0,
    code: j.current.weather_code,
    avgMin7: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null
  };
  try { sessionStorage.setItem(ck, JSON.stringify({ at: Date.now(), data })); } catch (e) {}
  return data;
}
