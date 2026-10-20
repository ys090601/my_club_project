import { db } from './firebase-config.js';
import { checkAuth } from './auth.js';
import { 
  collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentEvent = null;
let currentDate = new Date();

// ⏰ 5분(300,000ms) 주기 자동 새로고침 설정
setInterval(() => {
  console.log("5분 주기 자동 새로고침 실행");
  window.location.reload();
}, 5 * 60 * 1000);

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

checkAuth(async (userData) => {
  currentUser = userData;
  document.getElementById('userWelcome').innerText = `안녕하세요, ${userData.name}님!`;

  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const rsvpSnap = await getDocs(query(
    collection(db, "rsvps"),
    where("uid", "==", userData.uid),
    where("status", "==", "attending")
  ));

  let monthCount = 0;
  rsvpSnap.forEach(r => {
    const rData = r.data();
    if (rData.createdAt) {
      const rDate = rData.createdAt.toDate ? rData.createdAt.toDate() : new Date(rData.createdAt);
      const rYM = `${rDate.getFullYear()}-${String(rDate.getMonth() + 1).padStart(2, '0')}`;
      if (rYM === currentYearMonth) monthCount++;
    }
  });

  const lastJoinedStr = userData.lastJoinedAt ? new Date(userData.lastJoinedAt.toDate()).toLocaleDateString('ko-KR') : '참여 내역 없음';
  document.getElementById('userInfo').innerText = `총 참여횟수 : ${userData.joinCount || 0}회 (이번달 : ${monthCount}회) | 마지막 참여일자 : ${lastJoinedStr}`;

  if (userData.role === 'admin' || userData.clubRole === '모임장' || userData.clubRole === '운영진') {
    document.getElementById('adminBtn').style.display = 'inline-block';
  }

  loadPinnedNotice();
  renderCalendar();
  renderUpcomingEventsDashboard(); // 금일 기준 전 일정 현황판 렌더링
});

async function loadPinnedNotice() {
  const q = query(collection(db, "notices"), where("isPinned", "==", true));
  const snap = await getDocs(q);
  
  if (!snap.empty) {
    const pinned = snap.docs[0].data();
    document.getElementById('pinnedNoticeTitle').innerText = `📌 ${pinned.title}`;
    document.getElementById('pinnedNoticeContent').innerText = pinned.content;
    document.getElementById('mainPinnedNotice').style.display = 'block';
  }
}

function isNewbieUser(approvedAt) {
  if (!approvedAt) return false;
  const approvedDate = approvedAt.toDate ? approvedAt.toDate() : new Date(approvedAt);
  const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
  return (new Date() - approvedDate) < thirtyDaysInMs;
}

// 캘린더 그리드 렌더링
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

  const querySnapshot = await getDocs(query(collection(db, "events"), orderBy("date", "asc")));

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

// 📊 금일(2026.10.21) 기준 향후 전체 일정 현황판 출력 함수 (월 선택 독립)
async function renderUpcomingEventsDashboard() {
  const gridContainer = document.getElementById('statusDashboardGrid');
  const tbody1 = document.getElementById('statusTableBody1');
  const tbody2 = document.getElementById('statusTableBody2');
  const table2Wrapper = document.getElementById('table2Wrapper');

  tbody1.innerHTML = '';
  tbody2.innerHTML = '';

  // 금일 00:00:00 기준 설정
  const todayStr = new Date().toISOString().split('T')[0];

  // 금일 기준 이후 예정된 모든 모임 일정 가져오기
  const querySnapshot = await getDocs(query(collection(db, "events"), orderBy("date", "asc")));
  const upcomingEvents = [];

  querySnapshot.forEach((docSnap) => {
    const evt = docSnap.data();
    evt.id = docSnap.id;
    const evtDateStr = evt.date ? evt.date.split('T')[0] : '';
    if (evtDateStr >= todayStr) {
      upcomingEvents.push(evt);
    }
  });

  // 모든 모임의 신입 참석자 수 조회
  const rsvpSnap = await getDocs(collection(db, "rsvps"));
  const newbieCounts = {};
  rsvpSnap.forEach(r => {
    const rData = r.data();
    if (rData.status === 'attending' && rData.isNewbie) {
      newbieCounts[rData.eventId] = (newbieCounts[rData.eventId] || 0) + 1;
    }
  });

  const hasMoreThan10 = upcomingEvents.length > 10;

  if (hasMoreThan10) {
    table2Wrapper.style.display = 'block';
    gridContainer.classList.add('dashboard-parallel-grid');
  } else {
    table2Wrapper.style.display = 'none';
    gridContainer.classList.remove('dashboard-parallel-grid');
  }

  const table1Events = upcomingEvents.slice(0, 10);
  const table2Events = hasMoreThan10 ? upcomingEvents.slice(10, 20) : [];

  function createRowHtml(evt) {
    if (!evt) {
      return `<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>`;
    }
    const evtDate = new Date(evt.date);
    const dateStr = `${evtDate.getMonth() + 1}/${evtDate.getDate()}`;
    const newbieCnt = newbieCounts[evt.id] || 0;
    
    // 벙주 표기: 사용자명 (이름/연도/지역)
    const hostDisplayName = evt.hostDisplayName || evt.hostName || '관리자';

    // 증설 횟수: 관리자가 증설 버튼 클릭한 실제 횟수(expansionCount) 표기
    const expandTimes = evt.expansionCount || 0;
    
    let expandText = `<span style="color:var(--subtext-color);">0회 (기본)</span>`;
    if (expandTimes > 0) {
      expandText = `<span class="badge badge-expanded">${expandTimes}회 증설</span>`;
    }

    return `
      <tr onclick="openDetailModalById('${evt.id}')" style="cursor:pointer;">
        <td><strong>${dateStr}</strong></td>
        <td>${evt.title}</td>
        <td>${hostDisplayName}</td>
        <td>${evt.currentCount || 0}/${evt.maxParticipants} (${newbieCnt}명)</td>
        <td>${expandText}</td>
      </tr>
    `;
  }

  for (let i = 0; i < 10; i++) {
    tbody1.innerHTML += createRowHtml(table1Events[i]);
  }

  if (hasMoreThan10) {
    for (let i = 0; i < 10; i++) {
      tbody2.innerHTML += createRowHtml(table2Events[i]);
    }
  }
}

window.openDetailModalById = async (eventId) => {
  const eSnap = await getDoc(doc(db, "events", eventId));
  if (eSnap.exists()) {
    const eData = eSnap.data();
    eData.id = eSnap.id;
    openDetailModal(eData);
  }
};

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
  document.getElementById('modalHost').innerText = event.hostDisplayName || event.hostName || '관리자';
  document.getElementById('modalDate').innerText = new Date(event.date).toLocaleString();
  document.getElementById('modalLocation').innerText = event.location;
  document.getElementById('modalCapacity').innerText = `${event.currentCount || 0} / ${event.maxParticipants}명`;
  document.getElementById('modalDesc').innerText = event.description;

  const chatArea = document.getElementById('modalOpenChatArea');
  const chatLink = document.getElementById('modalOpenChatLink');
  if (event.openChatUrl && chatArea && chatLink) {
    chatLink.href = event.openChatUrl;
    chatArea.style.display = 'block';
  } else if (chatArea) {
    chatArea.style.display = 'none';
  }

  const ctrlBtns = document.getElementById('ownerAdminControlBtns');
  const btnDelete = document.getElementById('btnDeleteEvent');
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.clubRole === '모임장' || currentUser.clubRole === '운영진');
  const isHost = currentUser && currentUser.uid === event.createdBy;

  if (isAdmin || isHost) {
    ctrlBtns.style.display = 'flex';
    btnDelete.style.display = isAdmin ? 'inline-block' : 'none';
  } else {
    ctrlBtns.style.display = 'none';
  }

  await loadRSVPList();
  document.getElementById('detailModal').classList.add('active');
}

