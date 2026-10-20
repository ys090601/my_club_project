import { db } from './firebase-config.js';
import { checkAuth } from './auth.js';
import { 
  collection, addDoc, getDocs, doc, getDoc, updateDoc, setDoc, query, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentEvent = null;

checkAuth((userData) => {
  currentUser = userData;
  document.getElementById('userWelcome').innerText = `안녕하세요, ${userData.name}님!`;
  document.getElementById('userInfo').innerText = `표시명: ${userData.displayName} (${userData.role === 'admin' ? '관리자' : '회원'})`;
  
  if (userData.role === 'admin') {
    document.getElementById('adminBtn').style.display = 'inline-block';
  }
  
  renderCalendar();
});

// 신입 회원(가입 30일 이내) 여부 판별
function isNewbieUser(approvedAt) {
  if (!approvedAt) return false;
  const approvedDate = approvedAt.toDate();
  const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
  return (new Date() - approvedDate) < thirtyDaysInMs;
}

// 캘린더 렌더링
async function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendarEl.innerHTML = '';

  const days = ['일', '월', '화', '수', '목', '금', '토'];
  days.forEach(d => {
    calendarEl.innerHTML += `<div class="calendar-day-header">${d}</div>`;
  });

  // 이번 달 일수 계산 (기본 30일 표기)
  for (let i = 1; i <= 30; i++) {
    calendarEl.innerHTML += `<div class="calendar-day" id="day-${i}"><div class="date-num">${i}일</div></div>`;
  }

  // 등록된 모임 로딩
  const querySnapshot = await getDocs(collection(db, "events"));
  querySnapshot.forEach((docSnap) => {
    const event = docSnap.data();
    event.id = docSnap.id;
    const eventDay = new Date(event.date).getDate();
    const dayEl = document.getElementById(`day-${eventDay}`);
    
    if (dayEl) {
      const chip = document.createElement('div');
      chip.className = `event-chip ${event.status === 'closed' ? 'closed' : ''}`;
      chip.innerText = `${event.title} (${event.currentCount || 0}/${event.maxParticipants})`;
      chip.onclick = () => openDetailModal(event);
      dayEl.appendChild(chip);
    }
  });
}

// 모임 상세 모달 열기
async function openDetailModal(event) {
  currentEvent = event;
  document.getElementById('modalTitle').innerText = event.title;
  document.getElementById('modalDate').innerText = new Date(event.date).toLocaleString();
  document.getElementById('modalLocation').innerText = event.location;
  document.getElementById('modalCapacity').innerText = `${event.currentCount || 0} / ${event.maxParticipants}명`;
  document.getElementById('modalDesc').innerText = event.description;
  document.getElementById('modalSupplies').innerText = event.supplies || '없음';

  // 참석자 명단 로딩
  const rsvpQuery = await getDocs(query(collection(db, "rsvps"), where("eventId", "==", event.id)));
  const pList = document.getElementById('participantList');
  const wList = document.getElementById('waitingList');
  pList.innerHTML = '';
  wList.innerHTML = '';

  rsvpQuery.forEach((rSnap) => {
    const rData = rSnap.data();
    const li = document.createElement('li');
    li.innerText = rData.displayName + (rData.isNewbie ? " 🔰(신입)" : "");
    if (rData.status === 'attending') pList.appendChild(li);
    else if (rData.status === 'waiting') wList.appendChild(li);
  });

  document.getElementById('detailModal').classList.add('active');
}

// 1일 1일정 원칙 검증 후 모임 등록
const createForm = document.getElementById('createEventForm');
if (createForm) {
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateVal = document.getElementById('eventDate').value;
    const selectedDateStr = dateVal.split('T')[0];

    // 중복 날짜 체크
    const existingEvents = await getDocs(collection(db, "events"));
    let isDuplicate = false;
    existingEvents.forEach(snap => {
      if (snap.data().date.startsWith(selectedDateStr)) isDuplicate = true;
    });

    let eventStatus = 'approved';
    if (isDuplicate && currentUser.role !== 'admin') {
      alert("해당 날짜에 이미 모임이 존재합니다. 추가 개설은 관리자 승인이 필요합니다.");
      eventStatus = 'pending_approval';
    }

    await addDoc(collection(db, "events"), {
      title: document.getElementById('eventTitle').value,
      date: dateVal,
      location: document.getElementById('eventLocation').value,
      maxParticipants: parseInt(document.getElementById('eventMax').value),
      currentCount: 0,
      description: document.getElementById('eventDesc').value,
      supplies: document.getElementById('eventSupplies').value,
      createdBy: currentUser.uid,
      status: eventStatus,
      createdAt: serverTimestamp()
    });

    alert("모임이 등록되었습니다.");
    document.getElementById('createModal').classList.remove('active');
    renderCalendar();
  });
}

// 모달 닫기 공통
document.querySelectorAll('.closeModal').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  };
});

document.getElementById('openCreateModalBtn').onclick = () => {
  document.getElementById('createModal').classList.add('active');
};