// Cardio maths: pace from time + distance, and approximate calories from body weight.
// Calories use MET values (Compendium of Physical Activities): kcal ≈ MET × kg × hours.
// MET already includes resting burn, so treat the number as a friendly estimate.

const KM_PER_MI = 1.609344;

// "3", "3 mi", "5k", "5 km", "2000 m", "1.5 miles" → { mi, km, unit } (no unit = miles)
export function parseDistance(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)\s*$/.exec(String(text || ''));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  if (!(n > 0)) return null;
  const u = m[2].toLowerCase();
  if (!u || /^(mi|mile|miles)$/.test(u)) return { mi: n, km: n * KM_PER_MI, unit: 'mi' };
  if (/^(k|km|kms|kilometers?|kilometres?)$/.test(u)) return { mi: n / KM_PER_MI, km: n, unit: 'km' };
  if (/^(m|meters?|metres?)$/.test(u)) return { mi: n / 1000 / KM_PER_MI, km: n / 1000, unit: 'km' };
  if (/^(yd|yds|yards?)$/.test(u)) return { mi: n / 1760, km: n / 1760 * KM_PER_MI, unit: 'mi' };
  return null;
}

// "25", "25:30", "1:05:00" → minutes
export function parseMinutes(text) {
  const t = String(text || '').trim();
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return parseFloat(t.replace(',', '.'));
  const p = t.split(':').map(Number);
  if (p.length === 2 && p.every((x) => x >= 0)) return p[0] + p[1] / 60;
  if (p.length === 3 && p.every((x) => x >= 0)) return p[0] * 60 + p[1] + p[2] / 60;
  return null;
}

// 9.75 → "9:45"
const mmss = (min) => { let m = Math.floor(min), s = Math.round((min - m) * 60); if (s === 60) { m += 1; s = 0; } return `${m}:${String(s).padStart(2, '0')}`; };

// Linear interpolation over [speed, MET] points.
function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return table[table.length - 1][1];
}
const RUN = [[4, 6.0], [5, 8.3], [5.2, 9.0], [6, 9.8], [6.7, 10.5], [7, 11.0], [7.5, 11.5], [8, 11.8], [8.6, 12.3], [9, 12.8], [10, 14.5], [11, 16.0], [12, 19.0], [13, 19.8], [14, 23.0]];
const WALK = [[2, 2.8], [2.5, 3.0], [3, 3.5], [3.5, 4.3], [4, 5.0], [4.5, 7.0], [5, 8.3]];
const BIKE = [[9.9, 4.0], [10, 6.8], [12, 8.0], [14, 10.0], [16, 12.0], [20, 15.8]];

// Which activity, from what was typed ("Run", "treadmill", "Peloton", "stairmaster"…)
export function activityOf(name) {
  const n = String(name || '').toLowerCase();
  if (/walk|stroll/.test(n)) return 'walk';
  if (/run|jog|treadmill|sprint|5k|10k|marathon/.test(n)) return 'run';
  if (/hik/.test(n)) return 'hike';
  if (/bik|cycl|spin|peloton|ride/.test(n)) return 'bike';
  if (/swim|lap/.test(n)) return 'swim';
  if (/stair|step ?mill|climber/.test(n)) return 'stairs';
  if (/ellip|cross ?train|arc/.test(n)) return 'elliptical';
  if (/row|erg/.test(n)) return 'row';
  if (/rope|skip/.test(n)) return 'rope';
  if (/hiit|circuit|tabata|boot ?camp|crossfit/.test(n)) return 'hiit';
  if (/danc|zumba/.test(n)) return 'dance';
  if (/yoga|stretch|pilates/.test(n)) return 'yoga';
  if (/tennis|badminton|pickle/.test(n)) return 'racket';
  if (/basket|soccer|football|volley/.test(n)) return 'sport';
  return 'other';
}

export function metFor(activity, mph) {
  switch (activity) {
    case 'run': return mph ? (mph < 4.2 ? interp(WALK, mph) : interp(RUN, mph)) : 9.8;
    case 'walk': return mph ? interp(WALK, mph) : 3.5;
    case 'hike': return 6.0;
    case 'bike': return mph ? interp(BIKE, mph) : 7.0; // no distance: indoor/spin
    case 'swim': return 6.0;
    case 'stairs': return 9.0;
    case 'elliptical': return 5.0;
    case 'row': return 7.0;
    case 'rope': return 11.0;
    case 'hiit': return 8.0;
    case 'dance': return 6.5;
    case 'yoga': return 2.5;
    case 'racket': return 7.0;
    case 'sport': return 7.0;
    default: return 6.0;
  }
}

// Everything for one cardio row. weight = { value, unit: 'lb' | 'kg' } (optional)
export function cardioStats({ name, minutes, distance }, weight) {
  const min = parseMinutes(minutes);
  const d = parseDistance(distance);
  const act = activityOf(name);
  const out = {};
  if (min && d) {
    out.mph = d.mi / (min / 60);
    if (act === 'bike') out.pace = d.unit === 'km' ? `${(d.km / (min / 60)).toFixed(1)} km/h` : `${out.mph.toFixed(1)} mph`;
    else if (act === 'row') out.pace = `${mmss(min / (d.km * 2))} /500m`;
    else out.pace = `${mmss(min / (d.unit === 'km' ? d.km : d.mi))} /${d.unit}`;
  }
  const kg = weight && weight.value > 0 ? (weight.unit === 'kg' ? weight.value : weight.value * 0.45359237) : null;
  if (min && kg) out.cal = Math.round(metFor(act, out.mph) * kg * (min / 60));
  return out;
}
