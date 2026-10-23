import { SESSION_STATES, checkpointSession, dateKey, flattenCourses, formatDate, metrics, pauseSession, predictions, resumeSession, sessionState, updateDailyGoal, updateHistoryDuration } from "./core.js";
import { exportProgress, importProgress, loadCourses, loadProgress, resetProgress, saveProgress } from "./store.js";
import { mountLessonGuide as mountPlanner } from "./lesson-guide.js";
import { setCourseCompleted, switchCourse } from "./course-navigation.js";
import { PRACTICE_KEY, activityState, readPractice, pausePractice, startPractice, checkpointPractice } from "./practice.js";
import { learningDays, learningRecords, learningTotals, recordDurationLabel } from "./learning-records.js";

const $ = (selector) => document.querySelector(selector);
let courses, progress, planner;
let practice;
const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function refreshPractice() { try { practice = readPractice(localStorage); } catch { practice = null; toast("练习记录读取失败，未修改原记录；当前只显示课程时间。"); } }
const minutes = ms => Math.round(ms / 60000);
const entryTitle = (entry, map) => entry.kind === "practice" ? `练习 · ${entry.title}${entry.active ? "（未结束）" : ""}` : map.get(entry.lessonId)?.lessonName || entry.lessonId;
const entryTime = entry => entry.time ? `${entry.untimed ? "完成于 " : ""}${new Date(entry.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "跨日练习";
const tauriInvoke = window.__TAURI__?.core?.invoke;
const tauriListen = window.__TAURI__?.event?.listen;
if (typeof tauriInvoke === "function") tauriInvoke("set_main_view", { view: "detail" }).catch(() => {});
const lessonMap = () => new Map(flattenCourses(courses).map((lesson) => [lesson.key, lesson]));
function toast(message) { const el = $("#toast"); el.textContent = message; el.hidden = false; clearTimeout(el._timer); el._timer = setTimeout(() => el.hidden = true, 2600); }

function renderSummary() {
  refreshPractice();
  const info = metrics(progress, courses), current = lessonMap().get(progress.currentLessonId), prediction = predictions(progress, courses);
  $("#currentPath").textContent = current ? `当前：阶段 ${current.stageId} · ${current.chapterName} · ${current.lessonName}` : "正式必修已全部完成";
  $("#totalLessons").textContent = info.total; $("#completedLessons").textContent = info.completed; $("#remainingLessons").textContent = info.remaining;
  $("#recentRate").textContent = prediction.actualRate.toFixed(1); $("#percentRing strong").textContent = `${info.percent.toFixed(1)}%`; $("#percentRing").style.setProperty("--percent", info.percent);
  $("#predictions").innerHTML = [
    ["最近实际速度", prediction.actualRate > 0 ? `最近 ${prediction.actualDays} 个自然日，平均 ${prediction.actualRate.toFixed(1)} 节 / 天` : "最近 7 天暂无学习进度，暂无法按当前速度预测", prediction.actualRate > 0 ? prediction.actualDate : "暂无"],
    ["每日最低目标", `每天至少 ${prediction.goal} 节`, prediction.goalDate],
    ["多学一节", `每天 ${prediction.stretchRate} 节`, prediction.stretchDate],
  ].map(([title, note, date]) => `<div class="prediction-item"><div class="prediction-copy"><strong>${title}</strong><span>${note}</span></div><strong class="prediction-value">${date}</strong></div>`).join("");
  const map = lessonMap();
  const totals = learningTotals(progress, practice), combined = learningRecords(progress, practice);
  $("#totalLearningTime").textContent = `累计学习 ${minutes(totals.totalMs)} 分钟 · 课程 ${minutes(totals.courseMs)} · 练习 ${minutes(totals.practiceMs)}`;
  $("#historyList").innerHTML = combined.length ? combined.slice(0, 6).map(entry => `<div class="history-item"><div class="history-copy"><strong>${escapeText(entryTitle(entry, map))}</strong><span>${escapeText(entry.date)} ${escapeText(entryTime(entry))} · ${recordDurationLabel(entry)}</span></div>${entry.kind === "course" ? `<button class="history-edit" data-record-id="${encodeURIComponent(entry.recordId)}">编辑</button>` : ""}</div>`).join("") : '<p class="empty">完成课程或开始练习后，这里会留下足迹。</p>';
}

function renderAllHistory() {
  refreshPractice();
  const map = lessonMap(), groups = learningDays(progress, practice);
  $("#allHistoryList").innerHTML = groups.length ? groups.map(group => {
    const displayDate = formatDate(new Date(`${group.date}T12:00:00`));
    return `<details class="history-day"><summary><span class="history-day-title">${displayDate}</span><span class="history-day-stats">完成 ${group.completedLessons} 节${group.practiceCount ? ` · 练习 ${group.practiceCount} 段` : ""} · 学习 ${minutes(group.totalMs)} 分钟</span></summary><div class="history-day-records"><p class="history-time-breakdown">课程 ${minutes(group.courseMs)} 分钟 · 练习 ${minutes(group.practiceMs)} 分钟</p>${group.entries.map(entry => `<div class="history-record"><span class="history-record-mark">└</span><div><strong>${escapeText(entryTitle(entry, map))}</strong><span class="history-record-meta">${escapeText(entryTime(entry))} · ${recordDurationLabel(entry)}</span></div></div>`).join("")}</div></details>`;
  }).join("") : '<p class="empty">暂无学习记录。</p>';
}

function renderTree() {
  const completed = new Set(progress.completedLessonIds);
  $("#courseTree").innerHTML = courses.map((stage) => {
    const required = stage.stageId >= 1 && stage.stageId <= 9 && !stage.optional;
    const count = stage.chapters.reduce((sum, chapter) => sum + chapter.lessons.length, 0);
    const containsCurrent = stage.chapters.some((chapter) => chapter.lessons.some((lesson) => `${stage.stageId}:${chapter.chapterId}:${lesson.id}` === progress.currentLessonId));
    return `<details class="stage-node ${stage.optional ? "optional" : ""}" ${containsCurrent ? "open" : ""}><summary><span>${stage.stageId === 0 ? "前置" : `阶段 ${stage.stageId}`} · ${escapeText(stage.stageName)}${stage.optional ? "（选看）" : ""}</span><span class="stage-meta">${required ? "正式必修" : "不计进度"} · ${count} 节</span></summary>${stage.chapters.map((chapter) => {
      const chapterCurrent = chapter.lessons.some((lesson) => `${stage.stageId}:${chapter.chapterId}:${lesson.id}` === progress.currentLessonId);
      return `<details class="chapter-node" ${chapterCurrent ? "open" : ""}><summary>${chapter.chapterId}. ${escapeText(chapter.chapterName)} <span class="stage-meta">网站标注 ${chapter.lessonCount} 课时</span></summary><div class="lesson-list">${chapter.lessons.map((lesson) => {
        const key = `${stage.stageId}:${chapter.chapterId}:${lesson.id}`, done = completed.has(key), current = key === progress.currentLessonId;
        return `<div class="lesson-row ${done ? "done" : ""} ${current ? "current" : ""}" data-key="${key}"><button class="lesson-status" data-action="toggle" ${!required ? "disabled" : ""} aria-label="切换完成状态">${done ? "✓" : current ? "▶" : ""}</button><span>${escapeText(lesson.displayId || lesson.id)} ${escapeText(lesson.name)}${planner?.tag(key) || ""}</span>${required ? `<button class="set-current" data-action="current">设为当前</button>` : ""}</div>`;
      }).join("")}</div></details>`;
    }).join("")}</details>`;
  }).join("");
  requestAnimationFrame(() => document.querySelector(".lesson-row.current")?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

function renderSettings() {
  $("#dailyGoal").value = progress.settings.dailyGoal; $("#soundEnabled").checked = progress.settings.soundEnabled;
  $("#volume").value = progress.settings.volume; $("#sideCatEnabled").checked = progress.settings.sideCatEnabled; $("#encouragementEnabled").checked = progress.settings.encouragementEnabled;
}
function render() { renderSummary(); renderTree(); renderSettings(); planner?.refresh(progress); }

async function syncDesktopSession() {
  if (typeof tauriInvoke !== "function") return;
  refreshPractice();
  try { await tauriInvoke("sync_session_state", { sessionState: activityState(progress, practice) }); } catch {}
}

async function handleSessionControl(action = "toggle") {
  refreshPractice();
  if (practice?.active && sessionState(progress) !== SESSION_STATES.STUDYING) {
    if ((action === "pause" || action === "toggle") && practice.active.state === "STUDYING") pausePractice(practice);
    else if ((action === "resume" || action === "toggle") && practice.active.state === "PAUSED") startPractice(practice);
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); await syncDesktopSession(); renderSummary(); return;
  }
  const state = sessionState(progress);
  if ((action === "pause" || action === "toggle") && state === SESSION_STATES.STUDYING) pauseSession(progress);
  else if ((action === "resume" || action === "toggle") && state === SESSION_STATES.PAUSED) resumeSession(progress);
  else return;
  saveProgress(progress); await syncDesktopSession(); renderSummary();
}

$("#courseTree").addEventListener("click", async (event) => {
  const guide = event.target.closest("[data-plan-key]");
  if (guide) { planner?.openLesson(guide.dataset.planKey); return; }
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const key = button.closest(".lesson-row").dataset.key;
  let message = "已切换课节，原课计时已保存。";
  if (button.dataset.action === "toggle") {
    try {
      const result = setCourseCompleted(progress, courses, localStorage, key, !progress.completedLessonIds.includes(key));
      message = result.warning || (result.completed ? "已记入今日完成和学习足迹" : result.removedUntimed ? "已撤销本次未计时完成" : "已取消完成标记，原有学习记录保留");
    } catch (error) { return toast(error.message); }
  } else {
    try { switchCourse(progress, courses, localStorage, key); }
    catch (error) { return toast(error.message); }
    sessionStorage.setItem('cat-study.view-mode', 'course');
  }
  progress.updatedAt = new Date().toISOString(); saveProgress(progress); render(); toast(message); await syncDesktopSession();
});
$("#historyList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-record-id]"); if (!button) return;
  const id = decodeURIComponent(button.dataset.recordId), record = progress.history.find((item) => item.recordId === id);
  if (!record) return;
  const oldMinutes = Math.round(record.durationSeconds / 60), value = prompt("本节有效学习分钟数", String(oldMinutes));
  if (value === null) return;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return toast("请输入 0–1440 的整数分钟");
  if (minutes === 0 && !confirm("确认将这条记录改为 0 分钟吗？")) return;
  if (!updateHistoryDuration(progress, id, minutes)) return toast("时长修改失败");
  saveProgress(progress); renderSummary(); toast("学习时长已更新");
});
$("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
$("#allHistoryButton").addEventListener("click", () => { renderAllHistory(); $("#historyDialog").showModal(); });
$("#dailyGoal").addEventListener("change", (event) => { updateDailyGoal(progress, event.target.value); saveProgress(progress); renderSummary(); toast("今天的目标已更新"); });
for (const id of ["soundEnabled", "sideCatEnabled", "encouragementEnabled"]) $("#" + id).addEventListener("change", (event) => { progress.settings[id] = event.target.checked; saveProgress(progress); });
$("#volume").addEventListener("input", (event) => { progress.settings.volume = Number(event.target.value); saveProgress(progress); });
$("#exportButton").addEventListener("click", () => exportProgress(progress));
$("#importInput").addEventListener("change", async (event) => { try { progress = await importProgress(event.target.files[0], courses); await syncDesktopSession(); render(); toast("数据已恢复"); } catch (error) { toast(error.message); } });
$("#resetButton").addEventListener("click", async () => { if (!confirm("确定要重置学习记录吗？此操作会恢复到初始学习位置。")) return; if (!confirm("再次确认：所有本地学习记录都会被清除。")) return; progress = resetProgress(courses); await syncDesktopSession(); render(); toast("学习记录已重置"); });

async function init() {
  try {
    courses = await loadCourses(); progress = await loadProgress(courses); await syncDesktopSession();
    if (typeof tauriListen === "function") await tauriListen("session-control-request", (event) => handleSessionControl(event.payload || "toggle"));
    try {
      planner = await mountPlanner({ getProgress: () => progress, toast,
        selectLesson: async (key) => {
          if (!flattenCourses(courses, { requiredOnly: true }).some(lesson => lesson.key === key)) return false;
          try { switchCourse(progress, courses, localStorage, key); } catch (error) { toast(error.message); return false; }
          sessionStorage.setItem('cat-study.view-mode', 'course');
          window.location.href = "./index.html"; return true;
        }
      });
    } catch (error) { toast(error.message); }
    render();
  } catch (error) { document.body.innerHTML = `<p class="empty">${error.message}。请通过本地服务器启动项目。</p>`; }
}
setInterval(() => {
  if (progress && sessionState(progress) === SESSION_STATES.STUDYING) { checkpointSession(progress); saveProgress(progress); }
  if (practice?.active?.state === "STUDYING") { checkpointPractice(practice); localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); if (practice.active.state === "PAUSED") syncDesktopSession(); }
}, 1000);
window.addEventListener("storage", event => { if (progress && event.key === PRACTICE_KEY) { renderSummary(); if ($("#historyDialog").open) renderAllHistory(); } });
window.addEventListener("beforeunload", () => { if (progress && sessionState(progress) === SESSION_STATES.STUDYING) { checkpointSession(progress); saveProgress(progress); } if (practice && pausePractice(practice)) localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); });
init();
