
import { calculateCurrentCredits } from "/js/credits/current.js";
import { calculateEarnedCredits } from "/js/credits/earned.js";
import { calculateCompletionCredits } from "/js/credits/completion.js";
import { calculateCumulativeGPA } from "/js/grades/gpa.js";
import { addCourse, updateCourse, removeCourse, getCourses, loadCourses, saveCourses } from "/js/grades/grades.js";
import { authRequest } from "/js/auth/api.js";

const elements = {
    userName: document.querySelector("#user-name"),
    currentYear: document.querySelector("#current-year"),
    currentYearMessage: document.querySelector("#current-year-message"),
    cumulativeGpa: document.querySelector("#cumulative-gpa"),
    earnedCredits: document.querySelector("#earned-credits"),
    currentCredits: document.querySelector("#current-credits"),
    completionCredits: document.querySelector("#completion-credits"),
    courseList: document.querySelector("#course-list"),
    courseSemesterFilter: document.querySelector("#course-semester-filter"),
    courseCount: document.querySelector("#course-count"),
    message: document.querySelector("#dashboard-message"),
    logoutButton: document.querySelector("#logout-button"),
    dataSource: document.querySelector("#data-source"),
    addCourseButton: document.querySelector("#add-course-button"),
    courseForm: document.querySelector("#course-form"),
    courseFormTitle: document.querySelector("#course-form-title"),
    courseFormMessage: document.querySelector("#course-form-message"),
    courseMessage: document.querySelector("#course-message"),
    saveCourseButton: document.querySelector("#save-course-button"),
    cancelCourseButton: document.querySelector("#cancel-course-button"),
    gradeHint: document.querySelector("#course-grade-hint"),
    deleteDialog: document.querySelector("#delete-course-dialog"),
    deleteDescription: document.querySelector("#delete-course-description"),
    deleteMessage: document.querySelector("#delete-course-message"),
    cancelDeleteButton: document.querySelector("#cancel-delete-course-button"),
    confirmDeleteButton: document.querySelector("#confirm-delete-course-button")
};

let courses = [];
let userInfo;
let academicRequirements;
let academicYearStorageKey;
let usingExamples = false;
let editingCourseId = null;
let deletingCourseId = null;
let formTrigger = null;
const fields = elements.courseForm.elements;

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

        cell.colSpan = 6;
        cell.className = "empty-message";
        cell.textContent = elements.courseSemesterFilter.value
            ? "선택한 학기에 등록된 과목이 없습니다."
            : "등록된 과목이 없습니다.";

        row.appendChild(cell);
        elements.courseList.appendChild(row);
        return;
    }

    courses.forEach(course => {
        const row = document.createElement("tr");

        const values = [
            course.courseName ?? "-",
            course.credits ?? "-",
            course.grade || "-",
            course.semester ?? "-",
            course.status === "completed" ? "이수 완료" :
                course.status === "in_progress" ? "수강 중" : "-"
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });

        const actions = document.createElement("td");
        const buttons = document.createElement("div");
        buttons.className = "course-actions";
        for (const [action, label, className] of [
            ["edit", "수정", "secondary-button"],
            ["delete", "삭제", "delete-button"]
        ]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = className;
            button.textContent = label;
            button.dataset.action = action;
            button.dataset.courseId = course.id;
            button.setAttribute("aria-label", `${course.courseName} ${label}`);
            buttons.appendChild(button);
        }
        actions.appendChild(buttons);
        row.appendChild(actions);
        elements.courseList.appendChild(row);
    });
}

// 과목에 있는 학기만 최신순으로 표시하고 기존 선택을 유지합니다.
function refreshCourseSemesterFilter() {
    const selected = elements.courseSemesterFilter.value;
    const semesters = [...new Set(courses.map(course => course.semester)
        .filter(semester => typeof semester === "string" && semester.trim()))]
        .sort((a, b) => b.localeCompare(a));
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "전체 학기";
    elements.courseSemesterFilter.replaceChildren(allOption, ...semesters.map(semester => {
        const option = document.createElement("option");
        option.value = semester;
        option.textContent = /^\d{4}-[12]$/.test(semester)
            ? `${semester.slice(0, 4)}년 ${semester.slice(-1)}학기` : semester;
        return option;
    }));
    elements.courseSemesterFilter.value = semesters.includes(selected) ? selected : "";
    elements.courseSemesterFilter.disabled = semesters.length === 0;
}

