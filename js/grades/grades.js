// js/grades/grades.js — 성적 입력·저장·조회
//
// 과목 하나는 팀 공통 key(courses.json)와 같은 모양의 객체
//   {
//     id:         "고유번호",        // (내 모듈에서 삭제할 때 쓰려고 추가한 값)
//     courseName: "미적분학",        // 과목명 (String)
//     credits:    3,                 // 학점 (Number, int)
//     grade:      "A+",              // 성적 (String). 수강 중이면 ""
//     gradePoint: 4.5,               // 평점 (Number, float). 수강 중이면 null
//     semester:   "2026-1",          // 학기 (String)
//     status:     "completed",       // 수강 상태 (String): "completed" | "in_progress"
//     category:   "general",         // 이수 구분 (String): "major" | "minor" | "general"
//     isRetake:   false              // 재수강 여부 (Boolean)
//   }
//
// 아래 함수들은 "과목 배열"을 받아서 새 결과를 돌려줌. 원래 배열은 건드리지 않아서
// 테스트하기 쉽고, 화면(HTML)에서도 그대로 가져다 쓸 수 있습니다.

export const GRADE_POINTS = {
  "A+": 4.5, "A0": 4.0,
  "B+": 3.5, "B0": 3.0,
  "C+": 2.5, "C0": 2.0,
  "D+": 1.5, "D0": 1.0,
  "F": 0,
};

export const CATEGORIES = ["major", "minor", "general"];
export const STATUSES = ["completed", "in_progress"];

// 화면에 보여줄 한글 이름
export const CATEGORY_LABELS = { major: "전공", minor: "부전공", general: "교양" };

// ---------- 입력 ----------

// 입력값을 검사하고 과목 객체 하나를 만듦. 잘못된 값이면 Error를 던짐.
// gradePoint를 생략하면 성적(grade)에서 자동으로 계산.
export function createCourse({
  courseName,
  credits,
  grade = "",
  gradePoint,
  semester,
  status = "completed",
  category,
  isRetake = false,
}) {
  courseName = String(courseName ?? "").trim();
  semester = String(semester ?? "").trim(); // 예: "2026-1"
  credits = Number(credits);
  grade = String(grade ?? "").trim().toUpperCase();

  if (!courseName) throw new Error("과목명을 입력해 주세요.");
  if (!semester) throw new Error("학기를 입력해 주세요. (예: 2026-1)");
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error("학점은 0보다 큰 숫자여야 해요.");
  }
  if (!CATEGORIES.includes(category)) {
    throw new Error("이수 구분은 " + CATEGORIES.join(", ") + " 중 하나여야 해요.");
  }
  if (!STATUSES.includes(status)) {
    throw new Error("수강 상태는 " + STATUSES.join(", ") + " 중 하나여야 해요.");
  }

  let point = null; // 수강 중인 과목은 아직 평점이 없음
  if (status === "in_progress") {
    grade = "";
  } else {
    if (!Object.hasOwn(GRADE_POINTS, grade)) {
      throw new Error("성적은 " + Object.keys(GRADE_POINTS).join(", ") + " 중 하나여야 해요.");
    }
    const given = gradePoint === undefined || gradePoint === null || gradePoint === "";
    point = given ? GRADE_POINTS[grade] : Number(gradePoint);
    if (!Number.isFinite(point) || point < 0) {
      throw new Error("평점은 0 이상의 숫자여야 해요.");
    }
  }

  return {
    id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    courseName,
    credits,
    grade,
    gradePoint: point,
    semester,
    status,
    category,
    isRetake: Boolean(isRetake),
  };
}

// 과목 하나를 추가한 새 배열을 돌려주기.
export function addCourse(courses, input) {
  return [...courses, createCourse(input)];
}

// 기존 과목의 ID를 유지하면서 입력값과 성적에 따른 평점을 검증합니다.
export function updateCourse(courses, id, input) {
  const course = courses.find(c => c.id === id);
  if (!course) throw new Error("수정할 과목을 찾을 수 없습니다.");
  const gradeChanged = Object.hasOwn(input, "grade") &&
    String(input.grade ?? "").trim().toUpperCase() !== course.grade;
  const gradePoint = Object.hasOwn(input, "gradePoint") ? input.gradePoint :
    gradeChanged ? undefined : course.gradePoint;
  const updated = { ...course, ...createCourse({ ...course, ...input, gradePoint }), id };
  return courses.map(c => c.id === id ? updated : c);
}

// 과목 하나를 뺀 새 배열을 돌려주기. (잘못 입력했을 때 지우는 용도)
export function removeCourse(courses, id) {
  return courses.filter((c) => c.id !== id);
}

// ---------- 조회 ----------

// 조건에 맞는 과목만 골라서 돌려주기. 조건은 전부 생략할 수 있음.
//   category: "all" | "major" | "minor" | "general"   (기본값 "all" = 전체)
//   semester: "2026-1" 처럼 지정하면 그 학기만
//   keyword : 과목명에 이 글자가 들어간 과목만
//   status  : "in_progress"면 수강 중인 과목만, "completed"면 수강 완료 과목만
export function getCourses(courses, { category = "all", semester, keyword, status } = {}) {
  return courses.filter((c) => {
    if (category !== "all" && c.category !== category) return false;
    if (semester && c.semester !== semester) return false;
    if (keyword && !c.courseName.includes(keyword)) return false;
    if (status && c.status !== status) return false;
    return true;
  });
}

// 과목 목록의 학점과 평균 평점을 계산.
//   - 수강 중인 과목은 성적이 없어서 평점 계산에서 빼고, inProgressCredits로 따로 셈.
//   - F는 평점 계산에는 들어가지만 취득 학점(earnedCredits)에는 안 들어감.
//   - 재수강 과목 처리 규칙은 아직 정해지지 않아서 지금은 일반 과목과 똑같이 계산.
export function summarize(courses) {
  let totalCredits = 0;
  let earnedCredits = 0;
  let inProgressCredits = 0;
  let weightedSum = 0;

  for (const c of courses) {
    if (c.status === "in_progress") {
      inProgressCredits += c.credits;
      continue;
    }
    totalCredits += c.credits;
    weightedSum += (c.gradePoint ?? GRADE_POINTS[c.grade]) * c.credits;
    if (c.grade !== "F") earnedCredits += c.credits;
  }

  const gpa = totalCredits === 0 ? 0 : weightedSum / totalCredits;
  return {
    count: courses.length,
    totalCredits,
    earnedCredits,
    inProgressCredits,
    gpa: Math.round(gpa * 100) / 100,
  };
}
