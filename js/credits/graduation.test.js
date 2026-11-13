import { calculateGraduationCredits } from "./graduation.js";

// test data
const academicRequirements = {
    graduation: {
        totalCredits: 130,
        majorCredits: 70,
        minorCredits: 30,
        doubleMajorCredits: 36,
        generalCredits: 30
    }
};

const courses = [
    {
        courseName: "자료구조",
        credits: 3,
        grade: "A",
        status: "completed",
        category: "major"
    },
    {
        courseName: "미적분학",
        credits: 3,
        grade: "B",
        status: "completed",
        category: "general"
    },
    {
        courseName: "프로그래밍",
        credits: 3,
        grade: null,
        status: "in_progress",
        category: "major"
    },
    {
        courseName: "컴퓨터개론",
        credits: 3,
        grade: "F",
        status: "completed",
        category: "major"
    }
];

// run test
const result = calculateGraduationCredits(
    courses,
    academicRequirements
);

console.log(result);
// expected:
// { totalRemainingCredits: 121, majorRemainingCredits: 64 }