// 선택한 학기의 과목 목록과 과목 수를 표시합니다.
function renderFilteredCourses() {
    const semester = elements.courseSemesterFilter.value;
    const filtered = getCourses(courses, { semester: semester || undefined });
    renderCourses(filtered);
    elements.courseCount.textContent = `${semester ? `${semester} · ` : "전체 "}${filtered.length}개 과목`;
}

// 대시보드 요약 정보 갱신
async function renderDashboard(user) {
    elements.userName.textContent = `${user.name}님`;
    [userInfo, academicRequirements] = await Promise.all([
        loadData("user_info"),
        loadData("academic_requirements")
    ]);
    const storedCourses = loadCourses({ fallback: null });
    usingExamples = storedCourses === null;
    if (!usingExamples && !Array.isArray(storedCourses)) {
        throw new Error("과목 데이터 형식이 올바르지 않습니다.");
    }
    if (usingExamples) {
        const example = await loadData("courses");
        courses = example.courses;
        if (!Array.isArray(courses)) throw new Error("예시 과목 데이터 형식이 올바르지 않습니다.");
    } else {
        courses = storedCourses;
    }
    // 예시와 이전 저장 데이터에 ID가 없어도 과목별 수정·삭제가 가능하도록 합니다.
    courses = courses.map(course => ({ ...course, id: course.id || crypto.randomUUID() }));
    academicYearStorageKey = `endpoint:academic-year:${user.id}`;
    let currentYear = Number(userInfo.grade);
    try {
        const savedYear = Number(localStorage.getItem(academicYearStorageKey));
        if (Number.isInteger(savedYear) && savedYear >= 1 && savedYear <= 4) {
            currentYear = savedYear;
        }
    } catch {
        elements.currentYearMessage.textContent = "학년을 선택할 수 있지만 브라우저 설정으로 인해 저장값을 불러오지 못했습니다.";
    }
    userInfo.grade = Number.isInteger(currentYear) && currentYear >= 1 && currentYear <= 4
        ? currentYear : 1;
    elements.currentYear.value = String(userInfo.grade);
    refreshDashboard();
    elements.currentYear.disabled = false;
    elements.addCourseButton.disabled = false;
}

// 선택한 학년으로 수료 기준을 갱신하고 사용자별로 브라우저에 저장합니다.
function changeCurrentYear() {
    const year = Number(elements.currentYear.value);
    if (!Number.isInteger(year) || year < 1 || year > 4) return;
    userInfo.grade = year;
    refreshDashboard();
    try {
        localStorage.setItem(academicYearStorageKey, String(year));
        elements.currentYearMessage.textContent = `${year}학년으로 변경했습니다. 선택한 학년은 이 브라우저에 저장됩니다.`;
    } catch {
        elements.currentYearMessage.textContent = `${year}학년으로 변경했지만 저장하지 못했습니다. 새로고침하면 선택이 초기화됩니다.`;
    }
}

// 현재 과목과 학년을 기준으로 학점·GPA 요약과 과목 목록을 갱신합니다.
function refreshDashboard() {
    elements.dataSource.textContent =
        `${usingExamples ? "예시 과목 데이터" : "이 브라우저에 저장된 과목 데이터"} · ` +
        `학과·수료 기준은 예시입니다 (${userInfo.department}). 현재 학년: ${userInfo.grade}학년. ` +
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

    refreshCourseSemesterFilter();
    renderFilteredCourses();
}

// 과목 추가·수정·삭제 결과를 안내합니다.
function showCourseMessage(message) {
    elements.courseMessage.textContent = message;
}

// 이수 완료 과목에만 성적 입력을 활성화합니다.
function updateGradeField() {
    const inProgress = fields.status.value === "in_progress";
    fields.grade.disabled = inProgress;
    fields.grade.required = !inProgress;
    elements.gradeHint.textContent = inProgress
        ? "수강 중인 과목은 성적 없이 저장됩니다."
        : "이수 완료 과목은 성적을 선택해 주세요. 평점은 자동 계산됩니다.";
}

