// js/grades/grades.test.js — grades.js 테스트 (실행: node --test js/grades/grades.test.js)
import test from "node:test";
import assert from "node:assert/strict";
import {
  addCourse,
  updateCourse,
  removeCourse,
  getCourses,
  summarize,
  saveCourses,
  loadCourses,
} from "./grades.js";

function mockStorage(t, storage) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  });
}

// 테스트용 과목 목록: 교양 1개(완료), 전공 2개(완료), 전공 1개(수강 중)
function sample() {
  let list = [];
  list = addCourse(list, { courseName: "미적분학", credits: 3, grade: "A+", semester: "2026-1", category: "general" });
  list = addCourse(list, { courseName: "C프로그래밍", credits: 3, grade: "A0", semester: "2026-1", category: "major" });
  list = addCourse(list, { courseName: "물리학", credits: 3, grade: "F", semester: "2026-1", category: "major" });
  list = addCourse(list, { courseName: "C++프로그래밍", credits: 3, semester: "2026-2", category: "major", status: "in_progress" });
  return list;
}

test("과목을 추가하면 배열에 들어가고 원래 배열은 바뀌지 않는다", () => {
  const before = [];
  const after = addCourse(before, { courseName: "미적분학", credits: "3", grade: "a+", semester: "2026-1", category: "general" });
  assert.equal(before.length, 0);
  assert.equal(after.length, 1);
  assert.equal(after[0].credits, 3); // 문자열 "3" -> 숫자 3
  assert.equal(after[0].grade, "A+"); // 소문자 -> 대문자
  assert.equal(after[0].gradePoint, 4.5); // 성적에서 평점 자동 계산
  assert.equal(after[0].status, "completed"); // 기본값
  assert.equal(after[0].isRetake, false); // 기본값
});

test("과목 객체의 key가 팀 공통 key와 같다", () => {
  const [course] = addCourse([], { courseName: "과목", credits: 3, grade: "B0", semester: "2026-1", category: "minor" });
  assert.deepEqual(
    Object.keys(course).sort(),
    ["category", "courseName", "credits", "grade", "gradePoint", "id", "isRetake", "semester", "status"],
  );
});

test("평점을 직접 넣으면 그 값을 쓴다", () => {
  const [course] = addCourse([], { courseName: "과목", credits: 3, grade: "A0", gradePoint: 3.6, semester: "2026-1", category: "major" });
  assert.equal(course.gradePoint, 3.6);
});

test("잘못된 입력은 오류를 던진다", () => {
  const ok = { courseName: "과목", credits: 3, grade: "A+", semester: "2026-1", category: "major" };
  assert.throws(() => addCourse([], { ...ok, courseName: "  " }), /과목명/);
  assert.throws(() => addCourse([], { ...ok, semester: "" }), /학기/);
  assert.throws(() => addCourse([], { ...ok, credits: 0 }), /학점/);
  assert.throws(() => addCourse([], { ...ok, credits: "abc" }), /학점/);
  assert.throws(() => addCourse([], { ...ok, grade: "Z" }), /성적/);
  assert.throws(() => addCourse([], { ...ok, gradePoint: -1 }), /평점/);
  assert.throws(() => addCourse([], { ...ok, category: "전공" }), /이수 구분/);
  assert.throws(() => addCourse([], { ...ok, status: "done" }), /수강 상태/);
});

test("수강 중인 과목은 성적·평점 없이 입력할 수 있다", () => {
  const list = addCourse([], { courseName: "과목", credits: 3, semester: "2026-2", category: "major", status: "in_progress" });
  assert.equal(list[0].grade, "");
  assert.equal(list[0].gradePoint, null);
});

test("전공·교양·전체로 나누어 조회한다", () => {
  const list = sample();
  assert.equal(getCourses(list).length, 4);
  assert.equal(getCourses(list, { category: "all" }).length, 4);
  assert.deepEqual(getCourses(list, { category: "general" }).map((c) => c.courseName), ["미적분학"]);
  assert.deepEqual(
    getCourses(list, { category: "major" }).map((c) => c.courseName),
    ["C프로그래밍", "물리학", "C++프로그래밍"],
  );
  assert.equal(getCourses(list, { category: "minor" }).length, 0);
});

