import { renderSemesterGraph } from './gradeGraph.js';
import { renderGradeRanges } from './gradeRanges.js';

/**
 * 성적 그래프 및 상대평가 예상 인원 대시보드.
 * 다른 팀의 HTML에서 mountGradeDashboard(요소, { courses, gradingPolicy })로 연결한다.
 */
export function mountGradeDashboard(container, { courses = [], gradingPolicy = null } = {}) {
  if (typeof Element === 'undefined' || !(container instanceof Element)) {
    throw new TypeError('container는 DOM 요소여야 합니다.');
  }

  let currentCourses = courses;
  let currentPolicy = gradingPolicy;
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = '학기별 성적 그래프';
  const categoryLabel = document.createElement('label');
  categoryLabel.textContent = '성적 구분: ';
  const categorySelect = document.createElement('select');
  for (const [value, text] of [['all', '전체'], ['major', '전공'], ['general', '교양']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    categorySelect.append(option);
  }
  categoryLabel.append(categorySelect);
  const graph = document.createElement('div');

  const rangeTitle = document.createElement('h2');
  rangeTitle.textContent = '학점구간별 예상 인원';
  const countLabel = document.createElement('label');
  countLabel.textContent = '수강자 수: ';
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.min = '0';
  countInput.step = '1';
  countLabel.append(countInput);

  const ratioGroup = document.createElement('div');
  const ratioInputs = new Map();
  for (const grade of ['A+', 'A0', 'B+', 'B0']) {
    const label = document.createElement('label');
    label.textContent = `${grade} 비율(%): `;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = 'any';
    input.style.width = '5em';
    label.append(input);
    ratioGroup.append(label, document.createTextNode(' '));
    ratioInputs.set(grade, input);
  }
  const rangeResult = document.createElement('div');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  section.append(title, categoryLabel, graph, rangeTitle, countLabel, ratioGroup, rangeResult, message);
  container.replaceChildren(section);

  function refreshGraph() {
    try {
      const list = Array.isArray(currentCourses) ? currentCourses : currentCourses?.courses;
      renderSemesterGraph(graph, list, categorySelect.value);
    } catch (error) {
      graph.replaceChildren();
      graph.textContent = error.message;
    }
  }

  function refreshRanges() {
    rangeResult.replaceChildren();
    message.textContent = '';
    if (!currentPolicy) {
      message.textContent = '평가 기준 데이터가 없습니다.';
      return;
    }
    if (countInput.value.trim() === '') {
      message.textContent = '수강자 수를 입력하세요.';
      return;
    }
    for (const [grade, input] of ratioInputs) {
      if (input.value.trim() === '') {
        message.textContent = `${grade} 평가 비율을 입력하세요.`;
        return;
      }
    }
    const distribution = Object.fromEntries(
      [...ratioInputs].map(([grade, input]) => [grade, Number(input.value)])
    );
    try {
      renderGradeRanges(rangeResult, Number(countInput.value), {
        ...currentPolicy,
        gradeDistribution: distribution
      });
    } catch (error) {
      message.textContent = error.message;
    }
  }

  categorySelect.addEventListener('change', refreshGraph);
  countInput.addEventListener('input', refreshRanges);
  for (const input of ratioInputs.values()) input.addEventListener('input', refreshRanges);

  function update({ courses: nextCourses = currentCourses, gradingPolicy: nextPolicy = currentPolicy } = {}) {
    currentCourses = nextCourses;
    currentPolicy = nextPolicy;
    countInput.value = currentPolicy?.studentCount == null ? '' : String(currentPolicy.studentCount);
    const distribution = currentPolicy?.gradeDistribution ?? currentPolicy ?? {};
    for (const [grade, input] of ratioInputs) {
      input.value = typeof distribution[grade] === 'number' ? String(distribution[grade]) : '';
    }
    refreshGraph();
    refreshRanges();
  }

  update();
  return { update, destroy: () => section.remove() };
}
