//학년 수료까지 남은 학점 계산
//@param {number} earnedCredits 현재 누적 취득 학점 {*earned.js 에서 계산한 반환값*}
//@param {object} academicRequirements 학사 기준 데이터(학년의 수료 학점 기준)
//@param {number} targetYear 목표 학년
//@returns {number} 수료까지 남은 학점


export function calculateCompletionCredits(
    earnedCredits,
    academicRequirements,
    targetYear
) {
    // 데이터 유효성 검사 : 입력 받은 param (유한수가 아니거나 0 미만인 수면 throw)
    if (!Number.isFinite(earnedCredits) || earnedCredits < 0) {
        throw new TypeError("취득학점은 0 이상의 숫자여야 합니다.");
    }

    // 데이터 유효성 검사 (값이 없거나 || "object" 타입이 아니거나 || completion key가 없으면 throw)
    if (!academicRequirements || typeof academicRequirements !== "object" || !academicRequirements.completion) {
        throw new TypeError("학년 수료 기준 데이터가 올바르지 않습니다.");
    }

    // 목표 학년에 해당하는 JSON Key 설정 (mapping table)
    const yearKeys = {
        1: "firstYear",
        2: "secondYear",
        3: "thirdYear",
        4: "fourthYear"
    };
    //key - mapping
    const targetKey = yearKeys[targetYear];

    //입력 유효성 검사 (undefined(falsy)이면 throw)
    if (!targetKey) {
        throw new RangeError("목표 학년은 1~4 사이여야 합니다.");
    }

    // JSON에서 해당 학년의 누적 수료 기준 학점 가져오기
    const requiredCredits = academicRequirements.completion[targetKey];

    //입력 유효성 검사 : json mapped value check (유한수가 아니거나 || 0 미만이면 throw)
    if (!Number.isFinite(requiredCredits) || requiredCredits < 0) {
        throw new TypeError("수료 기준 학점이 올바르지 않습니다.");
    }

    // 수료까지 남은 학점 계산 (남은 수료학점 계산 / 만일 음수면 0을 반환하기 위해 Math.max 사용)
    const remainingCredits = Math.max( 
        requiredCredits - earnedCredits,
        0
    ); //Math : js 내장 객체 / .max() 최댓값 반환

    return remainingCredits;
}
