import { getEffectiveCourses } from "./grades.js";

//gpa 계산 구현 스크립트
//@param {Array} courses 과목 데이터 배열
//@param {string|null} semester 학기 (null 이면 전체) : 이때의 학기는 사용자의 선택 학기를 나타냄
//@returns {Object} GPA 및 학점 정보 
function calculateGPA(courses, semester = null, applyRetake = false) {
    //데이터 유효성 검사 : 과목 데이터가 배열이 아니면 throw
    if (!Array.isArray(courses)) {
        throw new TypeError("과목 데이터는 배열이어야 합니다.");
    }

    // 누적 GPA 계산일 경우 재수강 이전 기록 제외
    const sourceCourses = applyRetake
    ? getEffectiveCourses(courses)
    : courses;

    //특정 학기 또는 전체 과목 선택 (Null => 전체 || semester => 사용자 지정 학기)
    const targetCourses = sourceCourses.filter(course =>
        semester === null || course.semester === semester
    ); //filter >> 

    //등록 학점 계산(이수 완료 "completed" + 수강 중"in_progress")
    const registeredCourses = targetCourses.filter(
        course =>
            course.status === "completed" ||
            course.status === "in_progress"
    );

    //바로 위 계산 결과의 배열을 가져와 학점계산 후 반환
    const registeredCredits = registeredCourses.reduce(
        (sum, course) => {
            if (!Number.isFinite(course.credits) || course.credits <= 0) {
                throw new TypeError("과목 학점은 0보다 큰 숫자여야 합니다.");
            }

            return sum + course.credits;
        },
        0
    );

    // 이전전 단계의 결과에서 이수 완료(수강 완료) 된 것 만 filter 
    // GPA 계산 대상 과목 (이수 완료 과목)
    const completedCourses = registeredCourses.filter(
        course => course.status === "completed"
    );

    // GPA 계산 대상 과목 (P/NP 제외)
    const gpaCourses = completedCourses.filter(
        course => course.gradePoint !== null
    );

    //성적 평점 유효성 검사 : 0 미만 || 4.5 초과 throw
    completedCourses.forEach(course => {
        if (
            !Number.isFinite(course.gradePoint) ||
            course.gradePoint < 0 ||
            course.gradePoint > 4.5
        ) {
            throw new TypeError("성적 평점 데이터가 올바르지 않습니다.");
        }
    }); //isFinitie >> 값이 유한한 숫자인지 검사

    //평점 × 학점의 합
    const totalGradePoints = gpaCourses.reduce(
        (sum, course) => sum + (course.credits * course.gradePoint),
        0
    ); 

    //GPA 산정 대상 학점 합
    const gpaCredits = gpaCourses.reduce(
        (sum, course) => sum + course.credits,
        0
    );

    // GPA 계산 (평점 산정 대상 과목이 없으면 null)
    const gpa = gpaCredits === 0
        ? null
        : Number((totalGradePoints / gpaCredits).toFixed(2));
    // ? 조건식 : gpaCredits === 0 이면 null, 아니면 뒤의 식
    // toFixed(2) 소수점 반올림

    return {
        gpa,
        gpaCredits,
        registeredCredits
    }; 
}



//학기별 GPA 계산
//@param {Array} courses 과목 데이터 배열
//@param {string} semester 조회할 학기
//@returns {Object} 학기별 GPA 및 학점 정보
export function calculateSemesterGPA(courses, semester) {
    //데이터 유효성 검사 : 유효한 문자열이 아니거나 || 빈 문자열이면 throw
    if (typeof semester !== "string" || semester.length === 0) {
        throw new TypeError("학기 정보가 올바르지 않습니다.");
    }

    return calculateGPA(courses, semester);
}


//전체 누적 GPA 계산
//@param {Array} courses 과목 데이터 배열
//@returns {Object} 누적 GPA 및 학점 정보
export function calculateCumulativeGPA(courses) {
    return calculateGPA(courses, null, true);
}

// 중요!! : calculateSemesterGPA() 와 calculateCumulativeGPA 함수는 아래의 형식으로 반환합니다
/*
{
    gpa: Number | null,
    gpaCredits: Number,
    registeredCredits: Number
}
*/
