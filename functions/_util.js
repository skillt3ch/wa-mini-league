// Shared helpers for D1 date/time handling.
//
// D1 TEXT columns populated via SQLite's datetime('now') (submitted_at,
// created_at, ...) come back as "YYYY-MM-DD HH:MM:SS" — space-separated,
// implicitly UTC, no timezone marker. Browsers commonly parse that exact
// shape as *local* time rather than UTC (new Date() is only guaranteed to
// parse full ISO 8601), which silently shifts every relative/absolute time
// display by the viewer's UTC offset. Some fields (e.g. a replay's parsed
// in-game date) already arrive as proper ISO strings with a 'Z' from the
// client. This normalizes either shape into an unambiguous ISO string
// before it ever reaches JSON, so nothing downstream has to know or
// remember which raw format a given column uses.
export function toIsoUtc(dbTimestamp) {
  if (!dbTimestamp) return null;
  if (/[Zz]|[+-]\d\d:\d\d$/.test(dbTimestamp)) return dbTimestamp; // already unambiguous
  return dbTimestamp.replace(' ', 'T') + 'Z';
}
