import { db } from './firebase-config.js';
import { checkAuth } from './auth.js';
import { 
  collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp, runTransaction, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentEvent = null;
let currentDate = new Date();
let cachedEvents = []; // 메모리 캐싱으로 DB 읽기 비용 최소화

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
  return HOLIDAYS.fixed[`${mm}-${dd}`] || HOLIDAYS.variable[`${year}-${mm}-${dd}`] || null;
}

// YYYY-MM-DD 규격화 헬퍼 함수
function formatDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 4단계 모임 상태 산정 함수
function getEventStatusInfo(event) {
  const now = new Date();
  const eventDate = new Date(event.date);
  
  // 모임 당일 24:00 (다음날 00:00)
  const endOfDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate() + 1, 0, 0, 0);

  if (now >= endOfDay) {
    return { status: "ended", text: "일정 종료", badgeClass: "badge-ended", chipClass: "ended" };
  } else if (now >= eventDate && now < endOfDay) {
    return { status: "live", text: "🚨 진행 중", badgeClass: "badge-live", chipClass: "live" };
  } else if (event.currentCount >= event.maxParticipants) {
    return { status: "closed", text: "정원 마감", badgeClass: "badge-closed", chipClass: "closed" };
  } else {
    return { status: "open", text: "모집 중", badgeClass: "badge-open", chipClass: "open" };
  }
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
      if (`${rDate.getFullYear()}-${String(rDate.getMonth() + 1).padStart(2, '0')}` === currentYearMonth) {
        monthCount++;
      }
    }
  });

  const lastJoinedStr = userData.lastJoinedAt ? new Date(userData.lastJoinedAt.toDate()).toLocaleDateString('ko-KR') : '참여 내역 없음';
  document.getElementById('userInfo').innerText = `총 참여횟수 : ${userData.actualJoinCount || 0}회 (이번달 : ${monthCount}회) | 마지막 참여일자 : ${lastJoinedStr}`;

  if (userData.role === 'admin' || userData.clubRole === '모임장' || userData.clubRole === '운영진') {
    document.getElementById('adminBtn').style.display = 'inline-block';
  }

  loadPinnedNotice();
  refreshCalendarData();
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

// 🚀 부분 DOM 동적 갱신 (전체 리로드 대신 데이터 재호출)
async function refreshCalendarData() {
  try {
    const todayKey = formatDateKey(new Date());
    // DB 읽기 최적화: 금일 이전 지난달 데이터 무분별 로딩 방지
    const q = query(collection(db, "events"), orderBy("date", "asc"));
    const snap = await getDocs(q);
    
    cachedEvents = [];
    snap.forEach(docSnap => {
      const e = docSnap.data();
      e.id = docSnap.id;
      cachedEvents.push(e);
    });

    renderCalendar();
    renderUpcomingEventsDashboard();
  } catch (err) {
    console.error("데이터 로딩 중 네트워크 예외 발생:", err);
  }
}

