import { SESSION_STATES, checkpointSession, dateKey, flattenCourses, metrics, pauseSession, resumeSession, sessionState, startSession, tapMuyu } from "./core.js";
import { loadCourses, loadProgress, saveProgress } from "./store.js";
import { mountLessonGuide as mountPlanner } from "./lesson-guide.js";
import { switchCourse } from "./course-navigation.js";
import { PRACTICE_KEY, activityState, loadPractice, checkpointPractice, startPractice, pausePractice, finishPractice, practiceToday } from "./practice.js";
import { learningDays } from "./learning-records.js";

const encouragements = ["真棒！","知识 +1","工资 +100","再拿下一节！","offer 靠近中…","拖延怪 -1","这一节拿下了！","继续加油！","今天没白学！","又干掉一节！"];
const colors = ["#c96d4f","#d7973e","#75915e","#a4749e","#c57b67"];
const $ = (selector) => document.querySelector(selector);
let courses, progress, timerId, planner;
let practice, timerMode = "course";
const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const clock = ms => { const seconds = Math.floor(Math.max(0, ms || 0) / 1000); return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":"); };
const savePractice = () => { if (practice) localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); };
function renderTimers() {
  if (!progress) return;
  const course = progress.activeSession, active = practice?.active;
  $("#currentCourseTitle").textContent = currentLesson()?.lessonName || "正式必修已完成";
  const policy = planner?.lessonPolicy(progress.currentLessonId), skippable = policy?.type === "跳过" || policy?.type === "延后" || policy?.skippedAt;
  $("#courseImportance").textContent = policy?.skippedAt ? "已跳过" : policy?.type || "未划分重点";
  $("#courseImportance").dataset.priority = policy?.type || "";
  $("#lessonPolicy").classList.toggle("is-skippable", Boolean(skippable));
  $("#lessonPolicy").textContent = skippable ? `本节${policy.type === "延后" ? "可延后，本轮不用补" : "可以跳过"}。${policy.reason || "跳过不算学完，可从课程树回来继续。"}` : policy?.code ? `怎么学：${policy.code}。掌握：${policy.check}` : "可查看学习要求；尚未划重点的课不自动判断重要程度。";
  $("#skipLessonButton").disabled = !planner || !progress.currentLessonId;
  $("#skipLessonButton").textContent = skippable ? "跳过本节 →" : "暂时跳过 →";
  $("#courseClock").textContent = clock(course?.activeElapsedMs);
  $("#courseStatus").textContent = course?.state === "STUDYING" ? "进行中" : course ? "已暂停" : "未开始";
  $("#coursePauseButton").disabled = course?.state !== "STUDYING";
  $("#courseTab").setAttribute("aria-selected", String(timerMode === "course"));
  $("#practiceTab").setAttribute("aria-selected", String(timerMode === "practice"));
  $("#courseTimerPanel").hidden = timerMode !== "course";
  $("#practiceTimerPanel").hidden = timerMode !== "practice";
  $("#practiceClock").textContent = clock(active?.elapsedMs);
  $("#practiceStatus").textContent = active?.state === "STUDYING" ? "进行中" : active ? "已暂停" : "未开始";
  $("#practiceTitle").disabled = Boolean(active) || !practice;
  if (active) $("#practiceTitle").value = active.title;
  $("#practicePauseButton").disabled = active?.state !== "STUDYING";
  $("#practiceStartButton").disabled = !practice || active?.state === "STUDYING";
  $("#practiceStartButton").textContent = active ? "继续练习" : "开始练习";
  $("#practiceFinishButton").disabled = !active;
  $("#practiceTodayLabel").textContent = practice ? `今日练习 ${practiceToday(practice).minutes} 分钟` : "练习记录待检查";
  const today = learningDays(progress, practice).find(day => day.date === dateKey());
  $("#todayStudyTime").textContent = `已记录 ${Math.round((today?.totalMs || 0) / 60000)} 分钟`;
}
async function beginPractice(title, key = null) {
  if (!practice) { toast("练习记录读取失败，原记录已保留，请先检查备份。"); return false; }
  if (practice.active && key && practice.active.taskKey !== key) { toast("还有未结束的练习，先结束后再换题。"); return false; }
  if (pauseSession(progress)) saveProgress(progress);
  startPractice(practice, title, key); savePractice(); timerMode = "practice";
  renderTimers(); renderMode(); await syncDesktopSession();
  if (isTauri) { try { await tauriInvoke("enter_companion"); } catch { toast("练习已计时，可从托盘返回主页"); } }
  return true;
}
const tauriInvoke = window.__TAURI__?.core?.invoke;
const tauriListen = window.__TAURI__?.event?.listen;
const isTauri = typeof tauriInvoke === "function";
if (isTauri) tauriInvoke("set_main_view", { view: "home" }).catch(() => {});

