// BACKEND: Express REST API + autentikasi (JWT) + melayani folder frontend
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET || db.jwtSecret;
const SHIPPING = { reguler: 15000, express: 30000 };
const PAYMENTS = ['Transfer Bank', 'QRIS', 'COD'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = u => jwt.sign({ uid: u.id }, SECRET, { expiresIn: '7d' });
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, address: u.address });

// Middleware: wajib login
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    const { uid } = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!u) throw new Error('no user');
    req.user = u;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Silakan masuk dulu' });
  }
}

/* ---------- AUTH ---------- */
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone, address } = req.body || {};
  if (!name?.trim() || !phone?.trim() || !address?.trim())
    return res.status(400).json({ error: 'Nama, nomor HP, dan alamat wajib diisi' });
  if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Format email tidak valid' });
  if (typeof password !== 'string' || password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter' });

  const mail = email.trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(mail))
    return res.status(409).json({ error: 'Email sudah terdaftar, silakan masuk' });

  const info = db.prepare('INSERT INTO users (name,email,password_hash,phone,address) VALUES (?,?,?,?,?)')
    .run(name.trim(), mail, bcrypt.hashSync(password, 10), phone.trim(), address.trim());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Email atau password salah' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* ---------- PRODUK ---------- */
app.get('/api/products', (req, res) => {
  const { category } = req.query;
  const rows = category
    ? db.prepare('SELECT * FROM products WHERE category = ? ORDER BY id').all(category)
    : db.prepare('SELECT * FROM products ORDER BY id').all();
  res.json(rows);
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Produk tidak ditemukan' });
});

/* ---------- PESANAN (wajib login) ---------- */
// Data penerima diambil dari akun; harga dihitung ulang di server
app.post('/api/orders', auth, (req, res) => {
  const { payment, shipping, items } = req.body || {};
  if (!PAYMENTS.includes(payment) || !(shipping in SHIPPING))
    return res.status(400).json({ error: 'Metode pembayaran/pengiriman tidak valid' });
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Keranjang kosong' });

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const p = getProduct.get(it.productId);
    const qty = Math.floor(Number(it.qty));
    if (!p || !(qty > 0 && qty <= 99)) return res.status(400).json({ error: 'Item tidak valid' });
    lines.push({ p, qty });
    subtotal += p.price * qty;
  }
  const u = req.user;
  const orderId = 'PB' + Date.now().toString(36).toUpperCase();
  const total = subtotal + SHIPPING[shipping];

  db.transaction(() => {
    db.prepare(`INSERT INTO orders (id,user_id,name,phone,address,payment,shipping,total)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(orderId, u.id, u.name, u.phone, u.address, payment, SHIPPING[shipping], total);
    const insItem = db.prepare(`INSERT INTO order_items (order_id,product_id,name,emoji,price,qty)
                                VALUES (?,?,?,?,?,?)`);
    lines.forEach(({ p, qty }) => insItem.run(orderId, p.id, p.name, p.emoji, p.price, qty));
  })();

  res.status(201).json({ id: orderId, total, status: 'Menunggu pembayaran' });
});

app.get('/api/orders', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(req.user.id);
  const itemsOf = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json(orders.map(o => ({ ...o, items: itemsOf.all(o.id) })));
});

/* ---------- FRONTEND ---------- */
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Toko Coquette jalan di http://localhost:${PORT}`));