// 캘린더 렌더링 (모바일 점 표기 & 과거 날짜 Dimmed)
function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendarEl.innerHTML = '';

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  document.getElementById('currentYearMonth').innerText = `${year}년 ${month + 1}월`;

  const days = ['일', '월', '화', '수', '목', '금', '토'];
  days.forEach(d => calendarEl.innerHTML += `<div class="calendar-day-header">${d}</div>`);

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    calendarEl.innerHTML += `<div class="calendar-day empty"></div>`;
  }

  const todayKey = formatDateKey(new Date());

  for (let date = 1; date <= lastDate; date++) {
    const cellDateObj = new Date(year, month, date);
    const cellDateKey = formatDateKey(cellDateObj);
    const dayOfWeek = cellDateObj.getDay();
    const holidayName = getHolidayName(year, month, date);

    let dayClass = "";
    if (dayOfWeek === 0) dayClass = "sunday";
    else if (dayOfWeek === 6) dayClass = "saturday";
    if (holidayName) dayClass += " holiday";

    const isToday = (cellDateKey === todayKey);
    const isPast = (cellDateKey < todayKey);

    calendarEl.innerHTML += `
      <div class="calendar-day ${dayClass} ${isToday ? 'today' : ''} ${isPast ? 'past-day' : ''}" id="day-${date}" onclick="handleDayClick(${year}, ${month}, ${date})">
        <div class="date-num">${date}</div>
        ${holidayName ? `<div class="holiday-label">${holidayName}</div>` : ''}
        <div class="mobile-dot-container" id="dots-${date}"></div>
      </div>
    `;
  }

  // 모임 바인딩
  cachedEvents.forEach(event => {
    const eventDateObj = new Date(event.date);
    if (eventDateObj.getFullYear() === year && eventDateObj.getMonth() === month) {
      const eventDay = eventDateObj.getDate();
      const dayEl = document.getElementById(`day-${eventDay}`);
      const dotEl = document.getElementById(`dots-${eventDay}`);

      if (dayEl) {
        const statusInfo = getEventStatusInfo(event);
        
        // 데스크톱 칩
        const chip = document.createElement('div');
        chip.className = `event-chip ${statusInfo.chipClass}`;
        chip.innerText = `${event.title} (${event.currentCount || 0}/${event.maxParticipants})`;
        chip.onclick = (e) => { e.stopPropagation(); openDetailModal(event); };
        dayEl.appendChild(chip);

        // 모바일 점 표시
        if (dotEl) {
          const dot = document.createElement('div');
          dot.className = 'mobile-dot';
          dotEl.appendChild(dot);
        }
      }
    }
  });
}

// 모바일 날짜 터치 시 일자별 모임 팝업
window.handleDayClick = (year, month, date) => {
  if (window.innerWidth > 768) return; // 모바일 전용
  
  const targetKey = formatDateKey(new Date(year, month, date));
  const dayEvents = cachedEvents.filter(e => formatDateKey(new Date(e.date)) === targetKey);

  if (dayEvents.length === 0) return;

  const content = document.getElementById('dayListContent');
  content.innerHTML = '';

  dayEvents.forEach(evt => {
    const statusInfo = getEventStatusInfo(evt);
    content.innerHTML += `
      <div style="padding:10px; border-bottom:1px solid var(--border-color); cursor:pointer;" onclick="closeModalAndOpenDetail('${evt.id}')">
        <strong>${evt.title}</strong> <span class="badge ${statusInfo.badgeClass}">${statusInfo.text}</span><br>
        <span style="font-size:12px; color:var(--subtext-color);">시간: ${new Date(evt.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} | 정원: ${evt.currentCount}/${evt.maxParticipants}</span>
      </div>
    `;
  });

  document.getElementById('dayListTitle').innerText = `${month + 1}월 ${date}일 모임 목록`;
  document.getElementById('dayListModal').classList.add('active');
};

window.closeModalAndOpenDetail = (eventId) => {
  document.getElementById('dayListModal').classList.remove('active');
  const evt = cachedEvents.find(e => e.id === eventId);
  if (evt) openDetailModal(evt);
};

