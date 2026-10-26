// Public Supabase connection details. Both values are safe to publish:
// every table is locked down with row-level security (see supabase/schema.sql).
// Never put the service_role / secret key here.
export const SUPABASE_URL = 'https://hjzmdhcdeqyzsbarszox.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Dsh0X7CkWEpQjDJ_MPtSug_r3lDCZZL';

// Weather locations for Our Tree.
export const LOCATIONS = {
  ithaca: { label: 'Ithaca, NY', short: 'Ithaca', lat: 42.4440, lon: -76.5019, tz: 'America/New_York', cold: true },
  santaclara: { label: 'Santa Clara, CA', short: 'Santa Clara', lat: 37.3541, lon: -121.9552, tz: 'America/Los_Angeles', cold: false }
};

// Week boundaries for the gym streak use this time zone (Monday–Sunday).
export const STREAK_TZ = 'America/Los_Angeles';
