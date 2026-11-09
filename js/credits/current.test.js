//current.js 에서 함수 불러오기
import { calculateCurrentCredits } from "./current.js";

//test data
const courses = [
    { courseName: "자료구조", credits: 3, status: "in_progress" },
    { courseName: "미분적분학", credits: 3, status: "completed" },
    { courseName: "컴퓨터개론", credits: 2, status: "in_progress" }
];

//함수 call
const result = calculateCurrentCredits(courses);
//예상 결과
const expected = 5;
//확인
if(result === expected) {
    console.log("success");
    console.log("현재 수강학점:", result);
}
else {
    console.log("fail");
    console.log("expected:", expected);
    console.log("return", result);
}