document.getElementById('btnOpenEdit').onclick = () => {
  if (!currentEvent || !currentUser) return;
  const isAdmin = currentUser.role === 'admin' || currentUser.clubRole === '모임장' || currentUser.clubRole === '운영진';

  document.getElementById('editEventId').value = currentEvent.id;
  document.getElementById('editEventTitle').value = currentEvent.title;
  document.getElementById('editEventDate').value = currentEvent.date;
  document.getElementById('editEventLocation').value = currentEvent.location;
  document.getElementById('editEventMax').value = currentEvent.maxParticipants;
  document.getElementById('editEventDesc').value = currentEvent.description;

  const editOpenChatGrp = document.getElementById('editOpenChatGroup');
  const locInput = document.getElementById('editEventLocation');
  const maxInput = document.getElementById('editEventMax');

  locInput.removeAttribute('readonly');

  if (isAdmin) {
    maxInput.removeAttribute('readonly');
    if (editOpenChatGrp) {
      editOpenChatGrp.style.display = 'block';
      document.getElementById('editEventOpenChat').value = currentEvent.openChatUrl || '';
    }
  } else {
    maxInput.setAttribute('readonly', true);
    if (editOpenChatGrp) editOpenChatGrp.style.display = 'none';
  }

  document.getElementById('detailModal').classList.remove('active');
  document.getElementById('editModal').classList.add('active');
};

