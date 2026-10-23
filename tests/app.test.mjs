import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SESSION_STATES, checkpointSession, createInitialProgress, dateKey, flattenCourses, metrics, migrateProgress, pauseSession, predictions, recoverInterruptedSession, resumeSession, sessionState, startSession, tapMuyu, updateDailyGoal, updateHistoryDuration } from "../js/core.js";

const courses = JSON.parse(await readFile(new URL("../data/courses.json", import.meta.url), "utf8"));
const required = flattenCourses(courses, { requiredOnly: true });
assert.equal(required.length, 504, "正式必修必须只统计阶段 1–9");
assert.equal(flattenCourses(courses).filter((lesson) => lesson.stageId === 0).length, 23, "前置阶段存在但不计必修");
assert.equal(flattenCourses(courses).filter((lesson) => lesson.stageId === 10).length, 126, "阶段 10 更新为126节但仍不计必修");
assert.equal(flattenCourses(courses).filter((lesson) => lesson.stageId === 11).length, 55, "阶段 11 新增55节但不改原必修口径");

const start = new Date("2026-08-13T09:00:00+08:00");
const progress = createInitialProgress(courses, start);
assert.equal(progress.currentLessonId, "5:1:1.18");
assert.equal(progress.completedLessonIds.length, 125);
assert.equal(metrics(progress, courses, start).remaining, 379);

assert.equal(startSession(progress, start), true);
assert.equal(sessionState(progress), SESSION_STATES.STUDYING);
assert.equal(pauseSession(progress, new Date("2026-08-13T09:20:00+08:00")), true);
assert.equal(sessionState(progress), SESSION_STATES.PAUSED);
assert.equal(resumeSession(progress, new Date("2026-08-13T10:20:00+08:00")), true);
checkpointSession(progress, new Date("2026-08-13T10:35:00+08:00"));
const finish = new Date("2026-08-13T10:35:00+08:00");
const first = tapMuyu(progress, courses, finish);
assert.equal(first.completed, true);
assert.equal(first.lesson.lessonName, "数据库-操作");
assert.equal(first.durationSeconds, 2100, "暂停 60 分钟不能计入，最终应为 35 分钟");
assert.equal(progress.completedLessonIds.length, 126);
assert.equal(progress.currentLessonId, "5:2:2.1");
assert.equal(progress.dailyRecords[dateKey(finish)].completedCount, 1);

for (let i = 0; i < 20; i++) {
  const repeated = tapMuyu(progress, courses, new Date(finish.getTime() + 500 + i * 500));
  assert.equal(repeated.completed, false, "庆祝期敲击不能重复完成课程");
}
assert.equal(progress.completedLessonIds.length, 126);
assert.equal(progress.dailyRecords[dateKey(finish)].completedCount, 1);

progress.dailyRecords["2026-08-12"] = { date: "2026-08-12", goal: 6, completedCount: 3, completedLessonIds: [], sessions: [] };
updateDailyGoal(progress, 5, finish);
assert.equal(progress.dailyRecords["2026-08-12"].goal, 6, "历史日期目标不可被新设置覆盖");
assert.equal(progress.dailyRecords["2026-08-13"].goal, 5);
const forecast = predictions(progress, courses, finish);
assert.equal(forecast.goal, 5);
assert.ok(forecast.goalDate.includes("2026年"));

const legacy = createInitialProgress(courses, start);
legacy.version = 1;
legacy.activeSession = { lessonId: legacy.currentLessonId, startedAt: start.toISOString() };
migrateProgress(legacy, new Date("2026-08-13T12:00:00+08:00"));
assert.equal(legacy.version, 2);
assert.equal(sessionState(legacy), SESSION_STATES.PAUSED, "旧 session 必须安全迁移为暂停");
legacy.activeSession.state = SESSION_STATES.STUDYING;
legacy.activeSession.activeElapsedMs = 45_000;
legacy.activeSession.activeSegmentStartedAt = new Date("2026-08-13T12:00:00+08:00").toISOString();
recoverInterruptedSession(legacy, new Date("2026-08-14T12:00:00+08:00"));
assert.equal(legacy.activeSession.activeElapsedMs, 45_000, "关闭期间不能偷偷累加");
assert.equal(sessionState(legacy), SESSION_STATES.PAUSED);

const beforeCompleted = progress.completedLessonIds.length;
const targetRecord = progress.history[0];
assert.equal(updateHistoryDuration(progress, targetRecord.recordId, 28), true);
assert.equal(progress.history[0].durationSeconds, 1680);
assert.equal(progress.completedLessonIds.length, beforeCompleted, "修改时长不能改变完成进度");
assert.equal(updateHistoryDuration(progress, targetRecord.recordId, -1), false);

console.log("✓ 课程范围、暂停计时、退出恢复、单次完成、庆祝防重复、历史时长修正和预测均通过");
