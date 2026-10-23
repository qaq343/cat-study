import { STORAGE_KEY, flattenCourses, pauseSession, setLessonCompleted } from './core.js';

export const NOTES_KEY = 'cat-study.lesson-notes.v1';
export const LEGACY_PLAN_KEY = 'cat-study.plan.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

export function readLessonNotes(storage) {
  const raw = storage.getItem(NOTES_KEY);
  const state = raw ? JSON.parse(raw) : { version: 1, lessons: {} };
  if (state.version !== 1 || !isObject(state.lessons)) throw new Error('课节备注格式异常，未覆盖原记录。');
  return state;
}

// Extract user-created notes/checkpoints before deleting only the obsolete plan.
export function removeLegacyPlan(storage) {
  const state = readLessonNotes(storage), raw = storage.getItem(LEGACY_PLAN_KEY);
  if (!raw) return state;
  const old = JSON.parse(raw);
  if (!isObject(old) || !isObject(old.lessonNotes)) throw new Error('旧计划记录异常，暂未清理，以免丢失课节备注或计时。');
  for (const [key, note] of Object.entries(old.lessonNotes)) {
    if (!isObject(note)) throw new Error('旧课节备注异常，未删除旧记录。');
    state.lessons[key] = { ...note, ...state.lessons[key] };
  }
  const encoded = JSON.stringify(state);
  storage.setItem(NOTES_KEY, encoded);
  if (storage.getItem(NOTES_KEY) !== encoded) throw new Error('课节备注保存未确认，旧计划仍保留。');
  storage.removeItem(LEGACY_PLAN_KEY);
  return state;
}

export function updateLessonNote(storage, key, patch) {
  const state = removeLegacyPlan(storage);
  state.lessons[key] = { ...state.lessons[key], ...clone(patch) };
  storage.setItem(NOTES_KEY, JSON.stringify(state));
  return state.lessons[key];
}

export function switchCourse(progress, courses, storage, nextKey, now = new Date()) {
  if (!flattenCourses(courses, { requiredOnly: true }).some(item => item.key === nextKey)) throw new Error('找不到这节必修课。');
  const notes = removeLegacyPlan(storage), oldSession = progress.activeSession;
  if (progress.currentLessonId === nextKey && oldSession?.lessonId === nextKey) return { changed: false };
  if (progress.currentLessonId === nextKey && !oldSession && !notes.lessons[nextKey]?.savedSession) return { changed: false };
  if (oldSession?.lessonId && oldSession.lessonId !== nextKey) {
    const temporary = { ...progress, activeSession: clone(oldSession) };
    pauseSession(temporary, now);
    notes.lessons[oldSession.lessonId] = { ...notes.lessons[oldSession.lessonId], savedSession: temporary.activeSession };
  }
  const saved = notes.lessons[nextKey]?.savedSession;
  const restored = oldSession?.lessonId === nextKey ? clone(oldSession) : saved ? { ...clone(saved), state: 'PAUSED', activeSegmentStartedAt: null } : null;
  // Keep both checkpoints in notes until the progress write is confirmed.
  storage.setItem(NOTES_KEY, JSON.stringify(notes));
  const next = { ...progress, currentLessonId: nextKey, activeSession: restored, celebrationEndsAt: null, updatedAt: now.toISOString() };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  Object.assign(progress, next);
  if (saved || notes.lessons[nextKey]?.skippedAt) {
    notes.lessons[nextKey] = { ...notes.lessons[nextKey], savedSession: null, skippedAt: null };
    storage.setItem(NOTES_KEY, JSON.stringify(notes));
  }
  return { changed: true, restored: Boolean(saved), savedPrevious: Boolean(oldSession && oldSession.lessonId !== nextKey) };
}

export function setCourseCompleted(progress, courses, storage, key, completed, now = new Date()) {
  const notes = readLessonNotes(storage), next = clone(progress);
  const result = setLessonCompleted(next, courses, key, completed, now, notes.lessons[key]?.savedSession);
  if (!result.changed) return result;
  // Commit progress first; never discard a parked timer on a failed write.
  const encoded = JSON.stringify(next);
  storage.setItem(STORAGE_KEY, encoded);
  if (storage.getItem(STORAGE_KEY) !== encoded) throw new Error('完成记录未保存，请重试。');
  Object.assign(progress, next);
  if (result.consumedSavedSession) {
    notes.lessons[key] = { ...notes.lessons[key], savedSession: null };
    try { storage.setItem(NOTES_KEY, JSON.stringify(notes)); }
    catch { return { ...result, warning: '完成已保存，暂存计时清理未成功，请不要重复完成本节。' }; }
  }
  return result;
}
