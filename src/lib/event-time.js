// Event wall-clock times are entered in Moscow, independently of server TZ.
export function parseEventTime(body) {
  const value = body.event_date && body.event_time
    ? `${body.event_date}T${body.event_time}`
    : String(body.starts_at || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return new Date(NaN);
  return new Date(`${value}+03:00`);
}
