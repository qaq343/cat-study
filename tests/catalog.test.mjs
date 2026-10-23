import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { flattenCourses } from '../js/core.js';
const read = filename => readFile(new URL(filename, import.meta.url), 'utf8').then(JSON.parse);
const courses = await read('../data/courses.json'), original = await read('../data/courses.raw.json');
assert.deepEqual(courses.filter(stage => stage.stageId < 10), original.filter(stage => stage.stageId < 10), '前置和阶段1–9原样保留');
const all = flattenCourses(courses), originalLessons = flattenCourses(original);
assert.equal(all.length, 708);
assert.equal(new Set(all.map(lesson => lesson.key)).size, 708);
const map = new Map(all.map(lesson => [lesson.key, lesson.lessonName]));
for (const lesson of originalLessons) assert.equal(map.get(lesson.key), lesson.lessonName, `旧标识保留 ${lesson.key}`);
assert.equal(flattenCourses(courses, { requiredOnly: true }).length, 504);
for (const [id, chapters, count] of [[10, 10, 126], [11, 3, 55]]) {
  const stage = courses.find(stage => stage.stageId === id);
  assert.equal(stage.chapters.length, chapters); assert.equal(stage.optional, true);
  assert.equal(stage.chapters.reduce((sum, chapter) => sum + chapter.lessons.length, 0), count);
  const sourceIds = stage.chapters.flatMap(chapter => chapter.lessons.map(lesson => lesson.sourceSectionId));
  assert.equal(new Set(sourceIds).size, count, '源站真实不同标识，无重复抓取同一条');
  for (const chapter of stage.chapters) assert.equal(chapter.lessonCount, chapter.lessons.length);
}
const first = courses.find(stage => stage.stageId === 10).chapters[0];
const duplicates = first.lessons.filter(lesson => lesson.name === '科大讯飞系列大模型-讯飞文档问答');
assert.equal(duplicates.length, 2); assert.notEqual(duplicates[0].sourceSectionId, duplicates[1].sourceSectionId);
assert.equal(first.lessons.find(lesson => lesson.id === '1.12').name, '科大讯飞系列大模型-iFlyCode');
assert.equal(first.lessons.find(lesson => lesson.id === '1.12').displayId, '1.13', '展示跟随网站顺序，旧ID不重排');
assert.equal(first.lessons.find(lesson => lesson.id === '1.17').displayId, '1.12');
console.log('✓ 新目录708节、阶段十126/十一55、604个原课节标识完整、必修504不变、网站同名不同ID及展示编号兼容通过');
