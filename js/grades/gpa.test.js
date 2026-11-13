import { calculateSemesterGPA, calculateCumulativeGPA } from "./gpa.js";

//json data for test
const testCourses = [
    {
        courseName: "자료구조",
        credits: 3,
        grade: "A+",
        gradePoint: 4.5,
        semester: "2026-1",
        status: "completed"
    },
    {
        courseName: "미적분학",
        credits: 3,
        grade: "A0",
        gradePoint: 4.0,
        semester: "2026-1",
        status: "completed"
    },
    {
        courseName: "프로그래밍",
        credits: 2,
        grade: "B+",
        gradePoint: 3.5,
        semester: "2026-1",
        status: "completed"
    },
    {
        courseName: "컴퓨터구조",
        credits: 3,
        grade: "B0",
        gradePoint: 3.0,
        semester: "2026-2",
        status: "completed"
    },
    {
        courseName: "운영체제",
        credits: 3,
        grade: "F",
        gradePoint: 0.0,
        semester: "2026-2",
        status: "completed"
    },
    {
        courseName: "데이터베이스",
        credits: 3,
        grade: null,
        gradePoint: null,
        semester: "2026-2",
        status: "in_progress"
    }
];

//run test
//gpa for semester
console.log(calculateSemesterGPA(testCourses, "2026-1"));
//expected to : {gpa, 산정 학점, 등록 학점} = {4.06, 8, 8}
console.log(calculateSemesterGPA(testCourses,"2026-2"))
//expected to : {gpa, 산정 학점, 등록 학점} = {1.50, 6, 9}

//gpa for all
console.log(calculateCumulativeGPA(testCourses))
//expected to : {gpa, 산정 학점, 등록 학점} = {2.96, 14, 17}
