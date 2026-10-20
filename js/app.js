import { db } from './firebase-config.js';
import { checkAuth } from './auth.js';
import { 
  collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, query, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentEvent = null;
let currentDate = new Date(); // 현재 캘린더 연월 상태값

// 로그인 상태 체크
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

// 1. 동적 캘린더 렌더링 (월자동 계산)
async function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendarEl.innerHTML = '';

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0 ~ 11

  document.getElementById('currentYearMonth').innerText = `${year}년 ${month + 1}월`;

  // 요일 헤더
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  days.forEach(d => {
    calendarEl.innerHTML += `<div class="calendar-day-header">${d}</div>`;
  });

  // 해당 월의 첫 번째 날 요일과 총 일수 구하기
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  // 이전 달 빈 칸 채우기
  for (let i = 0; i < firstDay; i++) {
    calendarEl.innerHTML += `<div class="calendar-day empty"></div>`;
  }

  // 이번 달 일수 생성
  const today = new Date();
  for (let date = 1; date <= lastDate; date++) {
    const isToday = (today.getFullYear() === year && today.getMonth() === month && today.getDate() === date);
    calendarEl.innerHTML += `
      <div class="calendar-day ${isToday ? 'today' : ''}" id="day-${date}">
        <div class="date-num">${date}</div>
      </div>
    `;
  }

  // Firestore에서 해당 월의 일정 데이터 가져오기
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

// 이전달 / 다음달 버튼 이벤트
document.getElementById('prevMonthBtn').onclick = () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
};

document.getElementById('nextMonthBtn').onclick = () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
};

// 2. 모임 상세 모달 및 참석자/대기자 목록 조회
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

// RSVP 리스트 불러오기
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

// 3. 참석 신청 기능
document.getElementById('btnAttend').onclick = async () => {
  if (!currentEvent || !currentUser) return;

  // 이미 참석 여부 확인
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
  // 신입 우대 (+2명 정원 확장 인정)
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

  // 정원 미달 참석 시 카운트 증가
  if (rsvpStatus === "attending") {
    const newCount = (currentEvent.currentCount || 0) + 1;
    await updateDoc(doc(db, "events", currentEvent.id), { currentCount: newCount });
    currentEvent.currentCount = newCount;
    document.getElementById('modalCapacity').innerText = `${newCount} / ${currentEvent.maxParticipants}명`;
    
    // 유저 참여 횟수 증가
    await updateDoc(doc(db, "users", currentUser.uid), {
      joinCount: (currentUser.joinCount || 0) + 1
    });
  }

  alert(rsvpStatus === "attending" ? "참석 신청이 완료되었습니다!" : "정원이 초과되어 대기자로 등록되었습니다.");
  await loadRSVPList();
  renderCalendar();
};

// 4. 참석 취소 기능 (24시간 전 취소 사유 필수 입력)
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

    // 취소 횟수 증가
    await updateDoc(doc(db, "users", currentUser.uid), {
      cancelCount: (currentUser.cancelCount || 0) + 1
    });
  }

  alert("참석 취소가 완료되었습니다.");
  await loadRSVPList();
  renderCalendar();
};

// 1일 1일정 모임 생성
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