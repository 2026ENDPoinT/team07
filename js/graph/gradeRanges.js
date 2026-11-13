/** 등급별 상대평가 예상 인원. 비율은 각 등급의 개별 비율(%)이다. */
const GRADES = [ 'A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0' ];

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
  container.replaceChildren(table);
  return result;
}
