import { db } from './firebase-config.js';
import { checkAuth } from './auth.js';
import { 
  collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, query, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentEvent = null;
let currentDate = new Date();

// 🇰🇷 대한민국 주요 공휴일 자동 계산 데이터베이스 (2025~2027)
const HOLIDAYS = {
  // 양력 고정 공휴일 (MM-DD)
  fixed: {
    "01-01": "신정",
    "03-01": "삼일절",
    "05-05": "어린이날",
    "06-06": "현충일",
    "08-15": "광복절",
    "10-03": "개천절",
    "10-09": "한글날",
    "12-25": "크리스마스"
  },
  // 연도별 음력 명절 및 대체공휴일 (YYYY-MM-DD)
  variable: {
    // 2025년
    "2025-01-28": "설날 연휴", "2025-01-29": "설날", "2025-01-30": "설날 연휴",
    "2025-05-06": "대체공휴일", "2025-05-05": "부처님오신날",
    "2025-10-05": "추석 연휴", "2025-10-06": "추석", "2025-10-07": "추석 연휴", "2025-10-08": "대체공휴일",
    // 2026년
    "2026-02-16": "설날 연휴", "2026-02-17": "설날", "2026-02-18": "설날 연휴",
    "2026-03-02": "대체공휴일", "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일",
    "2026-08-17": "대체공휴일", "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-09-26": "추석 연휴",
    "2026-10-05": "대체공휴일",
    // 2027년
    "2027-02-06": "설날 연휴", "2027-02-07": "설날", "2027-02-08": "설날 연휴", "2027-02-09": "대체공휴일",
    "2027-05-13": "부처님오신날",
    "2027-09-14": "추석 연휴", "2027-09-15": "추석", "2027-09-16": "추석 연휴"
  }
};

// 특정 날짜의 공휴일명 반환 함수
function getHolidayName(year, month, date) {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(date).padStart(2, '0');
  const monthDay = `${mm}-${dd}`;
  const fullDate = `${year}-${mm}-${dd}`;

  if (HOLIDAYS.fixed[monthDay]) return HOLIDAYS.fixed[monthDay];
  if (HOLIDAYS.variable[fullDate]) return HOLIDAYS.variable[fullDate];
  return null;
}

// 로그인 체크
checkAuth((userData) => {
  currentUser = userData;
  document.getElementById('userWelcome').innerText = `안녕하세요, ${userData.name}님!`;
  document.getElementById('userInfo').innerText = `표시명: ${userData.displayName} (${userData.role === 'admin' ? '관리자' : '회원'})`;
  
  if (userData.role === 'admin') {
    document.getElementById('adminBtn').style.display = 'inline-block';
  }
  
  renderCalendar();
});

// 신입 회원(가입 30일 이내) 여부 검증
function isNewbieUser(approvedAt) {
  if (!approvedAt) return false;
  const approvedDate = approvedAt.toDate ? approvedAt.toDate() : new Date(approvedAt);
  const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
  return (new Date() - approvedDate) < thirtyDaysInMs;
}

// 동적 캘린더 렌더링 (공휴일 자동 표시 추가)
async function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendarEl.innerHTML = '';

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  document.getElementById('currentYearMonth').innerText = `${year}년 ${month + 1}월`;

  // 요일 헤더
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  days.forEach(d => {
    calendarEl.innerHTML += `<div class="calendar-day-header">${d}</div>`;
  });

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  // 이전 달 빈 칸
  for (let i = 0; i < firstDay; i++) {
    calendarEl.innerHTML += `<div class="calendar-day empty"></div>`;
  }

  // 이번 달 일수 생성
  const today = new Date();
  for (let date = 1; date <= lastDate; date++) {
    const dayOfWeek = new Date(year, month, date).getDay(); // 0:일, 6:토
    const holidayName = getHolidayName(year, month, date);
    
    let dayClass = "";
    if (dayOfWeek === 0) dayClass = "sunday";
    else if (dayOfWeek === 6) dayClass = "saturday";
    if (holidayName) dayClass += " holiday";

    const isToday = (today.getFullYear() === year && today.getMonth() === month && today.getDate() === date);
    
    calendarEl.innerHTML += `
      <div class="calendar-day ${dayClass} ${isToday ? 'today' : ''}" id="day-${date}">
        <div class="date-num">${date}</div>
        ${holidayName ? `<div class="holiday-label">${holidayName}</div>` : ''}
      </div>
    `;
  }

  // Firestore 일정 로딩
  const querySnapshot = await getDocs(collection(db, "events"));
  querySnapshot.forEach((docSnap) => {
    const event = docSnap.data();
    event.id = docSnap.id;
    
    const eventDateObj = new Date(event.date);
    if (eventDateObj.getFullYear() === year && eventDateObj.getMonth() === month) {
      const eventDay = eventDateObj.getDate();
      const dayEl = document.getElementById(`day-${eventDay}`);
      
      if (dayEl) {
        const chip = document.createElement('div');
        chip.className = `event-chip ${event.currentCount >= event.maxParticipants ? 'closed' : ''}`;
        chip.innerText = `${event.title} (${event.currentCount || 0}/${event.maxParticipants})`;
        chip.onclick = () => openDetailModal(event);
        dayEl.appendChild(chip);
      }
    }
  });
}

// 이전달 / 다음달 이동
document.getElementById('prevMonthBtn').onclick = () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
};

document.getElementById('nextMonthBtn').onclick = () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
};

