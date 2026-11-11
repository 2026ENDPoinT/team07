//취득학점 계산
//@param {Array} courses : 과목 데이터 배열
//@returns {number} : 취득학점

export function calculateEarnedCredits(courses) {
    //데이터 유효 검사 & 예외 throw
    if(!Array.isArray(courses)) {
        throw new TypeError("과목 데이터는 배열이어야 합니다.");
    }

    // 수강 완료 및 F가 아닌 과목 개체 추출
    // filter : 조건이 true인 것만 모아 새 배열 만들기 >> 엄격한 비교 확인 ===
    // completedCourses : filter를 이용해 새로 만들어진 배열 "completed" 이고 "F"가 아닌 상태인 객체 모음
    const completedCourses = courses.filter(
        course => course.status === "completed" && course.grade !== "F"
    );

    //취득학점 합산
    const totalCredits = completedCourses.reduce(
        (sum, course) => sum + course.credits,
        0
    );

    return totalCredits //취득한 학점 반환
}
