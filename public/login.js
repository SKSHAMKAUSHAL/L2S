let mode = 'login';
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const btnSubmit = document.getElementById('btn-submit');
const authError = document.getElementById('auth-error');

function showError(msg) {
  authError.textContent = msg;
  authError.style.display = 'block';
}
function hideError() {
  authError.style.display = 'none';
}

tabLogin?.addEventListener('click', () => {
  mode = 'login';
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  btnSubmit.textContent = 'Sign In';
  authPassword.autocomplete = 'current-password';
  hideError();
});

tabRegister?.addEventListener('click', () => {
  mode = 'register';
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  btnSubmit.textContent = 'Create Account';
  authPassword.autocomplete = 'new-password';
  hideError();
});

authForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) return;

  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Processing...';

  const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Authentication failed');
      btnSubmit.disabled = false;
      btnSubmit.textContent = mode === 'register' ? 'Create Account' : 'Sign In';
      return;
    }

    // Redirect to main application
    window.location.href = '/';
  } catch (err) {
    showError('Network error: ' + err.message);
    btnSubmit.disabled = false;
    btnSubmit.textContent = mode === 'register' ? 'Create Account' : 'Sign In';
  }
});
