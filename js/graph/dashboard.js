import { renderSemesterGraph } from './gradeGraph.js';
import { renderGradeRanges } from './gradeRanges.js';

/**
 * 기존 페이지의 컨테이너에 그래프/예상 인원 UI를 설치한다.
 * 예: mountGradeDashboard(document.querySelector('#grade-dashboard'), { courses, gradingPolicy });
 * courses: 과목 객체 배열 또는 {courses: [...]}
 * gradingPolicy: {gradingType:'relative', studentCount: 40, gradeDistribution:{'A+':15,A0:20,'B+':25,B0:30}}
 * 반환된 update()로 최신 JSON 데이터를 다시 반영할 수 있다.
 */
export function mountGradeDashboard(container, { courses = [], gradingPolicy = null } = {}) {
  if (typeof Element === 'undefined' || !(container instanceof Element)) {
    throw new TypeError('container는 DOM 요소여야 합니다.');
  }
  let currentCourses = courses;
  let currentPolicy = gradingPolicy;
  const section = document.createElement('section');
  const title = document.createElement('h2'); title.textContent = '학기별 성적 그래프';
  const label = document.createElement('label'); label.textContent = '성적 구분: ';
  const select = document.createElement('select');
  for (const [value, text] of [['all', '전체'], ['major', '전공'], ['general', '교양']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
  }
  label.append(select);
  const graph = document.createElement('div');
  const rangeTitle = document.createElement('h2'); rangeTitle.textContent = '학점구간별 예상 인원';
  const countLabel = document.createElement('label'); countLabel.textContent = '수강자 수: ';
  const countInput = document.createElement('input');
  countInput.type = 'number'; countInput.min = '0'; countInput.step = '1';
  countLabel.append(countInput);
  const rangeResult = document.createElement('div');
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  section.append(title, label, graph, rangeTitle, countLabel, rangeResult, message);
  container.replaceChildren(section);

  function refreshGraph() {
    try {
      const list = Array.isArray(currentCourses) ? currentCourses : currentCourses?.courses;
      renderSemesterGraph(graph, list, select.value);
    } catch (error) { graph.textContent = error.message; }
  }
  function refreshRanges() {
    rangeResult.replaceChildren();
    message.textContent = '';
    if (!currentPolicy) { message.textContent = '평가 기준 데이터가 없습니다.'; return; }
    if (countInput.value.trim() === '') { message.textContent = '수강자 수를 입력하세요.'; return; }
    const count = Number(countInput.value);
    try { renderGradeRanges(rangeResult, count, currentPolicy); }
    catch (error) { message.textContent = error.message; }
  }
  select.addEventListener('change', refreshGraph);
  countInput.addEventListener('input', refreshRanges);
  function update({ courses: nextCourses = currentCourses, gradingPolicy: nextPolicy = currentPolicy } = {}) {
    currentCourses = nextCourses;
    currentPolicy = nextPolicy;
    if (currentPolicy?.studentCount != null) countInput.value = String(currentPolicy.studentCount);
    refreshGraph();
    refreshRanges();
  }
  update();
  return { update, destroy: () => section.remove() };
}
