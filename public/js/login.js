(() => {
  "use strict";

  const API_LOGIN = "/api/auth/login";
  const THEME_KEY = "alafeen.theme";
  const REMEMBER_KEY = "alafeen.remember.username";

  const $ = (sel, root = document) => root.querySelector(sel);

  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    const toggle = $("#themeToggle");
    if (toggle) {
      const isDark = theme === "dark";
      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.querySelector(".theme-toggle__label").textContent = isDark
        ? "Light"
        : "Dark";
    }
  };

  const initTheme = () => {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = stored || (prefersDark ? "dark" : "light");
    applyTheme(theme);

    const toggle = $("#themeToggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const next =
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark";
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  };

  const form = $("#loginForm");
  const usernameEl = $("#username");
  const passwordEl = $("#password");
  const rememberEl = $("#remember");
  const submitBtn = $("#submitBtn");
  const formMessage = $("#formMessage");
  const togglePasswordBtn = $("#togglePassword");
  const yearEl = $("#year");

  if (!form) return;

  const setFieldError = (name, message) => {
    const el = document.querySelector(`[data-error-for="${name}"]`);
    const input =
      name === "username" ? usernameEl : name === "password" ? passwordEl : null;

    if (el) {
      el.textContent = message || "";
      el.dataset.visible = message ? "true" : "false";
    }
    if (input) {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  };

  const showMessage = (text, tone = "error") => {
    if (!formMessage) return;
    formMessage.textContent = text;
    formMessage.dataset.tone = tone;
    formMessage.hidden = false;
  };

  const hideMessage = () => {
    if (!formMessage) return;
    formMessage.hidden = true;
    formMessage.textContent = "";
    delete formMessage.dataset.tone;
  };

  const clearErrors = () => {
    setFieldError("username", "");
    setFieldError("password", "");
    hideMessage();
  };

  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.dataset.loading = loading ? "true" : "false";
  };

  const validate = () => {
    let ok = true;
    const u = usernameEl.value.trim();
    const p = passwordEl.value;

    if (u.length < 3) {
      setFieldError("username", "اسم المستخدم يجب أن يكون 3 أحرف على الأقل");
      ok = false;
    }
    if (p.length < 6) {
      setFieldError("password", "كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      ok = false;
    }
    return ok;
  };

  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener("click", () => {
      const isPassword = passwordEl.type === "password";
      passwordEl.type = isPassword ? "text" : "password";
      togglePasswordBtn.setAttribute("aria-pressed", String(isPassword));
      togglePasswordBtn.setAttribute(
        "aria-label",
        isPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
      );
      passwordEl.focus();
    });
  }

  const restoreRemembered = () => {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      usernameEl.value = saved;
      rememberEl.checked = true;
      passwordEl.focus();
    } else {
      usernameEl.focus();
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    clearErrors();

    if (!validate()) return;

    const payload = {
      username: usernameEl.value.trim(),
      password: passwordEl.value,
      remember: rememberEl.checked,
    };

    setLoading(true);

    try {
      const res = await fetch(API_LOGIN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }

      if (!res.ok) {
        const msg =
          (data && (data.message || data.error)) ||
          (res.status === 401
            ? "اسم المستخدم أو كلمة المرور غير صحيحة"
            : res.status === 429
            ? "تم تجاوز عدد المحاولات، حاول بعد قليل"
            : "تعذر تسجيل الدخول، حاول مرة أخرى");
        showMessage(msg, "error");
        setLoading(false);
        return;
      }

      if (rememberEl.checked) {
        localStorage.setItem(REMEMBER_KEY, payload.username);
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      showMessage("تم تسجيل الدخول، جارٍ التحويل...", "info");

      const target = (data && data.redirect) || "/dashboard.html";
      window.location.replace(target);
    } catch (err) {
      showMessage("تعذر الاتصال بالخادم، تحقق من الشبكة", "error");
      setLoading(false);
    }
  };

  usernameEl.addEventListener("input", () => setFieldError("username", ""));
  passwordEl.addEventListener("input", () => setFieldError("password", ""));

  form.addEventListener("submit", submit);

  document.addEventListener("DOMContentLoaded", () => {
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
    initTheme();
    restoreRemembered();
  });
})();