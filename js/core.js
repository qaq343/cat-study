export const STORAGE_KEY = "cat-study.progress.v1";
export const CURRENT_KEY = "5:1:1.18";
export const DEFAULT_GOAL = 6;
export const SESSION_STATES = Object.freeze({ IDLE: "IDLE", STUDYING: "STUDYING", PAUSED: "PAUSED" });

export const lessonKey = (stage, chapter, lesson) => `${stage.stageId}:${chapter.chapterId}:${lesson.id}`;

export function flattenCourses(courses, { requiredOnly = false } = {}) {
  const rows = [];
  for (const stage of courses) {
    const required = stage.stageId >= 1 && stage.stageId <= 9 && !stage.optional;
    if (requiredOnly && !required) continue;
    for (const chapter of stage.chapters) for (const lesson of chapter.lessons) rows.push({
      key: lessonKey(stage, chapter, lesson), stageId: stage.stageId, stageName: stage.stageName,
      chapterId: chapter.chapterId, chapterName: chapter.chapterName, lessonId: lesson.id,
      lessonName: lesson.name, required, optional: Boolean(stage.optional),
    });
  }
  return rows;
}

export function createInitialProgress(courses, now = new Date()) {
  const required = flattenCourses(courses, { requiredOnly: true });
  const currentIndex = required.findIndex((lesson) => lesson.key === CURRENT_KEY);
  if (currentIndex < 0) throw new Error("找不到初始课程：阶段五 / flask框架 / 数据库-操作");
  return {
    version: 2, currentLessonId: CURRENT_KEY,
    completedLessonIds: required.slice(0, currentIndex).map((lesson) => lesson.key),
    history: [], dailyRecords: {}, activeSession: null, celebrationEndsAt: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), currentDailyGoal: DEFAULT_GOAL,
    settings: { dailyGoal: DEFAULT_GOAL, soundEnabled: true, volume: 0.35, sideCatEnabled: true, encouragementEnabled: true },
  };
}

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function ensureToday(progress, now = new Date()) {
  const key = dateKey(now);
  if (!progress.dailyRecords[key]) progress.dailyRecords[key] = {
    date: key, goal: Number(progress.settings.dailyGoal) || DEFAULT_GOAL,
    completedCount: 0, completedLessonIds: [], sessions: [],
  };
  progress.currentDailyGoal = progress.dailyRecords[key].goal;
  return progress.dailyRecords[key];
}

export function updateDailyGoal(progress, goal, now = new Date()) {
  const safeGoal = Math.max(1, Math.min(50, Math.round(Number(goal) || DEFAULT_GOAL)));
  progress.settings.dailyGoal = safeGoal;
  const today = ensureToday(progress, now); today.goal = safeGoal;
  progress.currentDailyGoal = safeGoal; progress.updatedAt = now.toISOString();
  return safeGoal;
}

export function startSession(progress, now = new Date()) {
  if (!progress.currentLessonId) return false;
  if (progress.activeSession?.lessonId === progress.currentLessonId) {
    if (progress.activeSession.state === SESSION_STATES.PAUSED) return resumeSession(progress, now);
    return true;
  }
  progress.activeSession = {
    lessonId: progress.currentLessonId,
    state: SESSION_STATES.STUDYING,
    startedAt: now.toISOString(),
    activeElapsedMs: 0,
    activeSegmentStartedAt: now.toISOString(),
    pausedAt: null,
  };
  progress.updatedAt = now.toISOString(); return true;
}

export function sessionState(progress) {
  return progress.activeSession?.state === SESSION_STATES.STUDYING || progress.activeSession?.state === SESSION_STATES.PAUSED
    ? progress.activeSession.state : SESSION_STATES.IDLE;
}

export function checkpointSession(progress, now = new Date()) {
  const session = progress.activeSession;
  if (!session || session.state !== SESSION_STATES.STUDYING || !session.activeSegmentStartedAt) return 0;
  const elapsed = Math.max(0, now - new Date(session.activeSegmentStartedAt));
  session.activeElapsedMs = Math.max(0, Number(session.activeElapsedMs) || 0) + elapsed;
  session.activeSegmentStartedAt = now.toISOString();
  progress.updatedAt = now.toISOString();
  return elapsed;
}

export function pauseSession(progress, now = new Date()) {
  if (sessionState(progress) !== SESSION_STATES.STUDYING) return false;
  checkpointSession(progress, now);
  progress.activeSession.state = SESSION_STATES.PAUSED;
  progress.activeSession.activeSegmentStartedAt = null;
  progress.activeSession.pausedAt = now.toISOString();
  progress.updatedAt = now.toISOString();
  return true;
}

export function resumeSession(progress, now = new Date()) {
  if (sessionState(progress) !== SESSION_STATES.PAUSED) return false;
  progress.activeSession.state = SESSION_STATES.STUDYING;
  progress.activeSession.activeSegmentStartedAt = now.toISOString();
  progress.activeSession.pausedAt = null;
  progress.updatedAt = now.toISOString();
  return true;
}

