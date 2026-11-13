# 성적 그래프 및 학점구간 계산

이 디렉터리의 파일만 수정합니다. 다른 기능, HTML, JSON, 테스트 파일은 변경하지 않습니다.

## 공개 API (`index.js`)

- `calculateSemesterGpa(courses, category = 'all')`: 이수 완료 과목의 학기별 학점 가중 평균평점(4.5 만점). `all` / `major` / `general` 구분.
- `renderSemesterGraph(container, courses, category)`: 학기별 SVG 선 그래프.
- `calculateGradeRanges(studentCount, gradingPolicy)`: 평가 비율을 적용한 등급별 예상 인원. 최대 나머지 배분법으로 합계 인원 보존.
- `renderGradeRanges(container, studentCount, gradingPolicy)`: 결과 표 렌더링.
- `mountGradeDashboard(container, { courses, gradingPolicy })`: 그래프 구분 선택, 수강자 수 및 등급별 비율 입력, 예상 인원 표를 제공. 반환된 `update(...)`로 데이터 갱신, `destroy()`로 제거.

## 외부 화면 연동 예시

```js
import { mountGradeDashboard } from './js/graph/index.js';

const dashboard = mountGradeDashboard(document.getElementById('grade-dashboard'), {
  courses: [
    { semester: '2026-1', category: 'major', status: 'completed', credits: 3, grade: 'A+' },
    { semester: '2026-2', category: 'general', status: 'completed', credits: 2, grade: 'B0' }
  ],
  gradingPolicy: {
    gradingType: 'relative', studentCount: 40,
    gradeDistribution: { 'A+': 15, A0: 20, 'B+': 25, B0: 30 }
  }
});
```

`courses`는 배열 또는 `{ courses: [...] }` 형태입니다. 학기는 `YYYY-1` / `YYYY-2`, 분류는 `major` / `general`, 이수 여부는 `completed`, 학점은 양수 숫자, 성적은 A+ ~ F 또는 `gradePoint` 숫자여야 합니다.

등급별 비율은 **누적 비율이 아닌 개별 비율(%)**입니다. 합계가 100% 미만이면 잔여 비율은 `기타`로 배분합니다. 절대평가는 점수 분포 정보가 없어 예상 인원을 계산하지 않습니다.

현재 프로젝트의 최상위 `index.html`과 `data/*.json`은 빈 화면/자리표시자입니다. 담당 범위 외 파일을 변경하지 않았으므로 실제 서비스 화면에는 페이지 담당자의 모듈 연결과 실제 데이터 공급이 필요합니다. 재수강 중복 및 P/F 등급 정책은 별도 확정이 필요합니다.
