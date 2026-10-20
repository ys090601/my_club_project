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

// 🎨 테마 적용 및 동기화 함수
export function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// 테마 스위치 초기화
const themeSelector = document.getElementById('themeSelector');
if (themeSelector) {
  const savedTheme = localStorage.getItem('appTheme') || 'system';
  themeSelector.value = savedTheme;
  applyTheme(savedTheme);

  themeSelector.addEventListener('change', async (e) => {
    const selectedTheme = e.target.value;
    localStorage.setItem('appTheme', selectedTheme);
    applyTheme(selectedTheme);

    // 로그인된 상태라면 Firestore 유저 설정에도 테마 저장
    if (auth.currentUser) {
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        themePreference: selectedTheme
      });
    }
  });
}

// 회원가입 신청 처리
const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
    const name = document.getElementById('signupName').value;
    const gender = document.getElementById('signupGender').value; // 성별 추가
    const birthYear = document.getElementById('signupBirthYear').value;
    const region = document.getElementById('signupRegion').value;
    const nickname = document.getElementById('signupNickname').value;
    const authKey = document.getElementById('signupAuthKey').value;

    if (password !== passwordConfirm) {
      alert("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    if (authKey !== SECRET_AUTH_KEY) {
      alert("인증키가 올바르지 않습니다. 관리자에게 문의하세요.");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        email: email,
        name: name,
        gender: gender, // DB 저장
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
      alert("가입 실패: " + error.message);
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

        // 로그인 성공 시 유저의 개인 테마 설정 적용
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

// 비밀번호 재설정 이메일
export async function resetUserPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    alert(`${email} 주소로 비밀번호 재설정 이메일을 발송했습니다.`);
  } catch (error) {
    alert("비밀번호 재설정 메일 발송 실패: " + error.message);
  }
}

// 권한 확인 및 유저 테마 동기화
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
        
        // 데이터베이스에 저장된 테마로 전역 적용
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

// 로그아웃
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}