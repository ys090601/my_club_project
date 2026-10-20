import { auth, db } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 인증키 사전 정의 (운영진 지정 인증키)
const SECRET_AUTH_KEY = "CLUB2026"; 

// 회원가입
const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const name = document.getElementById('signupName').value;
    const birthYear = document.getElementById('signupBirthYear').value;
    const region = document.getElementById('signupRegion').value;
    const nickname = document.getElementById('signupNickname').value;
    const authKey = document.getElementById('signupAuthKey').value;

    if (authKey !== SECRET_AUTH_KEY) {
      alert("인증키가 올바르지 않습니다. 관리자에게 문의하세요.");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 사용자 정보 DB 저장
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        email: email,
        name: name,
        birthYear: birthYear,
        region: region,
        nickname: nickname,
        displayName: `${name}/${birthYear.slice(-2)}/${region}`, // "홍길동/95/서울"
        status: "pending", // 승인 대기
        role: "member",
        joinCount: 0,
        cancelCount: 0,
        adminMemo: "",
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

// 로그인
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
        window.location.href = "index.html";
      }
    } catch (error) {
      alert("로그인 실패: 이메일 또는 비밀번호를 확인하세요.");
    }
  });
}

// 페이지 권한 체킹
export function checkAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (!window.location.pathname.includes("login.html")) {
        window.location.href = "login.html";
      }
    } else {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
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