function toast(message) { const el = $("#toast"); el.textContent = message; el.hidden = false; clearTimeout(el._timer); el._timer = setTimeout(() => el.hidden = true, 2400); }
function currentLesson() { return flattenCourses(courses, { requiredOnly: true }).find((lesson) => lesson.key === progress.currentLessonId); }
function updateDate() { $("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date()); }

function renderTodaySummary() {
  const todayKey = dateKey(new Date()), day = progress.dailyRecords[todayKey] || { completedCount: 0, sessions: [] };
  const map = new Map(flattenCourses(courses).map((lesson) => [lesson.key, lesson]));
  const records = (Array.isArray(day.sessions) && day.sessions.length ? day.sessions : progress.history.filter((item) => dateKey(new Date(item.endedAt)) === todayKey));
  const combined = learningDays(progress, practice).find(day => day.date === todayKey);
  const minutes = Math.round((combined?.totalMs || 0) / 60000);
  const current = metrics(progress, courses).completed, start = Math.max(0, current - (Number(day.completedCount) || 0));
  const names = [...new Map(records.map((item) => [item.lessonId, map.get(item.lessonId)?.lessonName ?? item.lessonId])).values()];
  for (const entry of combined?.entries || []) if (entry.kind === "practice") names.push(`练习 · ${entry.title}${entry.active ? "（未结束）" : ""}`);
  $("#todaySummary").innerHTML = `<p class="today-summary-date">${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date())}</p><p class="today-summary-total">学习 ${day.completedCount || 0} 节 · ${minutes} 分钟</p><p class="plan-note">课程 ${Math.round((combined?.courseMs || 0) / 60000)} 分钟 · 练习 ${Math.round((combined?.practiceMs || 0) / 60000)} 分钟</p><div class="today-summary-lessons">${names.length ? names.map((name) => `<div>${escapeText(name)}</div>`).join("") : '<div class="empty">今天还没有学习记录。</div>'}</div><p class="today-summary-progress"><span>今日进度</span><strong>${start} → ${current} 节</strong></p>`;
  if (practice?.active) $("#todaySummary").insertAdjacentHTML("beforeend", '<p class="plan-note">练习时长已含当前保存的累计，不会增加课程节数。</p>');
}

function renderProgress() {
  const info = metrics(progress, courses), today = learningDays(progress, practice).find(day => day.date === dateKey());
  $("#todayCount").textContent = `${info.todayCompleted} 节`;
  $("#todayStudyTime").textContent = `已记录 ${Math.round((today?.totalMs || 0) / 60000)} 分钟`;
  planner?.refresh(progress);
}

function renderMode() {
  renderTimers();
  const state = sessionState(progress), studying = state !== SESSION_STATES.IDLE;
  $("#startButton").textContent = state === SESSION_STATES.PAUSED ? "▶ 继续学习" : state === SESSION_STATES.STUDYING ? "▶ 返回学习" : "▶ 开始学习";
  if (isTauri) {
    $("#home").hidden = false;
    $("#companionMode").hidden = true;
    renderCelebration();
    return;
  }
  $("#home").hidden = studying; $("#companionMode").hidden = !studying;
  $("#peekCat").hidden = !progress.settings.sideCatEnabled;
  if (!studying) renderCelebration();
}

function renderCelebration() {
  clearInterval(timerId);
  const timer = $("#celebrationTimer");
  const remaining = progress.celebrationEndsAt ? Math.max(0, new Date(progress.celebrationEndsAt) - new Date()) : 0;
  const active = remaining > 0;
  $("#muyuButton").disabled = false;
  timer.hidden = !active; timer.classList.toggle("is-visible", active);
  if (!active) { progress.celebrationEndsAt = null; saveProgress(progress); return; }
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((new Date(progress.celebrationEndsAt) - new Date()) / 1000));
    $("#celebrationTimer strong").textContent = seconds;
    if (!seconds) { clearInterval(timerId); progress.celebrationEndsAt = null; saveProgress(progress); timer.classList.remove("is-visible"); setTimeout(() => { if (!timer.classList.contains("is-visible")) timer.hidden = true; }, 220); }
  };
  tick(); timerId = setInterval(tick, 250);
}

