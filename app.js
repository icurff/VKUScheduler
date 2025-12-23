/* =====================================================
   VKU Timetable Scheduler - Main Application
   ===================================================== */

// Course colors for visual distinction
const COURSE_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
];

// Day mapping from Vietnamese to index (0=Monday, 5=Saturday)
const DAY_MAP = {
    'T.Hai': 0, 'T.Ba': 1, 'T.Tư': 2, 'T.Năm': 3, 'T.Sáu': 4, 'T.Bảy': 5
};


const GOOGLE_SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbxlQS8eFwXPQAzw92nXwwdFUV_q9uEk4o9RPDcwokB25HXyWABzFaKwQHlsn7Rqq6o/exec'; 

// Application State
let courses = [];
let selectedCourses = [];
let filteredCourses = [];
let currentFilter = 'all';
let courseColorMap = new Map();
let colorIndex = 0;

// DOM Elements
let searchInput, searchClear, courseList, courseCount, timetableBody;
let selectedList, emptyState, totalCredits, selectedCount;
let conflictWarning, clearAllBtn, exportBtn, filterTabs, toast;
let dataNote, noteClose;

// =====================================================
// Data Parser
// =====================================================
function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = parseCSVLine(line);
        
        if (values.length >= 8) {
            const course = {
                id: `${values[0]}-${values[1] || i}-${i}`,
                hocphan_id: values[0],
                stt: values[1],
                ten_hoc_phan: values[2],
                si_so: parseInt(values[3]) || 0,
                da_dang_ky: parseInt(values[4]) || 0,
                giang_vien: values[5],
                thoi_khoa_bieu: values[6],
                tuan_hoc: values[7]
            };
            
            // Parse schedule
            course.schedule = parseSchedule(course.thoi_khoa_bieu);
            course.weeks = parseWeeks(course.tuan_hoc);
            course.isFull = course.da_dang_ky >= course.si_so;
            
            data.push(course);
        }
    }
    
    return data;
}


function parseGoogleSheetsData(jsonData) {
    const data = [];
    
    jsonData.forEach((row, index) => {
   
        if (row.hocphan_id !== undefined && row.ten_hoc_phan) {
            const course = {
                id: `${row.hocphan_id || ''}-${row.stt || index}-${index}`,
                hocphan_id: row.hocphan_id || '',
                stt: row.stt || '',
                ten_hoc_phan: row.ten_hoc_phan || '',
                si_so: parseInt(row.si_so) || 0,
                da_dang_ky: parseInt(row.da_dang_ky) || 0,
                giang_vien: row.giang_vien || '',
                thoi_khoa_bieu: row.thoi_khoa_bieu || '',
                tuan_hoc: row.tuan_hoc || ''
            };
            
            // Parse schedule
            course.schedule = parseSchedule(course.thoi_khoa_bieu);
            course.weeks = parseWeeks(course.tuan_hoc);
            course.isFull = course.da_dang_ky >= course.si_so;
            
            data.push(course);
        }
    });
    
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    
    return result;
}

// =====================================================
// Schedule Parser
// =====================================================
function parseSchedule(scheduleStr) {
    // Format: "T.Ba  1->2" or "T.Tư  6->9"
    if (!scheduleStr || scheduleStr === 'T.-  -') return null;
    
    const match = scheduleStr.match(/T\.(Hai|Ba|Tư|Năm|Sáu|Bảy)\s+(\d+)->(\d+)/);
    if (!match) return null;
    
    const dayName = 'T.' + match[1];
    const dayIndex = DAY_MAP[dayName];
    const startPeriod = parseInt(match[2]);
    const endPeriod = parseInt(match[3]);
    
    if (dayIndex === undefined) return null;
    
    return {
        day: dayIndex,
        dayName: dayName,
        startPeriod: startPeriod,
        endPeriod: endPeriod,
        periodCount: endPeriod - startPeriod + 1
    };
}

