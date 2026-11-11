# 성적 그래프 및 학점구간 계산 (js/graph)

이 폴더만 수정했습니다. JSON 파일, HTML, CSS, 타 팀원 코드, 테스트 데이터는 변경하지 않았습니다.

## 제공 기능

- `calculateSemesterGpa(courses, category = 'all')`: 학기별 학점 가중 평균평점 반환. `category`는 `all`, `major`, `general`.
- `renderSemesterGraph(container, courses, category)`: 학기별 SVG 선 그래프 표시.
- `calculateGradeRanges(studentCount, gradingPolicy)`: 상대평가 등급별 예상 인원 계산.
- `renderGradeRanges(container, studentCount, gradingPolicy)`: 예상 인원 표 표시.
- `mountGradeDashboard(container, { courses, gradingPolicy })`: 구분 선택, 그래프, 수강자 수 입력, 예상 인원 표를 한 번에 구성. 반환값의 `update({ courses, gradingPolicy })`로 갱신.

## 연동 방법

기존 페이지를 담당하는 팀원이 HTML에 표시 영역을 만들고, JS 모듈에서 다음과 같이 호출하면 됩니다.

```js
import { mountGradeDashboard } from './js/graph/index.js';

const dashboard = mountGradeDashboard(document.getElementById('grade-dashboard'), {
  courses: coursesData,
  gradingPolicy: gradingPolicyData
});

// 데이터 변경 후:
dashboard.update({ courses: updatedCoursesData, gradingPolicy: updatedPolicyData });
```

`coursesData`는 과목 배열 또는 `{ courses: [...] }` 형식입니다. `gradingPolicyData`는 `gradingType`, `studentCount`, `gradeDistribution`을 가진 객체입니다. 등급별 비율은 `gradeDistribution` 안의 `A+`, `A0`, `B+`, `B0` 키로 읽습니다. 각 비율은 누적 비율이 아니라 개별 등급 비율(0~100)입니다. 합계가 100% 미만이면 나머지는 `기타`로 표시합니다.

수강자 수는 사용자가 입력하거나 평가 기준의 `studentCount`로 초기화됩니다. 배분 결과의 합은 수강자 수와 같습니다. 절대평가는 점수 경계 데이터가 없으므로 예상 인원 계산을 지원하지 않습니다.

**주의:** 현재 프로젝트의 `index.html`은 빈 페이지이고 `data/*.json`은 설명용 자리표시자입니다. 이 폴더만 수정하는 조건상 HTML과 데이터 파일을 변경하지 않았으므로, 실제 화면 표시에는 페이지 담당자의 모듈 연결과 실제 데이터 전달이 필요합니다. 재수강 중복 반영과 P/F 등급 처리는 학교 정책 확정 후 별도 조정해야 합니다.
