/** 등급별 상대평가 예상 인원. 비율은 각 등급의 개별 비율(%)이다. */
const GRADES = [ 'A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0' ];

// 상대평가 비율을 검증하고 총 수강자 수에 맞춰 등급별 인원을 배분합니다.
export function calculateGradeRanges(studentCount, gradingPolicy) {
  if (!Number.isSafeInteger(studentCount) || studentCount < 0) {
    throw new RangeError('수강자 수는 0 이상의 정수여야 합니다.');
  }
  if (!gradingPolicy || typeof gradingPolicy !== 'object' || Array.isArray(gradingPolicy)) {
    throw new TypeError('평가 기준 객체가 필요합니다.');
  }
  const { gradingType, studentCount: policyCount } = gradingPolicy;
  if (gradingType != null && gradingType !== 'relative' && gradingType !== 'absolute') {
    throw new RangeError('평가 방식은 relative 또는 absolute여야 합니다.');
  }
  if (gradingType === 'absolute') {
    throw new RangeError('절대평가는 점수 기준이 필요하므로 수강자 수와 비율만으로 등급별 인원을 예측할 수 없습니다.');
  }
  if (policyCount != null && (!Number.isSafeInteger(policyCount) || policyCount < 0)) {
    throw new RangeError('평가 기준의 studentCount는 0 이상의 정수여야 합니다.');
  }
  const distribution = gradingPolicy.gradeDistribution ?? gradingPolicy;
  if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) {
    throw new TypeError('gradeDistribution 객체가 필요합니다.');
  }
  const entries = GRADES.map((grade, index) => {
    const raw = distribution[grade];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) {
      throw new RangeError(`${grade} 비율은 0~100 사이 숫자여야 합니다.`);
    }
    return { grade, percentage: raw, index };
  });
  const total = entries.reduce((sum, e) => sum + e.percentage, 0);
  if (total > 100 + 1e-9) throw new RangeError('평가 비율 합계는 100%를 초과할 수 없습니다.');
  // 지정된 등급 비율의 합이 100%보다 작으면 남은 비율은 기타로 분류합니다.
  if (total < 100 - 1e-9) entries.push({ grade: '기타', percentage: 100 - total, index: entries.length });
  // 최대 나머지 방식: 소수 부분이 큰 등급부터 남은 인원을 배분한다.
  const allocated = entries.map(e => {
    const exact = studentCount * e.percentage / 100;
    const count = Math.floor(exact);
    return { ...e, count, remainder: exact - count };
  });
  const missing = studentCount - allocated.reduce((sum, e) => sum + e.count, 0);
  const ranked = [...allocated].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < missing; i++) ranked[i].count++;
  return allocated.map(({ grade, percentage, count }) => ({ grade, percentage: Number(percentage.toFixed(8)), count }));
}

/** 상대평가 예상 인원을 SVG 막대그래프로 표현한다. */
export function renderGradeRangeBarChart(container, result) {
  if (typeof Element === 'undefined' || !(container instanceof Element)) {
    throw new TypeError('container는 DOM 요소여야 합니다.');
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}, text = null) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text != null) el.textContent = text;
    return el;
  };

  const width = 720;
  const height = 320;
  const left = 52;
  const right = 18;
  const top = 38;
  const bottom = 56;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxCount = Math.max(1, ...result.map(item => item.count));
  const tickStep = Math.max(1, Math.ceil(maxCount / 5));
  const axisMax = Math.ceil(maxCount / tickStep) * tickStep;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `등급별 예상 인원 막대그래프: ${result.map(item => `${item.grade} ${item.count}명`).join(', ')}`,
    style: 'display:block;width:100%;max-width:760px;height:auto;'
  });
  svg.append(svgEl('title', {}, '학점구간별 예상 인원 막대그래프'));

  for (let tick = 0; tick <= axisMax; tick += tickStep) {
    const y = top + plotHeight * (1 - tick / axisMax);
    svg.append(svgEl('line', { x1: left, y1: y, x2: width - right, y2: y,
      stroke: '#e2e8f0', 'stroke-width': 1 }));
    svg.append(svgEl('text', { x: left - 10, y: y + 4, 'text-anchor': 'end',
      'font-size': 12, fill: '#475569' }, String(tick)));
  }
  svg.append(svgEl('text', { x: left, y: 19, 'font-size': 13, fill: '#334155' }, '예상 인원 (명)'));

  const slot = plotWidth / Math.max(1, result.length);
  const barWidth = Math.min(56, slot * 0.62);
  result.forEach((item, i) => {
    const x = left + slot * (i + 0.5);
    const barHeight = item.count / axisMax * plotHeight;
    const y = top + plotHeight - barHeight;
    const bar = svgEl('rect', {
      x: x - barWidth / 2, y, width: barWidth, height: barHeight,
      rx: 4, fill: '#2563eb'
    });
    bar.append(svgEl('title', {}, `${item.grade}: ${item.count}명 (${item.percentage}%)`));
    svg.append(bar);
    svg.append(svgEl('text', { x, y: Math.max(top + 13, y - 7),
      'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600,
      fill: '#1e293b' }, `${item.count}명`));
    svg.append(svgEl('text', { x, y: height - bottom + 22,
      'text-anchor': 'middle', 'font-size': 13, fill: '#334155' }, item.grade));
  });
  container.replaceChildren(svg);
  return svg;
}

// 같은 예상 인원 계산 결과로 막대그래프와 상세 표를 함께 표시합니다.
export function renderGradeRanges(container, studentCount, gradingPolicy) {
  if (typeof Element === 'undefined' || !(container instanceof Element)) {
    throw new TypeError('container는 DOM 요소여야 합니다.');
  }
  const result = calculateGradeRanges(studentCount, gradingPolicy);
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = `등급별 예상 인원 (총 ${studentCount}명)`;
  table.append(caption);
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const label of ['등급', '평가 비율', '예상 인원']) {
    const th = document.createElement('th'); th.textContent = label; tr.append(th);
  }
  thead.append(tr); table.append(thead);
  const tbody = document.createElement('tbody');
  for (const item of result) {
    const row = document.createElement('tr');
    for (const value of [item.grade, `${item.percentage}%`, `${item.count}명`]) {
      const td = document.createElement('td'); td.textContent = value; row.append(td);
    }
    tbody.append(row);
  }
  table.append(tbody);
  const chart = document.createElement('div');
  chart.className = 'grade-range-bar-chart';
  renderGradeRangeBarChart(chart, result);
  container.replaceChildren(chart, table);
  return result;
}
