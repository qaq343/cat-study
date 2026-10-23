// Read-only presentation: keep course completion and practice storage independent.
import { dateKey } from './core.js';
const safe = value => Math.max(0, Number(value) || 0);
export function learningRecords(progress, practice) {
  const entries = (progress.history || []).map(record => ({ ...record, kind: 'course', date: dateKey(new Date(record.endedAt)), time: record.endedAt, ms: safe(record.durationSeconds) * 1000 }));
  const append = (record, active = false) => {
    let segments = Object.entries(record.dailyMs || {}).filter(([, ms]) => Number(ms) > 0);
    if (!segments.length) segments = [[dateKey(new Date(record.endedAt || record.startedAt)), safe(record.elapsedMs)]];
    for (const [date, ms] of segments) entries.push({ ...record, kind: 'practice', date, time: dateKey(new Date(record.startedAt)) === date ? record.startedAt : null, sortTime: record.endedAt || record.startedAt, ms: safe(ms), active });
  };
  for (const record of practice?.history || []) append(record);
  if (practice?.active) append(practice.active, true);
  return entries.sort((a, b) => b.date.localeCompare(a.date) || String(b.time || b.sortTime || '').localeCompare(String(a.time || a.sortTime || '')));
}
export function learningDays(progress, practice) {
  const groups = new Map();
  for (const entry of learningRecords(progress, practice)) {
    if (!groups.has(entry.date)) groups.set(entry.date, { date: entry.date, entries: [], courseMs: 0, practiceMs: 0, lessons: new Set(), practiceCount: 0 });
    const group = groups.get(entry.date); group.entries.push(entry);
    if (entry.kind === 'course') { group.courseMs += entry.ms; group.lessons.add(entry.lessonId); }
    else { group.practiceMs += entry.ms; group.practiceCount++; }
  }
  return [...groups.values()].map(group => ({ ...group, completedLessons: group.lessons.size, totalMs: group.courseMs + group.practiceMs }));
}
export function learningTotals(progress, practice) {
  const courseMs = (progress.history || []).reduce((sum, record) => sum + safe(record.durationSeconds) * 1000, 0);
  const practiceMs = [...(practice?.history || []), ...(practice?.active ? [practice.active] : [])].reduce((sum, record) => sum + safe(record.elapsedMs), 0);
  return { courseMs, practiceMs, totalMs: courseMs + practiceMs };
}
export const recordDurationLabel = entry => entry.untimed && !entry.ms ? "未计时" : `${Math.round((entry.ms || 0) / 60000)} 分钟`;