// 추가 또는 수정할 과목의 입력 폼을 열고 과목명으로 초점을 옮깁니다.
function openCourseForm(course = null, trigger = elements.addCourseButton) {
    editingCourseId = course?.id ?? null;
    formTrigger = trigger;
    elements.courseForm.reset();
    elements.courseFormMessage.textContent = "";
    showCourseMessage("");
    elements.courseFormTitle.textContent = course ? "과목 수정" : "과목 추가";
    elements.saveCourseButton.textContent = course ? "수정 저장" : "추가";
    if (!course) fields.semester.value = elements.courseSemesterFilter.value;
    if (course) {
        for (const name of ["courseName", "credits", "semester", "category", "status", "grade"]) {
            fields.namedItem(name).value = course[name] ?? "";
        }
        fields.isRetake.checked = Boolean(course.isRetake);
    }
    updateGradeField();
    elements.courseForm.hidden = false;
    fields.courseName.focus();
}

// 입력 폼을 닫고 폼을 열었던 버튼으로 초점을 돌려줍니다.
function closeCourseForm() {
    elements.courseForm.hidden = true;
    editingCourseId = null;
    (formTrigger?.isConnected ? formTrigger : elements.addCourseButton).focus();
}

// 변경된 과목을 저장하고 대시보드에 반영합니다.
function commitCourses(nextCourses) {
    // 저장 성공 후에만 화면 상태를 변경해 저장 실패 시 입력을 유지합니다.
    saveCourses(nextCourses);
    courses = nextCourses;
    usingExamples = false;
    refreshDashboard();
}

// 입력값을 검증해 과목을 추가하거나 수정하고 실패 원인을 표시합니다.
function submitCourse(event) {
    event.preventDefault();
    elements.courseFormMessage.textContent = "";
    const input = {
        courseName: fields.courseName.value,
        credits: fields.credits.value,
        semester: fields.semester.value,
        category: fields.category.value,
        status: fields.status.value,
        grade: fields.grade.value,
        isRetake: fields.isRetake.checked
    };
    try {
        const isEditing = editingCourseId !== null;
        const nextCourses = isEditing
            ? updateCourse(courses, editingCourseId, input)
            : addCourse(courses, input);
        commitCourses(nextCourses);
        closeCourseForm();
        showCourseMessage(isEditing ? "과목을 수정했습니다." : "과목을 추가했습니다.");
    } catch (error) {
        elements.courseFormMessage.textContent = error.message;
    }
}

// 과목별 버튼 클릭을 받아 수정 폼 또는 삭제 확인창을 엽니다.
function handleCourseAction(event) {
    const button = event.target.closest("button[data-course-id]");
    if (!button) return;
    const course = courses.find(item => item.id === button.dataset.courseId);
    if (!course) return;
    if (button.dataset.action === "edit") {
        openCourseForm(course, button);
        return;
    }
    deletingCourseId = course.id;
    elements.deleteDescription.textContent = `「${course.courseName}」 과목을 삭제하시겠습니까?`;
    elements.deleteMessage.textContent = "";
    elements.deleteDialog.showModal();
}

// 삭제가 확인된 과목을 제거하고 목록과 요약 정보를 갱신합니다.
function confirmDeleteCourse() {
    const course = courses.find(item => item.id === deletingCourseId);
    if (!course) return;
    try {
        commitCourses(removeCourse(courses, course.id));
        elements.deleteDialog.close();
        if (editingCourseId === course.id) closeCourseForm();
        else if (elements.courseForm.hidden) elements.addCourseButton.focus();
        showCourseMessage("과목을 삭제했습니다.");
    } catch (error) {
        elements.deleteMessage.textContent = error.message;
    }
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

// 로그아웃·학년 변경·과목 관리·학기 필터 이벤트를 연결합니다.
elements.logoutButton.addEventListener("click", logout);
elements.currentYear.addEventListener("change", changeCurrentYear);
elements.addCourseButton.addEventListener("click", () => openCourseForm());
elements.cancelCourseButton.addEventListener("click", closeCourseForm);
elements.courseForm.addEventListener("submit", submitCourse);
fields.status.addEventListener("change", updateGradeField);
elements.courseList.addEventListener("click", handleCourseAction);
elements.courseSemesterFilter.addEventListener("change", renderFilteredCourses);
elements.cancelDeleteButton.addEventListener("click", () => elements.deleteDialog.close());
elements.confirmDeleteButton.addEventListener("click", confirmDeleteCourse);
elements.deleteDialog.addEventListener("close", () => { deletingCourseId = null; });

// 대시보드 실행
initDashboard();