function playTap() {
  if (!progress.settings.soundEnabled) return;
  try {
    const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(185, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + .12);
    gain.gain.setValueAtTime(Math.max(.001, progress.settings.volume * .25), ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .16);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .17);
  } catch {}
}

function animateTap() {
  const hero = $(".hero"); hero.classList.remove("is-hit"); void hero.offsetWidth; hero.classList.add("is-hit");
  if (!progress.settings.encouragementEnabled) return;
  const word = document.createElement("span"); word.className = "encouragement";
  word.textContent = encouragements[Math.floor(Math.random() * encouragements.length)];
  word.style.setProperty("--x", `${57 + Math.random() * 30}%`); word.style.setProperty("--y", `${13 + Math.random() * 25}%`);
  word.style.setProperty("--rotate", `${-7 + Math.random() * 14}deg`); word.style.setProperty("--color", colors[Math.floor(Math.random() * colors.length)]);
  $("#encouragements").append(word); setTimeout(() => word.remove(), 1400);
}

function handleTap() {
  playTap();
  if (practice?.active?.state === "STUDYING" || timerMode === "practice") return toast("练习请用下方“结束”保存，敲木鱼只完成课程。");
  const result = tapMuyu(progress, courses);
  if (result.completed) {
    saveProgress(progress); syncDesktopSession(); renderProgress(); renderMode(); renderCelebration();
  } else if (result.reason === "no-active-session") toast("先开始学习，学完这一节再敲木鱼。");
}

async function syncDesktopSession() {
  if (!isTauri) return;
  const state = activityState(progress, practice);
  try { await tauriInvoke("sync_session_state", { sessionState: state }); } catch {}
}

async function handleSessionControl(action = "toggle") {
  if (practice?.active && (practice.active.state === "STUDYING" || timerMode === "practice")) {
    if ((action === "pause" || action === "toggle") && practice.active.state === "STUDYING") pausePractice(practice);
    else if ((action === "resume" || action === "toggle") && practice.active.state === "PAUSED") { if (pauseSession(progress)) saveProgress(progress); startPractice(practice); }
    savePractice(); await syncDesktopSession(); renderTimers(); return;
  }
  const state = sessionState(progress);
  if ((action === "pause" || action === "toggle") && state === SESSION_STATES.STUDYING) pauseSession(progress);
  else if ((action === "resume" || action === "toggle") && state === SESSION_STATES.PAUSED) resumeSession(progress);
  else return;
  saveProgress(progress); await syncDesktopSession(); renderMode();
}