// 현황판 렌더링 (현황판 클릭 시 모달 연동)
async function renderUpcomingEventsDashboard() {
  const tbody1 = document.getElementById('statusTableBody1');
  const tbody2 = document.getElementById('statusTableBody2');
  const table2Wrapper = document.getElementById('table2Wrapper');

  tbody1.innerHTML = '';
  tbody2.innerHTML = '';

  const todayKey = formatDateKey(new Date());
  const upcomingEvents = cachedEvents.filter(e => formatDateKey(new Date(e.date)) >= todayKey);

  const rsvpSnap = await getDocs(collection(db, "rsvps"));
  const newbieCounts = {};
  rsvpSnap.forEach(r => {
    const rData = r.data();
    if (rData.status === 'attending' && rData.isNewbie) {
      newbieCounts[rData.eventId] = (newbieCounts[rData.eventId] || 0) + 1;
    }
  });

  const hasMoreThan10 = upcomingEvents.length > 10;
  table2Wrapper.style.display = hasMoreThan10 ? 'block' : 'none';

  const table1Events = upcomingEvents.slice(0, 10);
  const table2Events = hasMoreThan10 ? upcomingEvents.slice(10, 20) : [];

  function createRowHtml(evt) {
    if (!evt) return `<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>`;
    
    const evtDate = new Date(evt.date);
    const dateStr = `${evtDate.getMonth() + 1}/${evtDate.getDate()}`;
    const newbieCnt = newbieCounts[evt.id] || 0;
    const expandTimes = evt.expansionCount || 0;
    const statusInfo = getEventStatusInfo(evt);

    return `
      <tr onclick="openDetailModalById('${evt.id}')" style="cursor:pointer;">
        <td><strong>${dateStr}</strong></td>
        <td>${evt.title} <span class="badge ${statusInfo.badgeClass}">${statusInfo.text}</span></td>
        <td>${evt.hostDisplayName || evt.hostName || '관리자'}</td>
        <td>${evt.currentCount || 0}/${evt.maxParticipants} (${newbieCnt}명)</td>
        <td>${expandTimes > 0 ? `<span class="badge badge-expanded">${expandTimes}회 증설</span>` : '<span style="color:var(--subtext-color);">0회</span>'}</td>
      </tr>
    `;
  }

  for (let i = 0; i < 10; i++) tbody1.innerHTML += createRowHtml(table1Events[i]);
  if (hasMoreThan10) {
    for (let i = 0; i < 10; i++) tbody2.innerHTML += createRowHtml(table2Events[i]);
  }
}

window.openDetailModalById = (eventId) => {
  const evt = cachedEvents.find(e => e.id === eventId);
  if (evt) openDetailModal(evt);
};

document.getElementById('prevMonthBtn').onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); };
document.getElementById('nextMonthBtn').onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); };

// 모임 상세 모달 & 오픈채팅 접근제어
async function openDetailModal(event) {
  currentEvent = event;
  document.getElementById('modalTitle').innerText = event.title;
  document.getElementById('modalHost').innerText = event.hostDisplayName || event.hostName || '관리자';
  document.getElementById('modalDate').innerText = new Date(event.date).toLocaleString();
  document.getElementById('modalLocation').innerText = event.location;
  document.getElementById('modalCapacity').innerText = `${event.currentCount || 0} / ${event.maxParticipants}명`;
  document.getElementById('modalDesc').innerText = event.description;

  const statusInfo = getEventStatusInfo(event);
  document.getElementById('modalStatusBadge').innerHTML = `<span class="badge ${statusInfo.badgeClass}">${statusInfo.text}</span>`;

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.clubRole === '모임장' || currentUser.clubRole === '운영진');
  const isHost = currentUser && currentUser.uid === event.createdBy;

  // 수정/삭제 버튼
  const ctrlBtns = document.getElementById('ownerAdminControlBtns');
  ctrlBtns.style.display = (isAdmin || isHost) ? 'flex' : 'none';
  document.getElementById('btnDeleteEvent').style.display = isAdmin ? 'inline-block' : 'none';

  await loadRSVPList(isAdmin);
  document.getElementById('detailModal').classList.add('active');
}

// RSVP 조회 및 오픈채팅방 링크 참석자 전용 노출
async function loadRSVPList(isAdmin) {
  const rsvpQuery = await getDocs(query(collection(db, "rsvps"), where("eventId", "==", currentEvent.id)));
  const pList = document.getElementById('participantList');
  const wList = document.getElementById('waitingList');
  pList.innerHTML = ''; wList.innerHTML = '';

  let isAttendingUser = false;

  rsvpQuery.forEach((rSnap) => {
    const rData = rSnap.data();
    if (rData.uid === currentUser.uid && rData.status === 'attending') {
      isAttendingUser = true;
    }

    const li = document.createElement('li');
    li.innerText = `${rData.displayName}${rData.isNewbie ? " 🔰(신입)" : ""}`;
    if (rData.cancelReason) li.innerText += ` (취소사유: ${rData.cancelReason})`;

    if (rData.status === 'attending') pList.appendChild(li);
    else if (rData.status === 'waiting') wList.appendChild(li);
  });

  // 🔒 오픈채팅방 접근 제어: 참석확정자 및 관리자만 노출
  const chatArea = document.getElementById('modalOpenChatArea');
  if (currentEvent.openChatUrl && (isAttendingUser || isAdmin)) {
    document.getElementById('modalOpenChatLink').href = currentEvent.openChatUrl;
    chatArea.style.display = 'block';
  } else {
    chatArea.style.display = 'none';
  }
}