// 상세 모달 및 RSVP 목록
async function openDetailModal(event) {
  currentEvent = event;
  document.getElementById('modalTitle').innerText = event.title;
  document.getElementById('modalDate').innerText = new Date(event.date).toLocaleString();
  document.getElementById('modalLocation').innerText = event.location;
  document.getElementById('modalCapacity').innerText = `${event.currentCount || 0} / ${event.maxParticipants}명`;
  document.getElementById('modalDesc').innerText = event.description;
  document.getElementById('modalSupplies').innerText = event.supplies || '없음';

  await loadRSVPList();
  document.getElementById('detailModal').classList.add('active');
}

async function loadRSVPList() {
  const rsvpQuery = await getDocs(query(collection(db, "rsvps"), where("eventId", "==", currentEvent.id)));
  const pList = document.getElementById('participantList');
  const wList = document.getElementById('waitingList');
  pList.innerHTML = '';
  wList.innerHTML = '';

  rsvpQuery.forEach((rSnap) => {
    const rData = rSnap.data();
    const li = document.createElement('li');
    li.innerText = `${rData.displayName}${rData.isNewbie ? " 🔰(신입)" : ""}`;
    if (rData.cancelReason) {
      li.innerText += ` (취소사유: ${rData.cancelReason})`;
    }

    if (rData.status === 'attending') pList.appendChild(li);
    else if (rData.status === 'waiting') wList.appendChild(li);
  });
}

// 참석 신청
document.getElementById('btnAttend').onclick = async () => {
  if (!currentEvent || !currentUser) return;

  const existingRsvp = await getDocs(query(
    collection(db, "rsvps"), 
    where("eventId", "==", currentEvent.id),
    where("uid", "==", currentUser.uid)
  ));

  if (!existingRsvp.empty) {
    alert("이미 참석 신청 또는 대기 등록된 모임입니다.");
    return;
  }

  const isNewbie = isNewbieUser(currentUser.approvedAt);
  const effectiveMax = isNewbie ? (currentEvent.maxParticipants + 2) : currentEvent.maxParticipants;
  const isFull = (currentEvent.currentCount || 0) >= effectiveMax;
  const rsvpStatus = isFull ? "waiting" : "attending";

  const rsvpDocId = `${currentEvent.id}_${currentUser.uid}`;
  await setDoc(doc(db, "rsvps", rsvpDocId), {
    eventId: currentEvent.id,
    uid: currentUser.uid,
    displayName: currentUser.displayName,
    isNewbie: isNewbie,
    status: rsvpStatus,
    createdAt: serverTimestamp()
  });

  if (rsvpStatus === "attending") {
    const newCount = (currentEvent.currentCount || 0) + 1;
    await updateDoc(doc(db, "events", currentEvent.id), { currentCount: newCount });
    currentEvent.currentCount = newCount;
    document.getElementById('modalCapacity').innerText = `${newCount} / ${currentEvent.maxParticipants}명`;
    
    await updateDoc(doc(db, "users", currentUser.uid), {
      joinCount: (currentUser.joinCount || 0) + 1
    });
  }

  alert(rsvpStatus === "attending" ? "참석 신청이 완료되었습니다!" : "정원이 초과되어 대기자로 등록되었습니다.");
  await loadRSVPList();
  renderCalendar();
};

// 참석 취소
document.getElementById('btnCancel').onclick = async () => {
  if (!currentEvent || !currentUser) return;

  const rsvpDocId = `${currentEvent.id}_${currentUser.uid}`;
  const rsvpSnap = await getDoc(doc(db, "rsvps", rsvpDocId));

  if (!rsvpSnap.exists()) {
    alert("신청 내역이 없습니다.");
    return;
  }

  const eventTime = new Date(currentEvent.date).getTime();
  const now = new Date().getTime();
  const hoursDiff = (eventTime - now) / (1000 * 60 * 60);

  let cancelReason = "";
  if (hoursDiff < 24) {
    cancelReason = prompt("모임 시작 24시간 이내 취소 시 취소 사유를 입력해야 합니다:");
    if (!cancelReason || cancelReason.trim() === "") {
      alert("취소 사유를 입력하지 않으면 취소할 수 없습니다.");
      return;
    }
  }

  const rsvpData = rsvpSnap.data();
  await deleteDoc(doc(db, "rsvps", rsvpDocId));

  if (rsvpData.status === "attending") {
    const newCount = Math.max(0, (currentEvent.currentCount || 1) - 1);
    await updateDoc(doc(db, "events", currentEvent.id), { currentCount: newCount });
    currentEvent.currentCount = newCount;
    document.getElementById('modalCapacity').innerText = `${newCount} / ${currentEvent.maxParticipants}명`;

    await updateDoc(doc(db, "users", currentUser.uid), {
      cancelCount: (currentUser.cancelCount || 0) + 1
    });
  }

  alert("참석 취소가 완료되었습니다.");
  await loadRSVPList();
  renderCalendar();
};

// 모임 생성
const createForm = document.getElementById('createEventForm');
if (createForm) {
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateVal = document.getElementById('eventDate').value;

    await addDoc(collection(db, "events"), {
      title: document.getElementById('eventTitle').value,
      date: dateVal,
      location: document.getElementById('eventLocation').value,
      maxParticipants: parseInt(document.getElementById('eventMax').value),
      currentCount: 0,
      description: document.getElementById('eventDesc').value,
      supplies: document.getElementById('eventSupplies').value,
      createdBy: currentUser.uid,
      status: "approved",
      createdAt: serverTimestamp()
    });

    alert("모임이 성공적으로 등록되었습니다.");
    document.getElementById('createModal').classList.remove('active');
    renderCalendar();
  });
}

// 모달 닫기
document.querySelectorAll('.closeModal').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  };
});

document.getElementById('openCreateModalBtn').onclick = () => {
  document.getElementById('createModal').classList.add('active');
};