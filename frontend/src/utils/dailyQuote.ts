/**
 * Thought of the Day — a short quote shown after the opening video, before
 * the dashboard reveals. One quote per calendar day (day-of-year rotation),
 * deterministic so every device sees the same thought on the same day.
 *
 * Keep in sync with the QUOTES copy in index.html (the boot splash runs
 * before the bundle loads, so it can't import this file).
 */
export const DAILY_QUOTES: string[] = [
  "Today's small steps will become tomorrow's bigger steps.",
  'Great things are built one careful decision at a time.',
  'Progress is quiet work done consistently.',
  'The best time to start was yesterday. The next best time is now.',
  'Small details make big structures.',
  'Measure twice, build once.',
  'Every strong foundation begins with a clear plan.',
  'Discipline today builds confidence tomorrow.',
  'What you track, you improve.',
  'Clarity in numbers, confidence in decisions.',
  'A well-kept record is a well-run project.',
  'Slow is smooth, and smooth is fast.',
  'Done is better than perfect — but accurate is better than both.',
  'Good accounts tell the story of good work.',
  'Plan the work, then work the plan.',
  'Attention to detail today prevents corrections tomorrow.',
  'Every rupee accounted for is a project protected.',
  'Consistency compounds.',
  'The quiet routines are what hold big projects together.',
  'Order in the books, clarity on the site.',
  'Build carefully. Record faithfully.',
  "Today's ledger is tomorrow's history.",
  'Trust is built line by line, entry by entry.',
  'Strong projects run on clear numbers.',
];

export function getDailyQuote(date: Date = new Date()): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
}
