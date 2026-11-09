// FRONTEND: ambil data dari API backend lewat fetch()
const API = '/api';
const rp = n => 'Rp' + Number(n).toLocaleString('id-ID');
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let PRODUCTS = [], cart = {}, cat = 'Semua', view = 'shop';
let token = localStorage.getItem('pb_token'), user = null, afterAuth = null, authMode = 'login';
try { cart = JSON.parse(localStorage.getItem('pb_cart') || '{}'); } catch (e) {}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method: opts.method, headers, body: opts.body && JSON.stringify(opts.body) });
  const data = await r.json();
  if (r.status === 401 && token && !path.startsWith('/auth/login')) { logout(true); }
  if (!r.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2000); }
function go(v) { view = v; toggleCart(false); render(); scrollTo(0, 0); }

/* ---------- AKUN ---------- */
function renderAuth() {
  $('auth').innerHTML = user
    ? `<span class="hi">Hai, ${esc(user.name.split(' ')[0])} 🎀</span>
       <button class="ghost" onclick="go('orders')">Pesanan</button>
       <button class="ghost" onclick="logout()">Keluar</button>`
    : `<button class="ghost" onclick="openAuth('login')">Masuk</button>
       <button class="ghost" onclick="openAuth('register')">Daftar</button>`;
}
function setSession(data) {
  token = data.token; user = data.user;
  localStorage.setItem('pb_token', token);
  renderAuth();
}
function logout(silent) {
  token = null; user = null; localStorage.removeItem('pb_token');
  renderAuth();
  if (view === 'orders') render();
  if (!silent) toast('Kamu sudah keluar 👋');
}
function openAuth(mode = 'login', next = null) {
  authMode = mode; afterAuth = next;
  const reg = mode === 'register';
  $('modal').innerHTML = `<button class="x" onclick="closeOv()">✕</button>
  <h2 class="script title">${reg ? 'Buat Akun' : 'Selamat Datang'}</h2>
  <div class="tabs">
    <button class="ghost ${reg ? '' : 'on'}" onclick="openAuth('login',afterAuth)">Masuk</button>
    <button class="ghost ${reg ? 'on' : ''}" onclick="openAuth('register',afterAuth)">Daftar</button>
  </div>
  ${reg ? `<label>Nama lengkap</label><input id="a_name" autocomplete="name" placeholder="Nama penerima">` : ''}
  <label>Email</label><input id="a_email" type="email" autocomplete="email" placeholder="kamu@email.com">
  ${reg ? `<label>No. WhatsApp</label><input id="a_phone" inputmode="tel" autocomplete="tel" placeholder="08xxxxxxxxxx">
  <label>Alamat lengkap</label><textarea id="a_addr" rows="3" autocomplete="street-address" placeholder="Jalan, kota, kode pos"></textarea>` : ''}
  <label>Password</label><input id="a_pass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="${reg ? 'Minimal 6 karakter' : 'Password kamu'}">
  <div class="err" id="a_err"></div>
  <button class="btn" id="a_go" style="width:100%" onclick="submitAuth()">${reg ? 'Daftar 🎀' : 'Masuk 💌'}</button>`;
  $('ov').classList.add('show');
}
async function submitAuth() {
  const reg = authMode === 'register', v = id => ($(id)?.value ?? '');
  $('a_err').textContent = '';
  try {
    const data = reg
      ? await api('/auth/register', { method: 'POST', body: { name: v('a_name'), email: v('a_email'), phone: v('a_phone'), address: v('a_addr'), password: v('a_pass') } })
      : await api('/auth/login', { method: 'POST', body: { email: v('a_email'), password: v('a_pass') } });
    setSession(data);
    closeOv();
    toast(reg ? 'Akun berhasil dibuat 🎀' : 'Berhasil masuk 🎀');
    if (view === 'orders') render();
    const fn = afterAuth; afterAuth = null;
    if (fn) fn();
  } catch (e) { $('a_err').textContent = e.message; }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('#modal input') && $('a_go')) $('a_go').click();
  if (e.key === 'Enter' && e.target.matches('#modal input') && $('co_go')) $('co_go').click();
});

/* ---------- TOKO ---------- */
async function init() {
  if (token) { try { user = (await api('/auth/me')).user; } catch (e) { token = null; localStorage.removeItem('pb_token'); } }
  renderAuth();
  try { PRODUCTS = await api('/products'); }
  catch (e) { $('app').innerHTML = '<div class="empty">Gagal memuat produk. Pastikan backend jalan.</div>'; return; }
  Object.keys(cart).forEach(id => { if (!PRODUCTS.find(p => p.id == id)) delete cart[id]; });
  render(); renderCart();
}
function render() {
  if (view === 'orders') return renderOrders();
  const cats = ['Semua', ...new Set(PRODUCTS.map(p => p.category))];
  const list = PRODUCTS.filter(p => cat === 'Semua' || p.category === cat);
  $('app').innerHTML = `<section class="hero"><div class="script">Koleksi Coquette</div><p>Pita, renda, dan segala hal manis untuk harimu. 🎀</p></section>
  <div class="filters">${cats.map(c => `<button class="ghost ${c === cat ? 'on' : ''}" onclick="cat='${c}';render()">${c}</button>`).join('')}</div>
  <div class="grid">${list.map(p => `<div class="card">${p.tag ? `<span class="tag">${p.tag}</span>` : ''}
    <div class="img" onclick="detail(${p.id})">${p.emoji}</div><h3 onclick="detail(${p.id})">${p.name}</h3>
    <div class="price">${rp(p.price)}</div><button class="btn" style="margin-top:8px" onclick="add(${p.id})">+ Keranjang</button></div>`).join('')}</div>`;
}
function detail(id) {
  const p = PRODUCTS.find(x => x.id == id);
  $('modal').innerHTML = `<button class="x" onclick="closeOv()">✕</button>
  <div class="card" style="box-shadow:none;border:0"><div class="img" style="height:190px;font-size:6rem;cursor:default">${p.emoji}</div></div>
  <h2 class="script title">${p.name}</h2><p>${p.description}</p><p class="price">${rp(p.price)}</p>
  <button class="btn" onclick="add(${p.id});closeOv()">Tambah ke Keranjang</button>`;
  $('ov').classList.add('show');
}
function closeOv() { $('ov').classList.remove('show'); }