// 🔒 참석 신청: Firestore Transaction 동시성 에러 방지 및 휴회회원 차단
document.getElementById('btnAttend').onclick = async () => {
  if (!currentEvent || !currentUser) return;

  if (currentUser.status === "paused" || currentUser.status === "banned" || currentUser.status === "pending") {
    return alert("현재 정지/휴회 또는 승인 대기 중인 계정은 참석 신청이 불가능합니다.");
  }

  const rsvpDocRef = doc(db, "rsvps", `${currentEvent.id}_${currentUser.uid}`);
  const eventDocRef = doc(db, "events", currentEvent.id);

  try {
    await runTransaction(db, async (transaction) => {
      const eventSnap = await transaction.get(eventDocRef);
      const rsvpSnap = await transaction.get(rsvpDocRef);

      if (rsvpSnap.exists()) {
        throw new Error("이미 참석 신청 또는 대기 등록된 모임입니다.");
      }

      const eventData = eventSnap.data();
      const isNewbie = isNewbieUser(currentUser.approvedAt);
      const effectiveMax = isNewbie ? (eventData.maxParticipants + 2) : eventData.maxParticipants;
      const isFull = (eventData.currentCount || 0) >= effectiveMax;
      const rsvpStatus = isFull ? "waiting" : "attending";

      transaction.set(rsvpDocRef, {
        eventId: currentEvent.id,
        eventTitle: eventData.title,
        uid: currentUser.uid,
        displayName: currentUser.displayName,
        gender: currentUser.gender || "미지정",
        isNewbie: isNewbie,
        status: rsvpStatus,
        createdAt: serverTimestamp()
      });

      if (rsvpStatus === "attending") {
        transaction.update(eventDocRef, { currentCount: (eventData.currentCount || 0) + 1 });
      }
    });

    alert("참석 처리가 정상 완료되었습니다!");
    document.getElementById('detailModal').classList.remove('active');
    refreshCalendarData();
  } catch (err) {
    alert(err.message || "네트워크 오류로 처리 실패. 다시 시도해 주세요.");
  }
};

// 🔒 참석 취소 트랜잭션
document.getElementById('btnCancel').onclick = async () => {
  if (!currentEvent || !currentUser) return;

  const rsvpDocRef = doc(db, "rsvps", `${currentEvent.id}_${currentUser.uid}`);
  const eventDocRef = doc(db, "events", currentEvent.id);

  const eventTime = new Date(currentEvent.date).getTime();
  const hoursDiff = (eventTime - new Date().getTime()) / (1000 * 60 * 60);

  let cancelReason = "";
  if (hoursDiff < 24) {
    cancelReason = prompt("모임 시작 24시간 이내 취소 시 취소 사유를 입력해야 합니다:");
    if (!cancelReason || !cancelReason.trim()) return alert("취소 사유를 입력해야 합니다.");
  }

  try {
    await runTransaction(db, async (transaction) => {
      const rsvpSnap = await transaction.get(rsvpDocRef);
      if (!rsvpSnap.exists()) throw new Error("신청 내역이 없습니다.");

      const rsvpData = rsvpSnap.data();
      transaction.delete(rsvpDocRef);

      if (rsvpData.status === "attending") {
        const eventSnap = await transaction.get(eventDocRef);
        const eventData = eventSnap.data();
        transaction.update(eventDocRef, { currentCount: Math.max(0, (eventData.currentCount || 1) - 1) });
      }
    });

    if (cancelReason) {
      await addDoc(collection(db, "cancelLogs"), {
        uid: currentUser.uid,
        eventId: currentEvent.id,
        reason: cancelReason,
        createdAt: serverTimestamp()
      });
    }

    alert("참석 취소가 완료되었습니다.");
    document.getElementById('detailModal').classList.remove('active');
    refreshCalendarData();
  } catch (err) {
    alert(err.message || "취소 처리 중 오류가 발생했습니다.");
  }
};

