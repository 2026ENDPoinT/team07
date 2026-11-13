
import { calculateCurrentCredits } from "/js/credits/current.js";
import { calculateEarnedCredits } from "/js/credits/earned.js";
import { calculateCompletionCredits } from "/js/credits/completion.js";
import { calculateGraduationCredits } from "/js/credits/graduation.js";
import { calculateCumulativeGPA } from "/js/grades/gpa.js";
import {
    addCourse,
    updateCourse,
    removeCourse,
    getCourses
} from "/js/grades/grades.js";
import { authRequest } from "/js/auth/api.js";
import { createAcademicClient } from "/js/academic-api.js";

const elements = {
    userName: document.querySelector("#user-name"),
    currentYear: document.querySelector("#current-year"),
    currentYearMessage: document.querySelector("#current-year-message"),

    cumulativeGpa: document.querySelector("#cumulative-gpa"),
    earnedCredits: document.querySelector("#earned-credits"),
    currentCredits: document.querySelector("#current-credits"),
    completionCredits: document.querySelector("#completion-credits"),

    graduationTotalRemaining: document.querySelector("#graduation-total-remaining"),
    graduationMajorRemaining: document.querySelector("#graduation-major-remaining"),
    graduationTotalRequirement: document.querySelector("#graduation-total-requirement"),
    graduationMajorRequirement: document.querySelector("#graduation-major-requirement"),

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
let academicClient;
let revision;
let saving = false;
let editingCourseId = null;
let deletingCourseId = null;
let formTrigger = null;

const fields = elements.courseForm.elements;

// 숫자 표시 형식
function formatNumber(value) {
    return Number.isFinite(value) ? String(value) : "--";
}

// 학기 데이터의 화면 표시 형식
function formatSemester(semester) {
    const match = semester?.match(/^(\d{4})-(1|2|여름|겨울)$/);

    if (!match) return semester ?? "-";

    const [, year, term] = match;

    switch (term) {
        case "1":
            return `${year}년 1학기`;

        case "2":
            return `${year}년 2학기`;

        case "여름":
            return `${year}년 여름 계절학기`;

        case "겨울":
            return `${year}년 겨울 계절학기`;

        default:
            return semester;
    }
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

    if (!response.ok) {
        throw new Error(`${name} 데이터를 불러오지 못했습니다.`);
    }

    return response.json();
}

// 과목 목록 출력
function renderCourses(courseList) {
    elements.courseList.replaceChildren();

    if (!Array.isArray(courseList) || courseList.length === 0) {
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

    courseList.forEach(course => {
        const row = document.createElement("tr");

        const values = [
            course.courseName ?? "-",
            course.credits ?? "-",
            course.grade || "-",
            formatSemester(course.semester),
            course.status === "completed"
                ? "이수 완료"
                : course.status === "in_progress"
                    ? "수강 중"
                    : "-"
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
            button.setAttribute(
                "aria-label",
                `${course.courseName} ${label}`
            );

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

    const semesters = [
        ...new Set(
            courses
                .map(course => course.semester)
                .filter(
                    semester =>
                        typeof semester === "string" &&
                        semester.trim()
                )
        )
    ].sort((a, b) => b.localeCompare(a));

    const allOption = document.createElement("option");

    allOption.value = "";
    allOption.textContent = "전체 학기";

    elements.courseSemesterFilter.replaceChildren(
        allOption,
        ...semesters.map(semester => {
            const option = document.createElement("option");

            option.value = semester;
            option.textContent = formatSemester(semester);

            return option;
        })
    );

    elements.courseSemesterFilter.value =
        semesters.includes(selected) ? selected : "";

    elements.courseSemesterFilter.disabled = semesters.length === 0;
}

// 선택한 학기의 과목 목록과 과목 수를 표시합니다.
function renderFilteredCourses() {
    const semester = elements.courseSemesterFilter.value;

    const filtered = getCourses(courses, {
        semester: semester || undefined
    });

    renderCourses(filtered);

    elements.courseCount.textContent =
        `${semester ? `${formatSemester(semester)} · ` : "전체 "}${filtered.length}개 과목`;
}

// 대시보드 요약 정보 갱신
async function renderDashboard(user) {
    elements.userName.textContent = `${user.name}님`;

    academicClient = createAcademicClient(user.id);

    const [state, requirements] = await Promise.all([
        academicClient.load(),
        loadData("academic_requirements")
    ]);

    courses = state.courses;
    userInfo = state.profile;
    revision = state.revision;
    academicRequirements = requirements;

    refreshDashboard();

    elements.currentYear.disabled = false;
    elements.addCourseButton.disabled = false;
}

// 선택한 학년을 로그인 계정 전용 DB에 저장합니다.
async function changeCurrentYear() {
    const year = Number(elements.currentYear.value);

    if (!Number.isInteger(year) || year < 1 || year > 4) {
        return;
    }

    try {
        await commitState(courses, { grade: year });

        elements.currentYearMessage.textContent =
            `${year}학년으로 변경했습니다. 내 계정에 저장했습니다.`;
    } catch (error) {
        elements.currentYear.value = String(userInfo.grade);
        elements.currentYearMessage.textContent = error.message;
    }
}

// 현재 과목과 학년을 기준으로 학점·GPA 요약과 과목 목록을 갱신합니다.
function refreshDashboard() {
    elements.dataSource.textContent =
        `내 계정에 저장된 과목 · 현재 학년: ${userInfo.grade}학년. ` +
        "과목과 학년은 계정별로 저장됩니다. 수료·졸업 기준은 예시입니다.";

    const currentCredits = calculateCurrentCredits(courses);
    const earnedCredits = calculateEarnedCredits(courses);
    const gpaResult = calculateCumulativeGPA(courses);

    const graduationCredits = calculateGraduationCredits(
        courses,
        academicRequirements
    );

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

    elements.graduationTotalRemaining.textContent =
        formatNumber(graduationCredits.totalRemainingCredits);

    elements.graduationMajorRemaining.textContent =
        formatNumber(graduationCredits.majorRemainingCredits);

    elements.graduationTotalRequirement.textContent =
        `학점 · 전체 졸업 기준 ${formatNumber(academicRequirements.graduation.totalCredits)}학점`;

    elements.graduationMajorRequirement.textContent =
        `학점 · 전공 졸업 기준 ${formatNumber(academicRequirements.graduation.majorCredits)}학점`;

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

// 추가 또는 수정할 과목의 입력 폼을 엽니다.
function openCourseForm(
    course = null,
    trigger = elements.addCourseButton
) {
    editingCourseId = course?.id ?? null;
    formTrigger = trigger;

    elements.courseForm.reset();
    elements.courseFormMessage.textContent = "";
    showCourseMessage("");

    elements.courseFormTitle.textContent =
        course ? "과목 수정" : "과목 추가";

    elements.saveCourseButton.textContent =
        course ? "수정 저장" : "추가";

    if (!course) {
        fields.semester.value = elements.courseSemesterFilter.value;
    }

    if (course) {
        for (const name of [
            "courseName",
            "credits",
            "semester",
            "category",
            "status",
            "grade"
        ]) {
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

    (
        formTrigger?.isConnected
            ? formTrigger
            : elements.addCourseButton
    ).focus();
}

// 변경된 과목을 저장하고 대시보드에 반영합니다.
async function commitState(nextCourses, profile = userInfo) {
    if (saving) {
        throw new Error("저장 중입니다. 잠시 기다려 주세요.");
    }

    saving = true;

    const controls = [
        elements.currentYear,
        elements.addCourseButton,
        elements.saveCourseButton,
        elements.cancelCourseButton,
        elements.confirmDeleteButton,
        elements.cancelDeleteButton
    ];

    controls.forEach(control => {
        control.disabled = true;
    });

    try {
        // 서버 저장 성공 후에만 화면 상태를 변경합니다.
        const state = await academicClient.save({
            courses: nextCourses,
            profile,
            revision
        });

        courses = state.courses;
        userInfo = state.profile;
        revision = state.revision;

        elements.currentYear.value = String(userInfo.grade);

        refreshDashboard();
    } finally {
        saving = false;

        controls.forEach(control => {
            control.disabled = false;
        });
    }
}

// 입력값을 검증해 과목을 추가하거나 수정합니다.
async function submitCourse(event) {
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

        await commitState(nextCourses);

        closeCourseForm();

        showCourseMessage(
            isEditing
                ? "과목을 수정했습니다."
                : "과목을 추가했습니다."
        );
    } catch (error) {
        elements.courseFormMessage.textContent = error.message;
    }
}

// 과목별 버튼 클릭을 받아 수정 폼 또는 삭제 확인창을 엽니다.
function handleCourseAction(event) {
    if (saving) return;

    const button = event.target.closest("button[data-course-id]");

    if (!button) return;

    const course = courses.find(
        item => item.id === button.dataset.courseId
    );

    if (!course) return;

    if (button.dataset.action === "edit") {
        openCourseForm(course, button);
        return;
    }

    deletingCourseId = course.id;

    elements.deleteDescription.textContent =
        `「${course.courseName}」 과목을 삭제하시겠습니까?`;

    elements.deleteMessage.textContent = "";

    elements.deleteDialog.showModal();
}

// 삭제가 확인된 과목을 제거하고 목록과 요약 정보를 갱신합니다.
async function confirmDeleteCourse() {
    const course = courses.find(
        item => item.id === deletingCourseId
    );

    if (!course) return;

    try {
        await commitState(
            removeCourse(courses, course.id)
        );

        elements.deleteDialog.close();

        if (editingCourseId === course.id) {
            closeCourseForm();
        } else if (elements.courseForm.hidden) {
            elements.addCourseButton.focus();
        }

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

// 로그아웃·학년 변경·과목 관리·학기 필터 이벤트 연결
elements.logoutButton.addEventListener("click", logout);

elements.currentYear.addEventListener(
    "change",
    changeCurrentYear
);

elements.addCourseButton.addEventListener(
    "click",
    () => openCourseForm()
);

elements.cancelCourseButton.addEventListener(
    "click",
    closeCourseForm
);

elements.courseForm.addEventListener(
    "submit",
    submitCourse
);

fields.status.addEventListener(
    "change",
    updateGradeField
);

elements.courseList.addEventListener(
    "click",
    handleCourseAction
);

elements.courseSemesterFilter.addEventListener(
    "change",
    renderFilteredCourses
);

elements.cancelDeleteButton.addEventListener(
    "click",
    () => elements.deleteDialog.close()
);

elements.confirmDeleteButton.addEventListener(
    "click",
    confirmDeleteCourse
);

elements.deleteDialog.addEventListener(
    "close",
    () => {
        deletingCourseId = null;
    }
);

// 대시보드 실행
initDashboard();
