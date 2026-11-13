import { calculateEarnedCredits } from "./earned.js";

//for test json data
const testCourses = [
    {
        courseName: "자료구조",
        credits: 3,
        status: "completed",
        grade: "A"
    },
    {
        courseName: "미분적분학",
        credits: 3,
        status: "completed",
        grade: "F"
    },
    {
        courseName: "컴퓨터개론",
        credits: 2,
        status: "in_progress",
        grade: null
    }
];

//run test
// 테스트 실행
const result = calculateEarnedCredits(testCourses);

console.log("취득학점:", result); //expected == 3