function saveCart() { localStorage.setItem('pb_cart', JSON.stringify(cart)); renderCart(); }
function add(id, n = 1) { cart[id] = (cart[id] || 0) + n; if (cart[id] <= 0) delete cart[id]; saveCart(); if (n > 0) toast('Ditambahkan ke keranjang 🎀'); }
function toggleCart(s) { $('drawer').classList.toggle('show', s); }
const cartItems = () => Object.entries(cart).map(([id, q]) => ({ ...PRODUCTS.find(p => p.id == id), q })).filter(i => i.id);
const cartTotal = () => cartItems().reduce((s, i) => s + i.price * i.q, 0);
function renderCart() {
  const it = cartItems();
  $('cnt').textContent = it.reduce((s, i) => s + i.q, 0);
  $('total').textContent = rp(cartTotal());
  $('items').innerHTML = it.length ? it.map(i => `<div class="row"><div class="e">${i.emoji}</div>
    <div class="m"><div>${i.name}</div><div class="price">${rp(i.price)}</div></div>
    <div class="qty"><button onclick="add(${i.id},-1)">−</button> ${i.q} <button onclick="add(${i.id},1)">+</button></div></div>`).join('')
    : '<div class="empty">Keranjangmu masih kosong 🌷</div>';
}

/* ---------- CHECKOUT (butuh login, tanpa isi biodata) ---------- */
const SHIP = { reguler: 15000, express: 30000 };
function openCheckout() {
  if (!cartItems().length) { toast('Keranjang masih kosong'); return; }
  toggleCart(false);
  if (!user) { toast('Masuk atau daftar dulu ya 🌷'); openAuth('login', openCheckout); return; }
  $('modal').innerHTML = `<button class="x" onclick="closeOv()">✕</button><h2 class="script title">Checkout</h2>
  <label>Dikirim ke</label>
  <div class="addr"><b>${esc(user.name)}</b> · ${esc(user.phone)}<br>${esc(user.address)}</div>
  <label>Pengiriman</label><select id="f_s" onchange="updCo()"><option value="reguler">Reguler — Rp15.000</option><option value="express">Express — Rp30.000</option></select>
  <label>Pembayaran</label><select id="f_p"><option>Transfer Bank</option><option>QRIS</option><option>COD</option></select>
  <div class="tot"><span>Subtotal</span><span>${rp(cartTotal())}</span></div>
  <div class="tot"><b>Total</b><b id="co_tot"></b></div>
  <button class="btn" id="co_go" style="width:100%" onclick="placeOrder()">Buat Pesanan 💌</button>`;
  updCo();
  $('ov').classList.add('show');
}
function updCo() { $('co_tot').textContent = rp(cartTotal() + SHIP[$('f_s').value]); }
async function placeOrder() {
  try {
    const o = await api('/orders', { method: 'POST', body: {
      payment: $('f_p').value, shipping: $('f_s').value,
      items: Object.entries(cart).map(([productId, qty]) => ({ productId: +productId, qty }))
    }});
    cart = {}; saveCart();
    $('modal').innerHTML = `<div style="text-align:center"><div style="font-size:4rem">🎀</div>
    <h2 class="script title">Terima kasih!</h2><p>Pesananmu <b>${o.id}</b> berhasil dibuat.<br>Total <b>${rp(o.total)}</b>.</p>
    <button class="btn" onclick="closeOv();go('orders')">Lihat Pesanan</button></div>`;
  } catch (e) { toast(e.message); if (!token) { closeOv(); openAuth('login'); } }
}
async function renderOrders() {
  $('app').innerHTML = `<section class="hero"><div class="script">Pesananku</div></section><div id="ol" class="empty">Memuat…</div>`;
  if (!user) {
    $('ol').innerHTML = `Masuk dulu untuk melihat pesananmu 🌷<br><br><button class="btn" onclick="openAuth('login')">Masuk</button>`;
    return;
  }
  try {
    const list = await api('/orders');
    $('ol').className = '';
    $('ol').innerHTML = list.length ? list.map(o => `<div class="order">
      <div style="display:flex;justify-content:space-between"><b>${o.id}</b><span class="price">${esc(o.status)}</span></div>
      <small>${esc(o.created_at)} · ${esc(o.payment)}</small>
      <div>${o.items.map(i => `${i.emoji} ${esc(i.name)} ×${i.qty}`).join('<br>')}</div>
      <div style="margin-top:6px">Total: <b>${rp(o.total)}</b></div></div>`).join('')
      : '<div class="empty">Belum ada pesanan 🌷</div>';
  } catch (e) { $('ol').textContent = e.message; }
}
init();