document.getElementById('editEventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventId = document.getElementById('editEventId').value;
  const isAdmin = currentUser.role === 'admin' || currentUser.clubRole === '모임장' || currentUser.clubRole === '운영진';

  const updateData = {
    date: document.getElementById('editEventDate').value,
    location: document.getElementById('editEventLocation').value,
    description: document.getElementById('editEventDesc').value
  };

  if (isAdmin) {
    updateData.maxParticipants = parseInt(document.getElementById('editEventMax').value);
    updateData.openChatUrl = document.getElementById('editEventOpenChat').value;
  }

  await updateDoc(doc(db, "events", eventId), updateData);
  alert("모임 일정이 수정되었습니다.");
  window.location.reload();
});

document.getElementById('btnDeleteEvent').onclick = async () => {
  if (!currentEvent) return;
  if (confirm("정말 이 모임 일정을 삭제하시겠습니까? 관련 참석 정보도 모두 삭제됩니다.")) {
    await deleteDoc(doc(db, "events", currentEvent.id));
    alert("모임 일정이 삭제되었습니다.");
    window.location.reload();
  }
};

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

  if (currentUser && (currentUser.role === 'admin' || currentUser.clubRole === '모임장' || currentUser.clubRole === '운영진')) {
    const genderInfo = document.createElement('p');
    genderInfo.style.cssText = "font-size:12px; color:var(--primary-color); font-weight:bold; margin-top:5px;";
    genderInfo.innerText = `🔒 [운영진 전용] 참석자 성비: 남 ${maleCnt}명 / 여 ${femaleCnt}명`;
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
    
    await updateDoc(doc(db, "users", currentUser.uid), {
      joinCount: (currentUser.joinCount || 0) + 1,
      lastJoinedAt: serverTimestamp()
    });
  }

  alert(rsvpStatus === "attending" ? "참석 신청이 완료되었습니다!" : "대기자로 등록되었습니다.");
  window.location.reload();
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

    await updateDoc(doc(db, "users", currentUser.uid), {
      cancelCount: (currentUser.cancelCount || 0) + 1
    });
  }

  alert("참석 취소가 완료되었습니다.");
  window.location.reload();
};

const createForm = document.getElementById('createEventForm');
if (createForm) {
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateVal = document.getElementById('eventDate').value;
    const maxVal = parseInt(document.getElementById('eventMax').value);

    await addDoc(collection(db, "events"), {
      title: document.getElementById('eventTitle').value,
      date: dateVal,
      location: document.getElementById('eventLocation').value,
      maxParticipants: maxVal,
      expansionCount: 0,
      currentCount: 0,
      description: document.getElementById('eventDesc').value,
      openChatUrl: "",
      createdBy: currentUser.uid,
      hostName: currentUser.name,
      hostDisplayName: currentUser.displayName,
      status: "approved",
      createdAt: serverTimestamp()
    });

    alert("모임이 성공적으로 등록되었습니다.");
    window.location.reload();
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