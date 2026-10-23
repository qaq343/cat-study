import { readLessonNotes, removeLegacyPlan, updateLessonNote } from './course-navigation.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export async function mountLessonGuide({ selectLesson, toast }) {
  removeLegacyPlan(localStorage);
  const response = await fetch('./data/lesson-guide.json');
  if (!response.ok) throw new Error('课节重点暂时加载失败，计时和选课仍可使用。');
  const data = await response.json(), lessons = new Map(data.lessons.map(item => [item.key, item]));
  const root = document.createElement('div'); root.id = 'lessonGuideLayer';
  root.innerHTML = '<dialog id="lessonPlanDialog" class="planner-dialog lesson-plan-dialog"><header class="planner-head"><h2 id="lessonPlanTitle">本节学习要求</h2><button data-guide-close aria-label="关闭课程要求">×</button></header><div id="lessonPlanContent" class="planner-content"></div></dialog>';
  document.body.append(root);
  const dialog = root.querySelector('dialog'), content = root.querySelector('#lessonPlanContent');
  let selectedKey;
  function lessonPolicy(key) { return { ...lessons.get(key), ...readLessonNotes(localStorage).lessons[key] }; }
  function openLesson(key) {
    const item = lessons.get(key);
    if (!item) return toast('这节尚未单独划分重点，可以自由学习。');
    selectedKey = key;
    root.querySelector('#lessonPlanTitle').textContent = item.name;
    content.innerHTML = `<p class="plan-lesson-heading">${escape(item.type)} · 重点参考，可自由选课</p><dl class="plan-requirements">${[['为什么学', item.reason], ['掌握到哪里', item.check], ['代码怎么做', item.code]].map(([title, text]) => `<div><dt>${title}</dt><dd>${escape(text)}</dd></div>`).join('')}</dl>${item.hold ? '<p class="plan-note">原目录标题有异常，请结合机构实际内容确认。</p>' : ''}<button class="plan-button" data-guide-study>学习这节</button>`;
    if (!dialog.open) dialog.showModal();
  }
  root.querySelector('[data-guide-close]').addEventListener('click', () => dialog.close());
  content.addEventListener('click', async event => {
    if (!event.target.closest('[data-guide-study]')) return;
    try { if (await selectLesson(selectedKey)) dialog.close(); } catch (error) { toast(error.message); }
  });
  return {
    lessonPolicy, openLesson, refresh() {},
    skipLesson(key, savedSession) { updateLessonNote(localStorage, key, { skippedAt: new Date().toISOString(), ...(savedSession ? { savedSession } : {}) }); },
    restoreLesson(key) { const note = lessonPolicy(key); if (note.savedSession || note.skippedAt) updateLessonNote(localStorage, key, { savedSession: null, skippedAt: null }); },
    tag(key) { const item = lessons.get(key); if (!item) return ''; const note = readLessonNotes(localStorage).lessons[key]; return `<button class="lesson-plan-tag" data-plan-key="${escape(key)}">${note?.skippedAt ? '已跳过 · ' : ''}${escape(item.type)} · 学习要求</button>`; }
  };
}
