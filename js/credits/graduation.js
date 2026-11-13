//졸업까지 남은 학점을 계산하는 스크립트
//@param {Array} courses 과목 데이터 배열
//@param {Object} academicRequirements 졸업 기준 데이터
//@returns {Object} 전체 및 전공 졸업 잔여학점

export function calculateGraduationCredits(courses, academicRequirements) {
    //예외처리 : 배열이 아니면 throw
    if (!Array.isArray(courses)) {
        throw new TypeError("과목 데이터는 배열이어야 합니다.");
    }

    //데이터가 없거나 || "odject"가 아니거나 || gradution이 없으면 throw
    if (
        !academicRequirements ||
        typeof academicRequirements !== "object" ||
        !academicRequirements.graduation
    ) {
        throw new TypeError("졸업 기준 데이터가 올바르지 않습니다.");
    }

    //구조 분해 할당
    const { totalCredits, majorCredits } =
        academicRequirements.graduation;

    //각 숫자가 유한한 값이 아니거나 각각의 값이 0 미만이면 throw
    if (
        !Number.isFinite(totalCredits) ||
        !Number.isFinite(majorCredits) ||
        totalCredits < 0 ||
        majorCredits < 0
    ) {
        throw new TypeError("졸업 필요 학점이 올바르지 않습니다.");
    }

    // 취득 완료 및 수강 중 과목의 학점을 합산
    // 단, 취득 완료 과목 중 F는 제외
    const validCourses = courses.filter(course =>
        course.status === "in_progress" ||
        (course.status === "completed" && course.grade !== "F")
    );

    // 전체 인정 학점
    const calculatedTotalCredits = validCourses.reduce(
        (sum, course) => sum + course.credits,
        0
    );

    // 전공 인정 학점
    const calculatedMajorCredits = validCourses
        .filter(course => course.category === "major")
        .reduce((sum, course) => sum + course.credits, 0);

    return {
        totalRemainingCredits: Math.max(
            totalCredits - calculatedTotalCredits,
            0
        ),

        majorRemainingCredits: Math.max(
            majorCredits - calculatedMajorCredits,
            0
        )
    };
}
