import { db } from './firebase-config.js';
import { checkAuth } from './auth.js';
import { 
  collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, query, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentEvent = null;
let currentDate = new Date();

// 한국 법정 공휴일
const HOLIDAYS = {
  fixed: {
    "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날", "06-06": "현충일",
    "08-15": "광복절", "10-03": "개천절", "10-09": "한글날", "12-25": "크리스마스"
  },
  variable: {
    "2026-02-16": "설날 연휴", "2026-02-17": "설날", "2026-02-18": "설날 연휴",
    "2026-03-02": "대체공휴일", "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일",
    "2026-08-17": "대체공휴일", "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-09-26": "추석 연휴",
    "2026-10-05": "대체공휴일"
  }
};

function getHolidayName(year, month, date) {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(date).padStart(2, '0');
  const monthDay = `${mm}-${dd}`;
  const fullDate = `${year}-${mm}-${dd}`;

  if (HOLIDAYS.fixed[monthDay]) return HOLIDAYS.fixed[monthDay];
  if (HOLIDAYS.variable[fullDate]) return HOLIDAYS.variable[fullDate];
  return null;
}

checkAuth((userData) => {
  currentUser = userData;
  document.getElementById('userWelcome').innerText = `안녕하세요, ${userData.name}님!`;
  document.getElementById('userInfo').innerText = `표시명: ${userData.displayName} (${userData.role === 'admin' ? '관리자' : '회원'})`;
  
  if (userData.role === 'admin') {
    document.getElementById('adminBtn').style.display = 'inline-block';
  }
  
  renderCalendar();
});

function isNewbieUser(approvedAt) {
  if (!approvedAt) return false;
  const approvedDate = approvedAt.toDate ? approvedAt.toDate() : new Date(approvedAt);
  const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
  return (new Date() - approvedDate) < thirtyDaysInMs;
}

async function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendarEl.innerHTML = '';

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  document.getElementById('currentYearMonth').innerText = `${year}년 ${month + 1}월`;

  const days = ['일', '월', '화', '수', '목', '금', '토'];
  days.forEach(d => {
    calendarEl.innerHTML += `<div class="calendar-day-header">${d}</div>`;
  });

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    calendarEl.innerHTML += `<div class="calendar-day empty"></div>`;
  }

  const today = new Date();
  for (let date = 1; date <= lastDate; date++) {
    const dayOfWeek = new Date(year, month, date).getDay();
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

document.getElementById('prevMonthBtn').onclick = () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
};

document.getElementById('nextMonthBtn').onclick = () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
};

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

// RSVP 리스트 로드 및 관리자 전용 성비 계산
async function loadRSVPList() {
  const rsvpQuery = await getDocs(query(collection(db, "rsvps"), where("eventId", "==", currentEvent.id)));
  const pList = document.getElementById('participantList');
  const wList = document.getElementById('waitingList');
  pList.innerHTML = '';
  wList.innerHTML = '';

  let maleCnt = 0;
  let femaleCnt = 0;

  rsvpQuery.forEach((rSnap) => {
    const rData = rSnap.data();
    const li = document.createElement('li');
    li.innerText = `${rData.displayName}${rData.isNewbie ? " 🔰(신입)" : ""}`;
    if (rData.cancelReason) {
      li.innerText += ` (취소사유: ${rData.cancelReason})`;
    }

    if (rData.status === 'attending') {
      pList.appendChild(li);
      if (rData.gender === '남성') maleCnt++;
      else if (rData.gender === '여성') femaleCnt++;
    } else if (rData.status === 'waiting') {
      wList.appendChild(li);
    }
  });

  // 관리자인 경우에만 모임 성비 정보 표시
  if (currentUser && currentUser.role === 'admin') {
    const genderInfo = document.createElement('p');
    genderInfo.style.cssText = "font-size:12px; color:var(--primary-color); font-weight:bold; margin-top:5px;";
    genderInfo.innerText = `🔒 [관리자 전용] 현재 참석자 성비: 남 ${maleCnt}명 / 여 ${femaleCnt}명`;
    pList.appendChild(genderInfo);
  }
}

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
    gender: currentUser.gender || "미지정",
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

document.querySelectorAll('.closeModal').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  };
});

document.getElementById('openCreateModalBtn').onclick = () => {
  document.getElementById('createModal').classList.add('active');
};