import { getEffectiveCourses } from "../grades/grades.js";

//현재 수강학점 계산
//@param {Array} courses : 과목데이터 배열 
//@returns {number} 현재 수강학점

export function calculateCurrentCredits(courses) {
    //데이터 유효 검사 >> 배열이 아니면 throw
    if(!Array.isArray(courses)) {
        throw new TypeError("과목 데이터는 배열이어야 합니다.");
    }

    // 재수강 이전 기록 제외
    const effectiveCourses = getEffectiveCourses(courses);

    //filter : 조건이 true인 것만 모아 새 배열 만들기 >> 엄격한 비교 확인 ===
    //currentCourses : filter를 이용해 새로 만들어진 배열 "in_progress" 상태인 객체 모음
    const currentCourses = effectiveCourses.filter(
        course => course.status === "in_progress"
    );

    //sum에 course.credits(학점)을 합함
    //totalCredits : reduce를 이용해 만들어진 Number 자료 >> sum의 누적 합계를 받음
    const totalCredits = currentCourses.reduce(
        (sum, course) => sum + course.credits,
        0 //누적값(sum) 초기화 위해 사용 & 반환 타입(num) 결정
    );

    return totalCredits;
}
