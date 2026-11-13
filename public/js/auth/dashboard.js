
import { calculateCurrentCredits } from "./credits/current.js";
import { calculateEarnedCredits } from "./credits/earned.js";
import { calculateCompletionCredits } from "./credits/completion.js";
import { calculateCumulativeGPA } from "./grades/gpa.js";
import { loadCourses } from "./grades/grades.js";

const elements = {
    userName: document.querySelector("#user-name"),
    cumulativeGpa: document.querySelector("#cumulative-gpa"),
    earnedCredits: document.querySelector("#earned-credits"),
    currentCredits: document.querySelector("#current-credits"),
    completionCredits: document.querySelector("#completion-credits"),
    courseList: document.querySelector("#course-list"),
    message: document.querySelector("#dashboard-message"),
    logoutButton: document.querySelector("#logout-button")
};

// 숫자 표시 형식
function formatNumber(value) {
    return Number.isFinite(value) ? String(value) : "--";
}

// 로그인 상태 확인
async function checkLogin() {
    const response = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin"
    });

    if (!response.ok) {
        window.location.replace("/login.html");
        return null;
    }

    const data = await response.json();
    return data.user ?? data;
}

// 학업 기준 데이터 불러오기
async function loadAcademicRequirements() {
    const response = await fetch("/data/academic_requirements.json");

    if (!response.ok) {
        throw new Error("학업 기준 데이터를 불러오지 못했습니다.");
    }

    return response.json();
}

// 과목 목록 출력
function renderCourses(courses) {
    elements.courseList.replaceChildren();

    if (!Array.isArray(courses) || courses.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 5;
        cell.className = "empty-message";
        cell.textContent = "등록된 과목이 없습니다.";

        row.appendChild(cell);
        elements.courseList.appendChild(row);
        return;
    }

    courses.forEach(course => {
        const row = document.createElement("tr");

        const values = [
            course.courseName ?? "-",
            course.credits ?? "-",
            course.grade ?? "-",
            course.semester ?? "-",
            course.status === "completed" ? "이수 완료" :
                course.status === "in_progress" ? "수강 중" : "-"
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });

        elements.courseList.appendChild(row);
    });
}

// 대시보드 요약 정보 갱신
async function renderDashboard(user) {
    const [courses, academicRequirements] = await Promise.all([
        Promise.resolve(loadCourses()),
        loadAcademicRequirements()
    ]);

    if (!Array.isArray(courses)) {
        throw new Error("과목 데이터 형식이 올바르지 않습니다.");
    }

    const currentCredits = calculateCurrentCredits(courses);
    const earnedCredits = calculateEarnedCredits(courses);
    const gpaResult = calculateCumulativeGPA(courses);

    const targetYear = Number(user.grade);

    const completionCredits = calculateCompletionCredits(
        earnedCredits,
        academicRequirements,
        targetYear
    );

    elements.userName.textContent =
        user.department
            ? `${user.department} ${targetYear}학년`
            : "사용자";

    elements.cumulativeGpa.textContent =
        gpaResult.gpa === null
            ? "--"
            : Number(gpaResult.gpa).toFixed(2);

    elements.earnedCredits.textContent =
        formatNumber(earnedCredits);

    elements.currentCredits.textContent =
        formatNumber(currentCredits);

    elements.completionCredits.textContent =
        formatNumber(completionCredits);

    renderCourses(courses);
}

// 로그아웃
async function logout() {
    try {
        const response = await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin"
        });

        if (!response.ok) {
            throw new Error("로그아웃 요청에 실패했습니다.");
        }

        window.location.replace("/login.html");
    } catch (error) {
        elements.message.textContent = error.message;
    }
}

// 초기 실행
async function initDashboard() {
    try {
        const user = await checkLogin();

        if (!user) return;

        await renderDashboard(user);
    } catch (error) {
        elements.message.textContent =
            `대시보드 초기화 실패: ${error.message}`;
    }
}

elements.logoutButton.addEventListener("click", logout);

initDashboard();
