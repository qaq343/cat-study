// Independent practice records never mutate the course progress store.
export const PRACTICE_KEY = "cat-study.practice.v1";
// Both windows use the same state. A paused course must not mask active practice.
export function activityState(progress, practice) {
  const states = [progress?.activeSession?.state, practice?.active?.state];
  return states.includes("STUDYING") ? "STUDYING" : states.includes("PAUSED") ? "PAUSED" : "IDLE";
}
const day = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const createPractice = () => ({ version: 1, active: null, history: [] });
export function readPractice(storage) {
  const raw = storage.getItem(PRACTICE_KEY);
  if (!raw) return createPractice();
  const state = JSON.parse(raw);
  if (state?.version !== 1 || !Array.isArray(state.history) || (state.active && (!state.active.dailyMs || !Number.isFinite(state.active.elapsedMs)))) throw new Error("练习记录格式异常，已保留原记录，请先检查备份");
  return state;
}
export function loadPractice(storage) {
  const state = readPractice(storage);
  // Only stored checkpoints count. Time while closed is never added.
  if (state.active) { state.active.state = "PAUSED"; state.active.checkpointAt = null; }
  return state;
}
export function checkpointPractice(state, now = new Date()) {
  const active = state.active;
  if (active?.state !== "STUDYING") return false;
  let from = new Date(active.checkpointAt), until = +now, delta = until - from;
  // A suspended WebView/PC must not turn a long gap into practice time.
  if (!Number.isFinite(delta) || delta < 0 || delta > 300000) { active.state = "PAUSED"; active.checkpointAt = null; return true; }
  active.elapsedMs += delta;
  while (+from < until) {
    const midnight = new Date(from); midnight.setHours(24, 0, 0, 0);
    const end = Math.min(+midnight, until), key = day(from);
    active.dailyMs[key] = (active.dailyMs[key] || 0) + end - from;
    from = new Date(end);
  }
  active.checkpointAt = now.toISOString();
  return true;
}
export function startPractice(state, title, taskKey = null, now = new Date()) {
  if (state.active) {
    if (state.active.state === "STUDYING") return false;
    state.active.state = "STUDYING"; state.active.checkpointAt = now.toISOString(); return true;
  }
  state.active = { id: globalThis.crypto?.randomUUID?.() || `${+now}-${Math.random()}`, title: String(title || "自由练习").trim().slice(0, 120) || "自由练习", taskKey, startedAt: now.toISOString(), state: "STUDYING", checkpointAt: now.toISOString(), elapsedMs: 0, dailyMs: {} };
  return true;
}
export function pausePractice(state, now = new Date()) {
  if (state.active?.state !== "STUDYING") return false;
  checkpointPractice(state, now); state.active.state = "PAUSED"; state.active.checkpointAt = null; return true;
}
export function finishPractice(state, now = new Date()) {
  if (!state.active) return null;
  checkpointPractice(state, now);
  const { checkpointAt, state: status, ...active } = state.active;
  const record = { ...active, endedAt: now.toISOString(), durationSeconds: Math.round(active.elapsedMs / 1000) };
  state.history.unshift(record); state.active = null; return record;
}
export function practiceToday(state, now = new Date()) {
  const key = day(now), records = state.history.filter(record => (record.dailyMs?.[key] || 0) > 0);
  return { minutes: Math.round(([...state.history, ...(state.active ? [state.active] : [])].reduce((sum, record) => sum + (record.dailyMs?.[key] || 0), 0)) / 60000), records };
}
