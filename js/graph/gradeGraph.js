/** 학기별 이수 과목의 학점 가중 평균평점(GPA)과 SVG 그래프. */
const CATEGORIES = new Set(['all', 'major', 'general']);
const GRADE_POINTS = { 'A+': 4.5, A0: 4, 'B+': 3.5, B0: 3, 'C+': 2.5, C0: 2, 'D+': 1.5, D0: 1, F: 0 };

// 유효한 이수 완료 과목을 학기별로 묶어 학점 가중 평균을 계산합니다.
export function calculateSemesterGpa(courses, category = 'all') {
  if (!Array.isArray(courses)) throw new TypeError('과목 데이터는 배열이어야 합니다.');
  if (!CATEGORIES.has(category)) throw new RangeError('구분은 all, major, general 중 하나여야 합니다.');
  const grouped = new Map();
  for (const course of courses) {
    if (!course || course.status !== 'completed') continue;
    if (category !== 'all' && course.category !== category) continue;
    if (typeof course.semester !== 'string' || !/^\d{4}-[12]$/.test(course.semester)) continue;
    const credits = course.credits;
    const point = course.gradePoint == null || course.gradePoint === ''
      ? GRADE_POINTS[course.grade] : course.gradePoint;
    if (typeof credits !== 'number' || !Number.isFinite(credits) || credits <= 0 ||
        typeof point !== 'number' || !Number.isFinite(point) || point < 0 || point > 4.5) continue;
    const item = grouped.get(course.semester) ?? { semester: course.semester, total: 0, credits: 0 };
    item.total += credits * point;
    item.credits += credits;
    grouped.set(course.semester, item);
  }
  // 재수강 성적의 인정 방식은 학교별로 달라, 입력된 완료 과목을 모두 반영한다.
  return [...grouped.values()].sort((a, b) => a.semester.localeCompare(b.semester))
    .map(({ semester, total, credits }) => ({ semester, gpa: Math.round((total / credits + Number.EPSILON) * 100) / 100, credits }));
}

// 학기별 GPA를 4.5 만점의 SVG 꺾은선 그래프로 표시합니다.
export function renderSemesterGraph(container, courses, category = 'all') {
  if (typeof Element === 'undefined' || !(container instanceof Element)) throw new TypeError('container는 DOM 요소여야 합니다.');
  const data = calculateSemesterGpa(courses, category);
  container.replaceChildren();
  if (!data.length) { container.textContent = '표시할 이수 성적이 없습니다.'; return data; }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const width = Math.max(760, data.length * 100 + 100);
  const left = 65, right = width - 35, top = 25, bottom = 265;
  svg.setAttribute('viewBox', `0 0 ${width} 330`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${{ all: '전체', major: '전공', general: '교양' }[category]} 학기별 평균평점 그래프`);
  svg.style.width = '100%';
  svg.style.minWidth = `${width}px`;
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const add = (tag, attrs, content) => {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    if (content !== undefined) node.textContent = String(content);
    svg.append(node);
  };
  for (let tick = 0; tick <= 9; tick++) {
    const value = tick / 2;
    const y = bottom - value / 4.5 * (bottom - top);
    add('line', { x1: left, y1: y, x2: right, y2: y, stroke: '#dbe2ea' });
    add('text', { x: 54, y: y + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#475569' }, value.toFixed(1));
  }
  const points = data.map((item, i) => ({
    ...item,
    x: data.length === 1 ? (left + right) / 2 : left + i * (right - left) / (data.length - 1),
    y: bottom - item.gpa / 4.5 * (bottom - top)
  }));
  if (points.length > 1) add('polyline', {
    points: points.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#2563eb', 'stroke-width': 3
  });
  for (const p of points) {
    add('circle', { cx: p.x, cy: p.y, r: 5, fill: '#2563eb' });
    add('text', { x: p.x, y: Math.max(15, p.y - 13), 'text-anchor': 'middle', 'font-size': 13, fill: '#1e40af' }, p.gpa.toFixed(2));
    add('text', { x: p.x, y: 290, 'text-anchor': 'middle', 'font-size': 12, fill: '#334155' }, p.semester);
  }
  container.style.overflowX = 'auto';
  container.append(svg);
  return data;
}
