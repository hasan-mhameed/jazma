// 📄 ui/authUI.js
// واجهة تسجيل الدخول والتسجيل
import { signInWithGoogle, logout, registerWithEmail, signInWithEmail } from "../auth.js";

function getAuthError(code) {
  const errors = {
    "auth/email-already-in-use": "هذا الإيميل مسجّل مسبقاً",
    "auth/invalid-email":        "إيميل غير صحيح",
    "auth/wrong-password":       "كلمة السر غير صحيحة",
    "auth/user-not-found":       "لا يوجد حساب بهذا الإيميل",
    "auth/weak-password":        "كلمة السر ضعيفة جداً",
    "auth/too-many-requests":    "محاولات كثيرة، حاول لاحقاً",
    "auth/invalid-credential":   "الإيميل أو كلمة السر غير صحيحة",
  };
  return errors[code] || "حدث خطأ، حاول مرة ثانية";
}

export function initAuthUI() {
  const authError       = document.getElementById("auth-error");
  const emailLoginBtn   = document.getElementById("email-login-btn");
  const emailRegisterBtn= document.getElementById("email-register-btn");
  const googleSigninBtn = document.getElementById("google-signin-btn");
  const logoutBtn       = document.getElementById("logout-btn");
  const authTabs        = document.querySelectorAll(".auth-tab");

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove("hidden");
  }

  // ── تبويبات تسجيل الدخول ────────────────────────────────────
  authTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      authTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".auth-tab-content").forEach(c => c.classList.add("hidden"));
      document.getElementById(`tab-${tab.dataset.tab}`).classList.remove("hidden");
      authError.classList.add("hidden");
    });
  });

  // ── دخول بإيميل ─────────────────────────────────────────────
  emailLoginBtn?.addEventListener("click", async () => {
    const email    = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    if (!email || !password) return showAuthError("❗ أدخل الإيميل وكلمة السر");
    emailLoginBtn.disabled = true;
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      showAuthError(getAuthError(e.code));
      emailLoginBtn.disabled = false;
    }
  });

  // ── تسجيل حساب جديد ─────────────────────────────────────────
  emailRegisterBtn?.addEventListener("click", async () => {
    const name     = document.getElementById("register-name").value.trim();
    const email    = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    if (!name)                          return showAuthError("❗ أدخل اسمك");
    if (!email)                         return showAuthError("❗ أدخل الإيميل");
    if (password.length < 8)            return showAuthError("❗ كلمة السر 8 أحرف على الأقل");
    if (!/[A-Z]/.test(password))        return showAuthError("❗ يجب أن تحتوي على حرف كبير");
    if (!/[0-9]/.test(password))        return showAuthError("❗ يجب أن تحتوي على رقم");
    if (!/[^A-Za-z0-9]/.test(password)) return showAuthError("❗ يجب أن تحتوي على رمز (!@#$...)");
    emailRegisterBtn.disabled = true;
    try {
      await registerWithEmail(name, email, password);
    } catch (e) {
      showAuthError(getAuthError(e.code));
      emailRegisterBtn.disabled = false;
    }
  });

  // ── مؤشر قوة كلمة السر ──────────────────────────────────────
  document.getElementById("register-password")?.addEventListener("input", (e) => {
    const p = e.target.value;
    let strength = 0;
    if (p.length >= 8)          strength++;
    if (/[A-Z]/.test(p))        strength++;
    if (/[0-9]/.test(p))        strength++;
    if (/[^A-Za-z0-9]/.test(p)) strength++;
    const indicator = document.getElementById("password-strength");
    if (!indicator) return;
    const labels = ["", "ضعيفة 🔴", "متوسطة 🟡", "جيدة 🟠", "قوية 🟢"];
    const colors  = ["", "#f87171",  "#fbbf24",   "#fb923c", "#4ade80"];
    indicator.textContent = p ? labels[strength] : "";
    indicator.style.color = colors[strength];
  });

  // ── Google ───────────────────────────────────────────────────
  googleSigninBtn?.addEventListener("click", async () => {
    try {
      googleSigninBtn.disabled = true;
      googleSigninBtn.textContent = "جاري الدخول...";
      await signInWithGoogle();
    } catch {
      googleSigninBtn.disabled = false;
      googleSigninBtn.innerHTML = `<img src="/jazma/images/google.svg" alt="Google" width="20"/> تسجيل الدخول بـ Google`;
    }
  });

  // ── تسجيل الخروج ────────────────────────────────────────────
  logoutBtn?.addEventListener("click", async () => { await logout(); });
}
