import { authRequest } from "/js/auth/api.js";
import { createAcademicClient } from "/js/academic-api.js";
import { calculateCumulativeGPA, calculateSemesterGPA } from "/js/grades/gpa.js";
import { calculateSemesterGpa, mountGradeDashboard } from "/js/graph/index.js";

const userName = document.querySelector("#user-name");
const logoutButton = document.querySelector("#logout-button");
const message = document.querySelector("#analysis-message");
const container = document.querySelector("#grade-dashboard");
const semesterSelect = document.querySelector("#gpa-semester");

// 학기를 실제 시간순(1학기 → 여름 → 2학기 → 겨울)으로 정렬하기 위한 값입니다.
function semesterOrder(semester) {
    const match = /^(\d{4})-(1|여름|2|겨울)$/.exec(semester);
    if (!match) return -1; // 예상하지 못한 형식의 학기는 목록 맨 아래로 보냅니다.
    const order = { "1": 1, "여름": 2, "2": 3, "겨울": 4 };
    return Number(match[1]) * 10 + order[match[2]];
}

// 학기 선택 목록을 만들고 선택한 학기의 GPA를 표시합니다.
function setupSemesterGpa(courses, latestCompletedSemester) {
    const semesters = [...new Set(courses
        .filter(course => ["completed", "in_progress"].includes(course.status))
        .map(course => course.semester)
        .filter(semester => typeof semester === "string" && /^\d{4}-(1|2|여름|겨울)$/.test(semester)))]
        .sort((a, b) => semesterOrder(b) - semesterOrder(a));
    if (!semesters.length) return;

    semesterSelect.replaceChildren(...semesters.map(semester => {
        const option = document.createElement("option");
        const [year, term] = semester.split("-");
        option.value = semester;
        option.textContent = term === "여름" || term === "겨울"
            ? `${year}년 ${term} 계절학기`
            : `${year}년 ${term}학기`;
        return option;
    }));
    semesterSelect.value = latestCompletedSemester ?? semesters[0];
    semesterSelect.disabled = false;

    // 성적이 없는 학기는 안내 문구를 표시합니다.
    const refreshSemesterGpa = () => {
        const { gpa, gpaCredits } = calculateSemesterGPA(courses, semesterSelect.value);
        document.querySelector("#semester-gpa").textContent = gpa === null ? "--" : gpa.toFixed(2);
        document.querySelector("#semester-gpa-description").textContent = gpa === null
            ? "선택한 학기에 이수 성적이 없습니다."
            : `4.5 만점 · GPA 산정 학점 ${gpaCredits}학점`;
    };
    semesterSelect.addEventListener("change", refreshSemesterGpa);
    refreshSemesterGpa();
}

// 서버에서 과목 또는 평가 기준의 예시 JSON을 읽습니다.
async function loadData(name) {
    const response = await fetch(`/data/${name}.json`);
    if (!response.ok) throw new Error(`${name} 데이터를 불러오지 못했습니다.`);
    return response.json();
}

// 로그인 확인 후 과목과 평가 기준을 불러와 성적 요약과 그래프를 구성합니다.
async function initAnalysis() {
    try {
        const { user } = await authRequest("me");
        userName.textContent = `${user.name}님`;

        const [state, gradingPolicy] = await Promise.all([
            createAcademicClient(user.id).load(),
            loadData("grading_policy")
        ]);
        const courses = state.courses;
        if (!Array.isArray(courses)) throw new Error("과목 데이터 형식이 올바르지 않습니다.");

        const semesters = calculateSemesterGpa(courses);
        const latest = semesters.at(-1);
        const { gpa } = calculateCumulativeGPA(courses);
        document.querySelector("#analysis-gpa").textContent = gpa === null ? "--" : Number(gpa).toFixed(2);
        setupSemesterGpa(courses, latest?.semester);
        document.querySelector("#semester-count").textContent = String(semesters.length);
        document.querySelector("#data-source").textContent =
            "내 계정에 저장된 과목 · 과목 변경은 학업 대시보드에서 할 수 있습니다. 평가 기준은 예시입니다.";
        mountGradeDashboard(container, { courses, gradingPolicy });
    } catch (error) {
        if (error.status === 401) {
            window.location.replace("/login.html");
            return;
        }
        container.textContent = "성적 데이터를 표시하지 못했습니다. 페이지를 새로고침해 주세요.";
        message.textContent = `성적 분석 초기화 실패: ${error.message}`;
    } finally {
        container.setAttribute("aria-busy", "false");
    }
}

// 서버 세션을 종료하고 로그인 화면으로 이동합니다.
logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
        await authRequest("logout", {});
        window.location.replace("/login.html");
    } catch (error) {
        message.textContent = error.message;
    } finally {
        logoutButton.disabled = false;
    }
});

initAnalysis();
