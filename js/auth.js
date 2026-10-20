import { auth, db } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, setDoc, getDoc, updateDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const SECRET_AUTH_KEY = "CLUB2026"; 

export function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

const savedTheme = localStorage.getItem('appTheme') || 'system';
applyTheme(savedTheme);

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const currentTheme = localStorage.getItem('appTheme') || 'system';
  if (currentTheme === 'system') {
    applyTheme('system');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const themeSelector = document.getElementById('themeSelector');
  if (themeSelector) {
    themeSelector.value = savedTheme;
    themeSelector.addEventListener('change', async (e) => {
      const selectedTheme = e.target.value;
      localStorage.setItem('appTheme', selectedTheme);
      applyTheme(selectedTheme);

      if (auth.currentUser) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          themePreference: selectedTheme
        });
      }
    });
  }

  // 🎂 출생연도 동적 생성 함수 (상한선: 1989년생 고정, 하한선: 해가 바뀌면 성인 연생 자동 계산)
  const birthYearSelect = document.getElementById('signupBirthYear');
  if (birthYearSelect) {
    const currentYear = new Date().getFullYear();
    const minAdultYear = currentYear - 19; // 만 19세 성인 연생 자동 계산 (2026년 기준 2007년생)
    const minBirthYear = 1989; // 상한선 고정

    for (let year = minBirthYear; year <= minAdultYear; year++) {
      const option = document.createElement('option');
      option.value = String(year);
      option.innerText = `${year}년생`;
      birthYearSelect.appendChild(option);
    }
  }
});

// 회원가입 신청 처리
const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emailEl = document.getElementById('signupEmail');
    const passwordEl = document.getElementById('signupPassword');
    const passwordConfirmEl = document.getElementById('signupPasswordConfirm');
    const nameEl = document.getElementById('signupName');
    const genderEl = document.getElementById('signupGender');
    const birthYearEl = document.getElementById('signupBirthYear');
    const regionEl = document.getElementById('signupRegion');
    const nicknameEl = document.getElementById('signupNickname');
    const authKeyEl = document.getElementById('signupAuthKey');

    const email = emailEl ? emailEl.value : '';
    const password = passwordEl ? passwordEl.value : '';
    const passwordConfirm = passwordConfirmEl ? passwordConfirmEl.value : '';
    const name = nameEl ? nameEl.value : '';
    const gender = genderEl ? genderEl.value : '';
    const birthYear = birthYearEl ? birthYearEl.value : '';
    const region = regionEl ? regionEl.value : '';
    const nickname = nicknameEl ? nicknameEl.value : '';
    const authKey = authKeyEl ? authKeyEl.value : '';

    if (!gender) {
      alert("성별을 선택해 주세요.");
      return;
    }

    if (!birthYear) {
      alert("출생연도를 선택해 주세요.");
      return;
    }

    if (password !== passwordConfirm) {
      alert("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    if (authKey !== SECRET_AUTH_KEY) {
      alert("인증키가 올바르지 않습니다. (인증키: CLUB2026)");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        email: email,
        name: name,
        gender: gender,
        birthYear: birthYear,
        region: region,
        nickname: nickname,
        displayName: `${name}/${birthYear.slice(-2)}/${region}`,
        status: "pending",
        role: "member",
        joinCount: 0,
        cancelCount: 0,
        adminMemo: "",
        themePreference: localStorage.getItem('appTheme') || 'system',
        createdAt: serverTimestamp(),
        approvedAt: null
      });

      alert("가입 신청이 완료되었습니다! 관리자 승인 후 이용 가능합니다.");
      await signOut(auth);
      window.location.href = "login.html";
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        alert("이미 존재하거나 가입 처리 중인 이메일입니다. Firebase 콘솔 [Authentication] - [Users] 탭에서 해당 계정을 직접 [삭제]한 뒤 다시 시도해 주세요.");
      } else {
        alert("가입 실패: " + error.message);
      }
    }
  });
}

// 로그인 처리
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const userDoc = await getDoc(doc(db, "users", userCredential.user.uid));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.status === "pending") {
          alert("아직 관리자 승인 대기 중입니다.");
          await signOut(auth);
          return;
        }
        if (userData.status === "banned") {
          alert("이용이 정지된 계정입니다.");
          await signOut(auth);
          return;
        }

        if (userData.themePreference) {
          localStorage.setItem('appTheme', userData.themePreference);
          applyTheme(userData.themePreference);
        }

        window.location.href = "index.html";
      }
    } catch (error) {
      alert("로그인 실패: 이메일 또는 비밀번호를 확인하세요.");
    }
  });
}

export async function resetUserPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    alert(`${email} 주소로 비밀번호 재설정 이메일을 발송했습니다.`);
  } catch (error) {
    alert("비밀번호 재설정 메일 발송 실패: " + error.message);
  }
}

export function checkAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    const path = window.location.pathname;
    
    if (!user) {
      if (!path.includes("login.html") && !path.includes("signup.html")) {
        window.location.href = "login.html";
      }
    } else {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        
        if (userData.themePreference) {
          localStorage.setItem('appTheme', userData.themePreference);
          applyTheme(userData.themePreference);
          const tSel = document.getElementById('themeSelector');
          if (tSel) tSel.value = userData.themePreference;
        }

        if (callback) callback(userData);
      }
    }
  });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}