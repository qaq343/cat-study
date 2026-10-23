import { STORAGE_KEY, createInitialProgress, reconcileProgress, recoverInterruptedSession } from "./core.js";

const RUNTIME_KEY = "cat-study.runtime.v1";

export async function loadCourses() {
  const response = await fetch("./data/courses.json");
  if (!response.ok) throw new Error("课程数据加载失败");
  return response.json();
}

export async function loadProgress(courses) {
  let progress;
  try { progress = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { progress = null; }
  if (!progress) {
    try { const response = await fetch("./data/progress.json"); progress = response.ok ? await response.json() : createInitialProgress(courses); }
    catch { progress = createInitialProgress(courses); }
  }
  reconcileProgress(progress, courses);
  if (!sessionStorage.getItem(RUNTIME_KEY)) {
    recoverInterruptedSession(progress);
    sessionStorage.setItem(RUNTIME_KEY, crypto.randomUUID?.() || String(Date.now()));
  }
  saveProgress(progress); return progress;
}

export const saveProgress = (progress) => localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
export function readStoredProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

export function exportProgress(progress) {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" }), link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = `cat-study-progress-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
}

export async function importProgress(file, courses) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.completedLessonIds) || !data.settings) throw new Error("不是有效的小猫学习进度文件");
  reconcileProgress(data, courses);
  recoverInterruptedSession(data);
  saveProgress(data);
  return data;
}

export function resetProgress(courses) { const progress = createInitialProgress(courses); saveProgress(progress); return progress; }