function parseWeeks(weeksStr) {
    // Format: "23->27,31->40" or "26,27,31->43"
    if (!weeksStr) return [];
    
    const weeks = [];
    const parts = weeksStr.replace(/"/g, '').split(',');
    
    for (const part of parts) {
        if (part.includes('->')) {
            const [start, end] = part.split('->').map(n => parseInt(n.trim()));
            for (let i = start; i <= end; i++) {
                weeks.push(i);
            }
        } else {
            const week = parseInt(part.trim());
            if (!isNaN(week)) weeks.push(week);
        }
    }
    
    return weeks;
}

// =====================================================
// Conflict Detection
// =====================================================
function hasConflict(course1, course2) {
    if (!course1.schedule || !course2.schedule) return false;
    
    // Check if same day
    if (course1.schedule.day !== course2.schedule.day) return false;
    
    // Check if periods overlap
    const s1Start = course1.schedule.startPeriod;
    const s1End = course1.schedule.endPeriod;
    const s2Start = course2.schedule.startPeriod;
    const s2End = course2.schedule.endPeriod;
    
    const periodsOverlap = !(s1End < s2Start || s2End < s1Start);
    if (!periodsOverlap) return false;
    
    // Check if weeks overlap
    const weeksOverlap = course1.weeks.some(w => course2.weeks.includes(w));
    
    return weeksOverlap;
}

function getConflicts(course) {
    return selectedCourses.filter(selected => 
        selected.id !== course.id && hasConflict(course, selected)
    );
}

function hasAnyConflict() {
    for (let i = 0; i < selectedCourses.length; i++) {
        for (let j = i + 1; j < selectedCourses.length; j++) {
            if (hasConflict(selectedCourses[i], selectedCourses[j])) {
                return true;
            }
        }
    }
    return false;
}

// =====================================================
// Color Management
// =====================================================
function getCourseColor(courseId) {
    const baseId = courseId.split('-')[0];
    
    if (!courseColorMap.has(baseId)) {
        courseColorMap.set(baseId, COURSE_COLORS[colorIndex % COURSE_COLORS.length]);
        colorIndex++;
    }
    
    return courseColorMap.get(baseId);
}

// =====================================================
// Render Functions
// =====================================================
function renderCourseList() {
    let coursesToRender = [...filteredCourses];
    
    if (currentFilter === 'available') {
        coursesToRender = coursesToRender.filter(c => !c.isFull);
    } else if (currentFilter === 'selected') {
        coursesToRender = coursesToRender.filter(c => 
            selectedCourses.some(s => s.id === c.id)
        );
    }
    
    courseCount.textContent = `${coursesToRender.length} học phần`;
    
    if (coursesToRender.length === 0) {
        courseList.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <p>Không tìm thấy học phần</p>
            </div>
        `;
        return;
    }
    
    courseList.innerHTML = coursesToRender.map(course => {
        const isSelected = selectedCourses.some(s => s.id === course.id);
        const conflicts = isSelected ? [] : getConflicts(course);
        const hasConflictClass = conflicts.length > 0 ? 'conflict' : '';
        const selectedClass = isSelected ? 'selected' : '';
        const fullClass = course.isFull ? 'full' : '';
        const color = getCourseColor(course.id);
        
        return `
            <div class="course-card ${selectedClass} ${hasConflictClass} ${fullClass}" 
                 data-id="${course.id}"
                 style="--card-color: ${color}">
                <div class="course-name">${course.ten_hoc_phan}</div>
                <div class="course-meta">
                    <span><span class="icon">👤</span>${course.giang_vien}</span>
                    <span><span class="icon">📅</span>${course.thoi_khoa_bieu}</span>
                    <span><span class="icon">📊</span>${course.da_dang_ky}/${course.si_so} đã đăng ký</span>
                </div>
                <div class="course-status">
                    ${course.isFull ? '<span class="status-badge status-full">Đã đầy</span>' : ''}
                    ${conflicts.length > 0 ? '<span class="status-badge status-conflict">Trùng lịch</span>' : ''}
                    ${!course.isFull && conflicts.length === 0 ? '<span class="status-badge status-available">Còn chỗ</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Add click handlers
    document.querySelectorAll('.course-card').forEach(card => {
        card.addEventListener('click', () => {
            const courseId = card.dataset.id;
            toggleCourse(courseId);
        });
    });
}

function renderTimetable() {
    // Generate 12 rows for periods 1-12
    let html = '';
    
    for (let period = 1; period <= 12; period++) {
        html += `<tr>
            <td class="time-col">${period}</td>
            ${Array(6).fill(0).map((_, dayIndex) => {
                return `<td data-day="${dayIndex}" data-period="${period}"></td>`;
            }).join('')}
        </tr>`;
    }
    
    timetableBody.innerHTML = html;
    
    // Place selected courses on timetable
    selectedCourses.forEach(course => {
        if (!course.schedule) return;
        
        const { day, startPeriod, endPeriod, periodCount } = course.schedule;
        const color = getCourseColor(course.id);
        const conflicts = getConflicts(course);
        const conflictClass = conflicts.length > 0 ? 'conflict' : '';
        
        // Find the cell for the start period
        const cell = document.querySelector(`td[data-day="${day}"][data-period="${startPeriod}"]`);
        if (!cell) return;
        
        cell.classList.add('has-course');
        
        // Calculate height based on period count
        const height = `calc(${periodCount * 45}px + ${(periodCount - 1) * 2}px - 4px)`;
        
        cell.innerHTML = `
            <div class="timetable-course ${conflictClass}" 
                 style="background: ${color}; height: ${height};"
                 data-id="${course.id}">
                <span class="course-title">${course.ten_hoc_phan}</span>
                <span class="course-room">${course.giang_vien}</span>
            </div>
        `;
        
        // Add click handler to remove
        cell.querySelector('.timetable-course').addEventListener('click', () => {
            toggleCourse(course.id);
        });
    });
    
    // Update conflict warning
    conflictWarning.style.display = hasAnyConflict() ? 'flex' : 'none';
}

function renderSelectedList() {
    if (selectedCourses.length === 0) {
        selectedList.innerHTML = `
            <div class="empty-state" id="emptyState">
                <span class="empty-icon">📚</span>
                <p>Chưa chọn môn học nào</p>
                <small>Click vào một học phần để thêm vào TKB</small>
            </div>
        `;
        return;
    }
    
    selectedList.innerHTML = selectedCourses.map(course => {
        const color = getCourseColor(course.id);
        const conflicts = getConflicts(course);
        
        return `
            <div class="selected-card" style="--card-color: ${color}">
                <div class="selected-card-header">
                    <span class="selected-card-name">${course.ten_hoc_phan}</span>
                    <button class="btn-remove" data-id="${course.id}">✕</button>
                </div>
                <div class="selected-card-info">
                    <span>📅 ${course.thoi_khoa_bieu}</span>
                    <span>👤 ${course.giang_vien}</span>
                    ${conflicts.length > 0 ? '<span style="color: var(--danger);">⚠️ Trùng lịch</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Add remove handlers
    document.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const courseId = btn.dataset.id;
            toggleCourse(courseId);
        });
    });
    
    // Update counts
    selectedCount.textContent = `${selectedCourses.length} môn đã chọn`;
}

// =====================================================
// Course Actions
// =====================================================
function toggleCourse(courseId) {
    const course = courses.find(c => c.id === courseId);
    if (!course) return;
    
    const isSelected = selectedCourses.some(s => s.id === courseId);
    
    if (isSelected) {
        selectedCourses = selectedCourses.filter(s => s.id !== courseId);
        showToast('Đã xóa khỏi TKB', 'success');
    } else {
        if (course.isFull) {
            showToast('Lớp đã đầy!', 'warning');
            return;
        }
        
        const conflicts = getConflicts(course);
        if (conflicts.length > 0) {
            showToast('Cảnh báo: Trùng lịch với ' + conflicts[0].ten_hoc_phan, 'warning');
        }
        
        selectedCourses.push(course);
        showToast('Đã thêm vào TKB', 'success');
    }
    
    saveToLocalStorage();
    renderAll();
}

function clearAll() {
    if (selectedCourses.length === 0) return;
    
    if (confirm('Bạn có chắc muốn xóa tất cả môn đã chọn?')) {
        selectedCourses = [];
        saveToLocalStorage();
        renderAll();
        showToast('Đã xóa tất cả', 'success');
    }
}

// =====================================================
// Search & Filter
// =====================================================
function handleSearch() {
    const query = searchInput.value.toLowerCase().trim();
    
    if (query === '') {
        filteredCourses = [...courses];
    } else {
        filteredCourses = courses.filter(course => 
            course.ten_hoc_phan.toLowerCase().includes(query) ||
            course.giang_vien.toLowerCase().includes(query)
        );
    }
    
    renderCourseList();
}

function handleFilter(filter) {
    currentFilter = filter;
    
    filterTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    
    renderCourseList();
}

// =====================================================
// Local Storage
// =====================================================
function saveToLocalStorage() {
    const selectedIds = selectedCourses.map(c => c.id);
    localStorage.setItem('vku_timetable_selected', JSON.stringify(selectedIds));
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('vku_timetable_selected');
    if (saved) {
        try {
            const selectedIds = JSON.parse(saved);
            selectedCourses = courses.filter(c => selectedIds.includes(c.id));
        } catch (e) {
            console.error('Failed to load saved data:', e);
        }
    }
}

// =====================================================
// Toast
// =====================================================
function showToast(message, type = 'success') {
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️'
    };
    
    toast.querySelector('.toast-icon').textContent = icons[type];
    toast.querySelector('.toast-message').textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// =====================================================
// Export
// =====================================================
function exportTimetable() {
    if (selectedCourses.length === 0) {
        showToast('Chưa có môn nào để xuất!', 'warning');
        return;
    }
    
    let text = '=== THỜI KHÓA BIỂU VKU ===\n\n';
    
    selectedCourses.forEach((course, i) => {
        text += `${i + 1}. ${course.ten_hoc_phan}\n`;
        text += `   Giảng viên: ${course.giang_vien}\n`;
        text += `   Lịch học: ${course.thoi_khoa_bieu}\n`;
        text += `   Tuần học: ${course.tuan_hoc}\n\n`;
    });
    
    // Create download
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'thoi_khoa_bieu_vku.txt';
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Đã xuất TKB thành công!', 'success');
}

// =====================================================
// Render All
// =====================================================
function renderAll() {
    renderCourseList();
    renderTimetable();
    renderSelectedList();
}

// =====================================================
// Load Data from Google Sheets or CSV file
// =====================================================
async function loadData() {
    // Ưu tiên load từ Google Sheets nếu có URL
    if (GOOGLE_SHEETS_API_URL && GOOGLE_SHEETS_API_URL.trim() !== '') {
        try {
            console.log('Loading data from Google Sheets...');
            const response = await fetch(GOOGLE_SHEETS_API_URL);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.data) {
                console.log(`Loaded ${result.count} courses from Google Sheets`);
                return parseGoogleSheetsData(result.data);
            } else {
                throw new Error(result.error || 'Invalid response from Google Sheets');
            }
        } catch (error) {
            console.error('Error loading from Google Sheets:', error);
            console.log('Falling back to CSV file...');
            // Fallback to CSV if Google Sheets fails
        }
    }
    
    // Fallback: Load from CSV file
    try {
        console.log('Loading data from CSV file...');
        const response = await fetch('tin_chi.csv');
        if (response.ok) {
            const csvData = await response.text();
            return parseCSV(csvData);
        }
    } catch (e) {
        console.log('Fetch failed, trying XMLHttpRequest...');
    }
    
    // Last resort: Try XMLHttpRequest for file:// protocol
    try {
        return await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'tin_chi.csv', true);
            xhr.onload = function() {
                if (xhr.status === 200 || xhr.status === 0) {
                    resolve(parseCSV(xhr.responseText));
                } else {
                    reject(new Error('Could not load CSV file'));
                }
            };
            xhr.onerror = function() {
                reject(new Error('Network error loading CSV file'));
            };
            xhr.send();
        });
    } catch (e) {
        console.error('All loading methods failed:', e);
        return null;
    }
}

// =====================================================
// Initialize
// =====================================================
async function init() {
    // Get DOM elements
    searchInput = document.getElementById('searchInput');
    searchClear = document.getElementById('searchClear');
    courseList = document.getElementById('courseList');
    courseCount = document.getElementById('courseCount');
    timetableBody = document.getElementById('timetableBody');
    selectedList = document.getElementById('selectedList');
    emptyState = document.getElementById('emptyState');
    totalCredits = document.getElementById('totalCredits');
    selectedCount = document.getElementById('selectedCount');
    conflictWarning = document.getElementById('conflictWarning');
    clearAllBtn = document.getElementById('clearAll');
    exportBtn = document.getElementById('exportBtn');
    filterTabs = document.querySelectorAll('.filter-tab');
    toast = document.getElementById('toast');
    dataNote = document.getElementById('dataNote');
    noteClose = document.getElementById('noteClose');
    
    // Show loading state
    courseList.innerHTML = `
        <div class="empty-state">
            <span class="empty-icon">⏳</span>
            <p>Đang tải dữ liệu...</p>
        </div>
    `;
    
    // Load data from Google Sheets or CSV file
    courses = await loadData();
    
    if (!courses || courses.length === 0) {
        console.error('Could not load data');
        courseList.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">❌</span>
                <p>Không thể tải dữ liệu</p>
                <small>
                    ${GOOGLE_SHEETS_API_URL ? 
                        'Kiểm tra lại Google Sheets API URL hoặc chạy website qua local server' : 
                        'Vui lòng cấu hình GOOGLE_SHEETS_API_URL hoặc chạy website qua local server'}
                </small>
            </div>
        `;
        return;
    }
    
    console.log(`Loaded ${courses.length} courses successfully`);
    
    filteredCourses = [...courses];
    
    // Load saved selections
    loadFromLocalStorage();
    
    // Initial render
    renderAll();
    
    // Event listeners
    searchInput.addEventListener('input', handleSearch);
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        handleSearch();
    });
    
    filterTabs.forEach(tab => {
        tab.addEventListener('click', () => handleFilter(tab.dataset.filter));
    });
    
    clearAllBtn.addEventListener('click', clearAll);
    exportBtn.addEventListener('click', exportTimetable);
    
    // Handle data note close
    const noteClosed = localStorage.getItem('vku_data_note_closed') === 'true';
    if (noteClosed && dataNote) {
        dataNote.classList.add('hidden');
    }
    
    if (noteClose) {
        noteClose.addEventListener('click', () => {
            if (dataNote) {
                dataNote.classList.add('hidden');
                localStorage.setItem('vku_data_note_closed', 'true');
            }
        });
    }
}

// Start application
document.addEventListener('DOMContentLoaded', init);