export function recoverInterruptedSession(progress, now = new Date()) {
  if (sessionState(progress) !== SESSION_STATES.STUDYING) return false;
  progress.activeSession.state = SESSION_STATES.PAUSED;
  progress.activeSession.activeSegmentStartedAt = null;
  progress.activeSession.pausedAt = now.toISOString();
  progress.updatedAt = now.toISOString();
  return true;
}

export function completeCurrentLesson(progress, courses, now = new Date()) {
  const required = flattenCourses(courses, { requiredOnly: true });
  const current = progress.currentLessonId;
  const index = required.findIndex((lesson) => lesson.key === current);
  if (index < 0) return { completed: false, reason: "missing-current" };
  if (progress.celebrationEndsAt && new Date(progress.celebrationEndsAt) > now) return { completed: false, reason: "celebrating" };
  if (!progress.activeSession || progress.activeSession.lessonId !== current) return { completed: false, reason: "no-active-session" };
  if (progress.activeSession.state === SESSION_STATES.STUDYING) checkpointSession(progress, now);
  if (!progress.completedLessonIds.includes(current)) progress.completedLessonIds.push(current);
  const endedAt = now.toISOString(), startedAt = progress.activeSession.startedAt;
  const durationSeconds = Math.max(0, Math.round((Number(progress.activeSession.activeElapsedMs) || 0) / 1000));
  const recordId = `${current}|${startedAt}|${endedAt}`;
  const record = { recordId, lessonId: current, startedAt, endedAt, durationSeconds };
  progress.history.unshift(record);
  const today = ensureToday(progress, now);
  if (!today.completedLessonIds.includes(current)) { today.completedLessonIds.push(current); today.completedCount += 1; today.sessions.push(record); }
  progress.currentLessonId = required[index + 1]?.key ?? null;
  progress.activeSession = null; progress.celebrationEndsAt = new Date(now.getTime() + 20_000).toISOString(); progress.updatedAt = endedAt;
  return { completed: true, lesson: required[index], next: required[index + 1] ?? null, durationSeconds };
}

export function tapMuyu(progress, courses, now = new Date()) {
  if (progress.celebrationEndsAt && new Date(progress.celebrationEndsAt) > now) return { celebration: true, completed: false };
  return completeCurrentLesson(progress, courses, now);
}

// The course-tree checkbox is also a completion action, even without a timer.
export function setLessonCompleted(progress, courses, key, completed, now = new Date(), savedSession = null) {
  if (!flattenCourses(courses, { requiredOnly: true }).some(lesson => lesson.key === key)) throw new Error("找不到这节必修课。");
  const wasCompleted = progress.completedLessonIds.includes(key);
  if (wasCompleted === completed) return { changed: false };
  const todayKey = dateKey(now);
  const isToday = record => dateKey(new Date(record.endedAt)) === todayKey;
  if (!completed) {
    progress.completedLessonIds = progress.completedLessonIds.filter(id => id !== key);
    // Undo only today's untimed checkbox entry, never an older/timed study record.
    const removable = record => record.lessonId === key && record.completionSource === "manual" && record.untimed === true && !record.durationSeconds && isToday(record);
    const removed = progress.history.some(removable);
    progress.history = progress.history.filter(record => !removable(record));
    const day = progress.dailyRecords[todayKey];
    if (removed && day) {
      day.sessions = (day.sessions || []).filter(record => !removable(record));
      if (!progress.history.some(record => record.lessonId === key && isToday(record)) && !day.sessions.some(record => record.lessonId === key)) {
        day.completedLessonIds = day.completedLessonIds.filter(id => id !== key);
        day.completedCount = Math.max(0, (Number(day.completedCount) || 0) - 1);
      }
    }
    progress.updatedAt = now.toISOString();
    return { changed: true, completed: false, removedUntimed: removed };
  }
  const active = progress.activeSession?.lessonId === key ? progress.activeSession : null;
  if (active?.state === SESSION_STATES.STUDYING) checkpointSession(progress, now);
  const session = active || (savedSession?.lessonId === key ? savedSession : null);
  // Rechecking an already recorded lesson must not duplicate the same day's entry.
  let record = !session ? progress.history.find(item => item.lessonId === key && isToday(item)) : null;
  if (!record) {
    const endedAt = now.toISOString(), startedAt = session?.startedAt || null;
    record = {
      recordId: `manual|${key}|${endedAt}`, lessonId: key, startedAt, endedAt,
      durationSeconds: session ? Math.max(0, Math.round((Number(session.activeElapsedMs) || 0) / 1000)) : 0,
      completionSource: "manual", ...(!session ? { untimed: true } : {}),
    };
    progress.history.unshift(record);
  }
  progress.completedLessonIds.push(key);
  const today = ensureToday(progress, now);
  if (!today.completedLessonIds.includes(key)) { today.completedLessonIds.push(key); today.completedCount += 1; }
  if (!today.sessions.some(item => item.recordId === record.recordId)) today.sessions.push(record);
  if (active) progress.activeSession = null;
  progress.updatedAt = now.toISOString();
  return { changed: true, completed: true, record, consumedSavedSession: !active && Boolean(session) };
}