$("#startButton").addEventListener("click", async () => {
  if (!currentLesson()) return toast("正式必修已经全部完成。");
  try { switchCourse(progress, courses, localStorage, progress.currentLessonId); }
  catch (error) { return toast(error.message); }
  planner?.restoreLesson(progress.currentLessonId);
  if (practice && pausePractice(practice)) savePractice();
  timerMode = "course";
  const started = sessionState(progress) === SESSION_STATES.PAUSED ? resumeSession(progress) : startSession(progress);
  if (started) {
    progress.celebrationEndsAt = null;
    saveProgress(progress);
  }
  await syncDesktopSession();
  renderTimers();
  if (isTauri) {
    try { await tauriInvoke("enter_companion"); }
    catch { toast("侧边小猫暂时没有出现，请再试一次。"); }
  } else renderMode();
});
$("#returnButton").addEventListener("click", () => { $("#home").hidden = false; $("#companionMode").hidden = true; $("#muyuButton").disabled = false; });
$("#muyuButton").addEventListener("click", handleTap);
$("#muyuButton").addEventListener("pointerdown", () => animateTap());
$("#peekCat").addEventListener("click", (event) => { const el = event.currentTarget; el.classList.remove("react"); void el.offsetWidth; el.classList.add("react"); });
$("#finishDayButton").addEventListener("click", () => { renderTodaySummary(); $("#todaySummaryDialog").showModal(); });
$("#closeTodaySummary").addEventListener("click", () => $("#todaySummaryDialog").close());
$("#courseTab").addEventListener("click", () => { timerMode = "course"; renderTimers(); });
$("#practiceTab").addEventListener("click", () => { timerMode = "practice"; renderTimers(); });
$("#coursePauseButton").addEventListener("click", () => handleSessionControl("pause"));
$("#skipLessonButton").addEventListener("click", async () => {
  if (!planner || !progress.currentLessonId) return;
  const key = progress.currentLessonId, policy = planner.lessonPolicy(key);
  if (progress.activeSession && progress.activeSession.lessonId !== key) return toast("还有其他课节的计时，先返回该课处理。");
  const hasTime = (progress.activeSession?.activeElapsedMs || 0) > 0 || sessionState(progress) === SESSION_STATES.STUDYING;
  if ((hasTime || !["跳过", "延后"].includes(policy.type)) && !confirm(`确认跳过“${currentLesson()?.lessonName}”？${policy.type?.startsWith("必听") ? "本节建议必听，请确认这次取舍。" : ""}跳过不算学完；已有计时会保留，回来后可继续。`)) return;
  if (pauseSession(progress)) saveProgress(progress);
  planner.skipLesson(key, progress.activeSession);
  const required = flattenCourses(courses, { requiredOnly: true }), index = required.findIndex(item => item.key === key);
  const nextKey = required.slice(index + 1).find(item => !progress.completedLessonIds.includes(item.key))?.key || null;
  if (nextKey) { try { switchCourse(progress, courses, localStorage, nextKey); } catch (error) { return toast(error.message); } }
  else { progress.activeSession = null; progress.currentLessonId = null; }
  progress.celebrationEndsAt = null; saveProgress(progress);
  await syncDesktopSession(); renderProgress(); renderMode();
  toast("已跳过，不增加完成节数；可从课程树选回本节继续。");
});
$("#practiceStartButton").addEventListener("click", () => beginPractice($("#practiceTitle").value));
$("#practicePauseButton").addEventListener("click", async () => { if (practice) { pausePractice(practice); savePractice(); renderTimers(); await syncDesktopSession(); } });
$("#practiceFinishButton").addEventListener("click", async () => { if (practice && finishPractice(practice)) { savePractice(); $("#practiceTitle").value = ""; renderTimers(); await syncDesktopSession(); toast("练习已保存，课程节数不变"); } });
$("#practiceHistoryButton").addEventListener("click", () => {
  $("#practiceHistoryContent").innerHTML = practice?.history.length ? practice.history.map(record => `<div class="practice-record"><strong>${escapeText(record.title)}</strong><span>${escapeText(new Date(record.startedAt).toLocaleString("zh-CN"))} · ${Math.round(record.elapsedMs / 60000)} 分钟</span></div>`).join("") : '<p class="empty">结束练习后，记录会保存在这里。</p>';
  $("#practiceHistoryDialog").showModal();
});
$("#practiceExportButton").addEventListener("click", () => {
  if (!practice) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(practice, null, 2)], { type: "application/json" })), link = document.createElement("a");
  link.href = url; link.download = `cat-study-practice-${dateKey()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function init() {
  try {
    courses = await loadCourses(); progress = await loadProgress(courses); updateDate(); renderProgress();
    try { practice = loadPractice(localStorage); savePractice(); timerMode = sessionStorage.getItem('cat-study.view-mode') === 'course' ? 'course' : practice.active ? "practice" : "course"; sessionStorage.removeItem('cat-study.view-mode'); }
    catch (error) { toast(error.message); }
    await syncDesktopSession();
    if (isTauri && typeof tauriListen === "function") await tauriListen("session-control-request", (event) => handleSessionControl(event.payload || "toggle"));
    renderMode();
    try {
      planner = await mountPlanner({ home: true, getProgress: () => progress, toast, startPractice: beginPractice,
        selectLesson: async (key) => {
          if (!flattenCourses(courses, { requiredOnly: true }).some(lesson => lesson.key === key)) return false;
          try { switchCourse(progress, courses, localStorage, key); } catch (error) { toast(error.message); return false; }
          $("#startButton").click(); return true;
        }
      });
      $("#courseImportance").addEventListener("click", () => planner.openLesson(progress.currentLessonId));
      renderTimers();
    } catch (error) { toast(error.message); }
  } catch (error) { document.body.innerHTML = `<p class="empty">${error.message}。请通过本地服务器启动项目。</p>`; }
}
window.addEventListener("focus", () => {
  if (!progress) return;
  renderProgress();
  renderMode();
});
setInterval(() => {
  if (!progress) return;
  if (sessionState(progress) === SESSION_STATES.STUDYING) { checkpointSession(progress); saveProgress(progress); }
  if (practice?.active?.state === "STUDYING") { checkpointPractice(practice); savePractice(); if (practice.active.state === "PAUSED") { syncDesktopSession(); toast("检测到计时中断，练习已暂停"); } }
  renderTimers();
}, 1000);
window.addEventListener("beforeunload", () => {
  if (practice && pausePractice(practice)) savePractice();
  if (!progress || sessionState(progress) !== SESSION_STATES.STUDYING) return;
  checkpointSession(progress); saveProgress(progress);
});
init();
