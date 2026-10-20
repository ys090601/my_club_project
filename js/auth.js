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

  const birthYearSelect = document.getElementById('signupBirthYear');
  if (birthYearSelect) {
    const currentYear = new Date().getFullYear();
    const minAdultYear = currentYear - 19;
    const minBirthYear = 1989;

    for (let year = minBirthYear; year <= minAdultYear; year++) {
      const option = document.createElement('option');
      option.value = String(year);
      option.innerText = `${year}년생`;
      birthYearSelect.appendChild(option);
    }
  }
});

// 회원가입 신청 처리 (Firestore에서 관리자 인증키 동적 검증)
const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
    const name = document.getElementById('signupName').value;
    const gender = document.getElementById('signupGender').value;
    const birthYear = document.getElementById('signupBirthYear').value;
    const region = document.getElementById('signupRegion').value;
    const nickname = document.getElementById('signupNickname').value;
    const authKey = document.getElementById('signupAuthKey').value;

    if (!gender || !birthYear) {
      alert("성별과 출생연도를 정확히 선택해 주세요.");
      return;
    }

    if (password !== passwordConfirm) {
      alert("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    // Firestore의 system 설정 문서에서 현재 가입 인증키 조회
    let validAuthKey = "CLUB2026"; // 기본값
    try {
      const settingsSnap = await getDoc(doc(db, "settings", "system"));
      if (settingsSnap.exists() && settingsSnap.data().authKey) {
        validAuthKey = settingsSnap.data().authKey;
      }
    } catch (err) {
      console.log("기본 인증키 적용 중...");
    }

    if (authKey !== validAuthKey) {
      alert("가입 인증키가 올바르지 않습니다. 관리자에게 문의하세요.");
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
        clubRole: "멤버", // 기본 권한: 멤버 (운영진/모임장/멤버)
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
        alert("이미 가입되어 있거나 가입 신청 중인 이메일입니다.");
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