export function metrics(progress, courses, now = new Date()) {
  const required = flattenCourses(courses, { requiredOnly: true }), completedSet = new Set(progress.completedLessonIds);
  const completed = required.filter((lesson) => completedSet.has(lesson.key)).length, today = ensureToday(progress, now);
  return { total: required.length, completed, remaining: Math.max(0, required.length - completed), percent: required.length ? completed / required.length * 100 : 0, todayCompleted: today.completedCount, todayGoal: today.goal };
}

const addDays = (date, days) => { const result = new Date(date); result.setDate(result.getDate() + Math.max(0, Math.ceil(days))); return result; };
export const formatDate = (date) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);

export function predictions(progress, courses, now = new Date()) {
  const { remaining } = metrics(progress, courses, now);
  const firstDate = progress.createdAt ? dateKey(new Date(progress.createdAt)) : Object.keys(progress.dailyRecords).filter(Boolean).sort()[0];
  const availableDays = firstDate ? Math.max(1, Math.floor((new Date(dateKey(now)) - new Date(firstDate)) / 86400000) + 1) : 0;
  const dayCount = Math.min(7, availableDays || 7);
  const records = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - index);
    const key = dateKey(date); return progress.dailyRecords[key]?.completedCount || 0;
  });
  const actualRate = records.length ? records.reduce((sum, count) => sum + count, 0) / records.length : 0;
  const goal = Number(progress.settings.dailyGoal) || DEFAULT_GOAL;
  const predict = (rate) => rate > 0 ? formatDate(addDays(now, remaining / rate)) : "暂无足够记录";
  return { actualRate, actualDays: dayCount, actualDate: predict(actualRate), goal, goalDate: predict(goal), stretchRate: goal + 1, stretchDate: predict(goal + 1) };
}

export function reconcileProgress(progress, courses, now = new Date()) {
  migrateProgress(progress, now);
  const required = flattenCourses(courses, { requiredOnly: true }), valid = new Set(required.map((lesson) => lesson.key));
  progress.completedLessonIds = [...new Set(progress.completedLessonIds)].filter((id) => valid.has(id));
  if (progress.currentLessonId && !valid.has(progress.currentLessonId)) progress.currentLessonId = required.find((lesson) => !progress.completedLessonIds.includes(lesson.key))?.key ?? null;
  ensureToday(progress, now); return progress;
}

function recordId(record) { return record.recordId || `${record.lessonId}|${record.startedAt}|${record.endedAt}`; }

export function migrateProgress(progress, now = new Date()) {
  progress.history = Array.isArray(progress.history) ? progress.history : [];
  progress.dailyRecords = progress.dailyRecords && typeof progress.dailyRecords === "object" ? progress.dailyRecords : {};
  progress.completedLessonIds = Array.isArray(progress.completedLessonIds) ? progress.completedLessonIds : [];
  for (const record of progress.history) record.recordId = recordId(record);
  for (const day of Object.values(progress.dailyRecords)) {
    day.sessions = Array.isArray(day.sessions) ? day.sessions : [];
    for (const record of day.sessions) record.recordId = recordId(record);
  }
  if (progress.activeSession) {
    const old = progress.activeSession;
    progress.activeSession = {
      lessonId: old.lessonId || progress.currentLessonId,
      state: old.state === SESSION_STATES.PAUSED ? SESSION_STATES.PAUSED : old.state === SESSION_STATES.STUDYING ? SESSION_STATES.STUDYING : SESSION_STATES.PAUSED,
      startedAt: old.startedAt || now.toISOString(),
      activeElapsedMs: Math.max(0, Number(old.activeElapsedMs) || 0),
      activeSegmentStartedAt: old.state === SESSION_STATES.STUDYING ? (old.activeSegmentStartedAt || old.startedAt || now.toISOString()) : null,
      pausedAt: old.state === SESSION_STATES.PAUSED ? (old.pausedAt || now.toISOString()) : null,
    };
  }
  progress.version = 2;
  return progress;
}

export function updateHistoryDuration(progress, targetRecordId, minutes, now = new Date()) {
  const safeMinutes = Number(minutes);
  if (!Number.isInteger(safeMinutes) || safeMinutes < 0 || safeMinutes > 24 * 60) return false;
  const record = progress.history.find((item) => recordId(item) === targetRecordId);
  if (!record) return false;
  record.recordId = recordId(record);
  record.durationSeconds = safeMinutes * 60;
  if (record.untimed) record.untimed = false;
  for (const day of Object.values(progress.dailyRecords)) {
    for (const session of day.sessions || []) {
      if (recordId(session) === targetRecordId) {
        session.recordId = targetRecordId;
        session.durationSeconds = record.durationSeconds;
        if (session.untimed) session.untimed = false;
      }
    }
  }
  progress.updatedAt = now.toISOString();
  return true;
}