test("학기·과목명·수강 상태로 조회한다", () => {
  const list = sample();
  assert.equal(getCourses(list, { semester: "2026-1" }).length, 3);
  assert.deepEqual(getCourses(list, { keyword: "C++" }).map((c) => c.courseName), ["C++프로그래밍"]);
  assert.equal(getCourses(list, { status: "in_progress" }).length, 1);
  assert.equal(getCourses(list, { status: "completed" }).length, 3);
  assert.equal(getCourses(list, { category: "major", semester: "2026-1" }).length, 2);
});

test("평균 평점과 학점을 계산한다 (수강 중 제외, F는 취득 학점 제외)", () => {
  const result = summarize(sample());
  // (4.5*3 + 4.0*3 + 0*3) / 9 = 2.83
  assert.equal(result.totalCredits, 9);
  assert.equal(result.earnedCredits, 6);
  assert.equal(result.inProgressCredits, 3);
  assert.equal(result.gpa, 2.83);
});

test("gradePoint가 없는 과목(다른 곳에서 불러온 데이터)도 성적으로 계산한다", () => {
  const result = summarize([{ courseName: "과목", credits: 3, grade: "B+", status: "completed", category: "major" }]);
  assert.equal(result.gpa, 3.5);
});

test("빈 목록은 평점 0으로 계산한다", () => {
  assert.deepEqual(summarize([]), { count: 0, totalCredits: 0, earnedCredits: 0, inProgressCredits: 0, gpa: 0 });
});

test("과목을 삭제한다", () => {
  const list = sample();
  const result = removeCourse(list, list[0].id);
  assert.equal(result.length, 3);
  assert.ok(!result.some((c) => c.courseName === "미적분학"));
});

test("과목 수정은 ID와 다른 과목을 유지하고 성적 변경 시 평점을 다시 계산한다", () => {
  const list = sample();
  const before = structuredClone(list);
  const result = updateCourse(list, list[0].id, { courseName: "미적분학 2", credits: "2", grade: "b+" });
  assert.equal(result[0].id, list[0].id);
  assert.equal(result[0].courseName, "미적분학 2");
  assert.equal(result[0].credits, 2);
  assert.equal(result[0].grade, "B+");
  assert.equal(result[0].gradePoint, 3.5);
  assert.equal(result[0].category, "general");
  assert.equal(result[1], list[1]);
  assert.deepEqual(list, before);
  assert.throws(() => updateCourse(list, list[0].id, { credits: 0 }), /학점/);
  assert.throws(() => updateCourse(list, "missing", {}), /찾을 수 없습니다/);
});

test("수강 상태를 바꾸면 성적·평점을 지우거나 새 성적으로 계산한다", () => {
  const list = sample();
  const inProgress = updateCourse(list, list[0].id, { status: "in_progress" });
  assert.equal(inProgress[0].grade, "");
  assert.equal(inProgress[0].gradePoint, null);
  assert.throws(() => updateCourse(inProgress, list[0].id, { status: "completed" }), /성적/);
  const completed = updateCourse(inProgress, list[0].id, { status: "completed", grade: "A0" });
  assert.equal(completed[0].gradePoint, 4);
  const custom = [{ ...list[0], gradePoint: 3.7 }];
  assert.equal(updateCourse(custom, custom[0].id, { courseName: "새 이름" })[0].gradePoint, 3.7);
});

test("저장된 과목이 없는 경우와 전체 삭제 후 빈 목록을 구분한다", t => {
  const storage = new Map();
  mockStorage(t, {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  });
  assert.equal(loadCourses({ fallback: null }), null);
  const list = sample();
  saveCourses(list);
  const updated = updateCourse(loadCourses(), list[0].id, { grade: "F" });
  saveCourses(updated);
  assert.equal(loadCourses()[0].gradePoint, 0);
  let remaining = loadCourses();
  for (const course of list) remaining = removeCourse(remaining, course.id);
  saveCourses(remaining);
  assert.deepEqual(loadCourses({ fallback: null }), []);
});

test("브라우저 저장 실패를 호출자에게 전달하고 기존 데이터는 유지한다", t => {
  const stored = JSON.stringify(sample());
  mockStorage(t, {
    getItem: () => stored,
    setItem: () => { throw new Error("QuotaExceededError"); }
  });
  assert.throws(() => saveCourses([]), /저장하지 못했습니다/);
  assert.deepEqual(loadCourses(), JSON.parse(stored));
});

test("저장하고 다시 불러온다", () => {
  const list = sample();
  saveCourses(list);
  assert.deepEqual(loadCourses(), list);
});
