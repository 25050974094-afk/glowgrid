import { register } from "./auth-service.js";
import { supabaseEnabled } from "./supabase-service.js";
import { toast } from "./common.js";

document.getElementById("modeBanner").innerHTML = supabaseEnabled
  ? '<b>Supabase aktif</b><span>Akun tersimpan pada Supabase Auth dengan role warga.</span>'
  : '<b>Mode demo lokal</b><span>Akun disimpan pada browser ini untuk pengujian.</span>';

const form = document.getElementById("registerForm"), submit = document.getElementById("submitBtn");
form.addEventListener("submit", async e => {
  e.preventDefault();
  const password = document.getElementById("password").value;
  if (password !== document.getElementById("confirmPassword").value) return toast("Konfirmasi kata sandi belum sama.");
  if (!/(?=.*[A-Za-z])(?=.*\d)/.test(password)) return toast("Kata sandi harus memuat huruf dan angka.");
  submit.disabled = true; submit.textContent = "Membuat akun...";
  try {
    const result = await register({ name: document.getElementById("name").value, email: document.getElementById("email").value, phone: document.getElementById("phone").value, password });
    if (result?.needsConfirmation) location.replace("index.html?confirm=1");
    else location.replace("warga.html?welcome=1");
  } catch (err) { toast(err.message || "Registrasi gagal."); submit.disabled = false; submit.textContent = "Daftar sebagai warga"; }
});
