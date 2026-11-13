
import { calculateCurrentCredits } from "/js/credits/current.js";
import { calculateEarnedCredits } from "/js/credits/earned.js";
import { calculateCompletionCredits } from "/js/credits/completion.js";
import { calculateCumulativeGPA } from "/js/grades/gpa.js";
import { loadCourses } from "/js/grades/grades.js";
import { mountGradeDashboard } from "/js/graph/index.js";
import { authRequest } from "/js/auth/api.js";

const elements = {
    userName: document.querySelector("#user-name"),
    cumulativeGpa: document.querySelector("#cumulative-gpa"),
    earnedCredits: document.querySelector("#earned-credits"),
    currentCredits: document.querySelector("#current-credits"),
    completionCredits: document.querySelector("#completion-credits"),
    courseList: document.querySelector("#course-list"),
    message: document.querySelector("#dashboard-message"),
    logoutButton: document.querySelector("#logout-button"),
    dataSource: document.querySelector("#data-source"),
    gradeDashboard: document.querySelector("#grade-dashboard")
};

// 숫자 표시 형식
function formatNumber(value) {
    return Number.isFinite(value) ? String(value) : "--";
}

// 로그인 상태 확인
async function checkLogin() {
    try {
        const { user } = await authRequest("me");
        return user;
    } catch (error) {
        if (error.status !== 401) throw error;
        window.location.replace("/login.html");
        return null;
    }
}

// 서버가 제공하는 학사 예시 JSON을 읽습니다.
async function loadData(name) {
    const response = await fetch(`/data/${name}.json`);
    if (!response.ok) throw new Error(`${name} 데이터를 불러오지 못했습니다.`);
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
    elements.userName.textContent = `${user.name}님`;
    const [userInfo, academicRequirements, gradingPolicy] = await Promise.all([
        loadData("user_info"),
        loadData("academic_requirements"),
        loadData("grading_policy")
    ]);
    let courses = loadCourses();
    if (!Array.isArray(courses)) {
        throw new Error("과목 데이터 형식이 올바르지 않습니다.");
    }
    const usingExamples = courses.length === 0;
    if (usingExamples) {
        const example = await loadData("courses");
        courses = example.courses;
        if (!Array.isArray(courses)) throw new Error("예시 과목 데이터 형식이 올바르지 않습니다.");
    }
    elements.dataSource.textContent =
        `${usingExamples ? "예시 과목 데이터" : "이 브라우저에 저장된 과목 데이터"} · ` +
        `학적·수료 기준은 예시입니다 (${userInfo.department} ${userInfo.grade}학년). ` +
        "과목은 로그인 계정별로 저장되거나 서버와 동기화되지 않습니다.";

    const currentCredits = calculateCurrentCredits(courses);
    const earnedCredits = calculateEarnedCredits(courses);
    const gpaResult = calculateCumulativeGPA(courses);

    const targetYear = Number(userInfo.grade);

    const completionCredits = calculateCompletionCredits(
        earnedCredits,
        academicRequirements,
        targetYear
    );

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
    mountGradeDashboard(elements.gradeDashboard, { courses, gradingPolicy });
}

// 로그아웃
async function logout() {
    elements.logoutButton.disabled = true;
    try {
        await authRequest("logout", {});
        window.location.replace("/login.html");
    } catch (error) {
        elements.message.textContent = error.message;
    } finally {
        elements.logoutButton.disabled = false;
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

// 로그아웃 이벤트 등록
elements.logoutButton.addEventListener("click", logout);

// 대시보드 실행
initDashboard();