// 🔒 모임 삭제: Batch Write 적용 하위 RSVP 고아 데이터 전수 삭제
document.getElementById('btnDeleteEvent').onclick = async () => {
  if (!currentEvent) return;
  if (!confirm("정말 삭제하시겠습니까? 연관된 모든 참석 신청 데이터도 함께 삭제됩니다.")) return;

  try {
    const batch = writeBatch(db);
    
    // 1. 모임 문서 삭제
    batch.delete(doc(db, "events", currentEvent.id));

    // 2. 관련 rsvps 내역 전수 검색 후 삭제 등록
    const rsvpSnap = await getDocs(query(collection(db, "rsvps"), where("eventId", "==", currentEvent.id)));
    rsvpSnap.forEach(rDoc => batch.delete(rDoc.ref));

    await batch.commit();

    alert("모임 일정 및 관련 참석 내역이 일괄 삭제되었습니다.");
    document.getElementById('detailModal').classList.remove('active');
    refreshCalendarData();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
};

// 🔒 모임 등록: 1회 이상 참석 완료 룰 검증
const createForm = document.getElementById('createEventForm');
if (createForm) {
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.clubRole === '모임장' || currentUser.clubRole === '운영진');
    
    // 1회 이상 참여 완료 룰
    if (!isAdmin && (currentUser.actualJoinCount || 0) < 1) {
      return alert("신규 회원은 최소 1회 이상 모임에 실제 참석 완료(일정 종료 기준)해야 벙을 개설할 수 있습니다.");
    }

    const title = document.getElementById('eventTitle').value;
    const dateVal = document.getElementById('eventDate').value;
    const location = document.getElementById('eventLocation').value;
    const maxVal = parseInt(document.getElementById('eventMax').value);
    const desc = document.getElementById('eventDesc').value;

    const selectedTargetKey = formatDateKey(new Date(dateVal));

    if (!isAdmin) {
      const isDuplicateDate = cachedEvents.some(evt => formatDateKey(new Date(evt.date)) === selectedTargetKey);

      if (isDuplicateDate) {
        alert("선택하신 날짜에는 이미 등록된 모임 일정이 있습니다. 추가 개설을 원하시면 운영진에게 문의해 주세요.");
        document.getElementById('reqEventTitle').value = title;
        document.getElementById('reqEventDate').value = dateVal;
        document.getElementById('reqEventLocation').value = location;
        document.getElementById('reqEventMax').value = maxVal;
        document.getElementById('reqEventDesc').value = desc;

        document.getElementById('createModal').classList.remove('active');
        document.getElementById('requestModal').classList.add('active');
        return;
      }
    }

    await addDoc(collection(db, "events"), {
      title, date: dateVal, location, maxParticipants: maxVal,
      expansionCount: 0, currentCount: 0, description: desc, openChatUrl: "",
      createdBy: currentUser.uid, hostName: currentUser.name, hostDisplayName: currentUser.displayName,
      status: "approved", createdAt: serverTimestamp()
    });

    alert("모임 일정이 등록되었습니다!");
    document.getElementById('createModal').classList.remove('active');
    refreshCalendarData();
  });
}

// 개설 희망 신청 제출
const requestForm = document.getElementById('requestEventForm');
if (requestForm) {
  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "pendingEvents"), {
      title: document.getElementById('reqEventTitle').value,
      date: document.getElementById('reqEventDate').value,
      location: document.getElementById('reqEventLocation').value,
      maxParticipants: parseInt(document.getElementById('reqEventMax').value),
      description: document.getElementById('reqEventDesc').value,
      requestReason: document.getElementById('reqReason').value,
      createdBy: currentUser.uid, hostName: currentUser.name, hostDisplayName: currentUser.displayName,
      status: "pending", createdAt: serverTimestamp()
    });

    alert("개설 희망 신청서가 전달되었습니다. 관리자 승인 후 등록됩니다.");
    document.getElementById('requestModal').classList.remove('active');
  });
}

// 모달 닫기 공통
document.querySelectorAll('.closeModal').forEach(btn => {
  btn.onclick = () => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
});

document.getElementById('openCreateModalBtn').onclick = () => {
  document.getElementById('createModal').classList.add('active');
};