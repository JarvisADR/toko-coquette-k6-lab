// DATABASE: SQLite (file toko.db dibuat otomatis)
const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database(process.env.DB_PATH || __dirname + '/toko.db');
db.pragma('journal_mode = WAL');

// Migrasi: skema lama (customer_id anonim) disimpan sebagai tabel *_legacy
const oc = db.prepare('PRAGMA table_info(orders)').all();
if (oc.length && !oc.some(c => c.name === 'user_id')) {
  db.exec('ALTER TABLE order_items RENAME TO order_items_legacy; ALTER TABLE orders RENAME TO orders_legacy;');
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, category TEXT NOT NULL,
  price INTEGER NOT NULL, emoji TEXT, description TEXT, tag TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
  payment TEXT NOT NULL, shipping INTEGER NOT NULL, total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Menunggu pembayaran',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL, name TEXT NOT NULL,
  emoji TEXT, price INTEGER NOT NULL, qty INTEGER NOT NULL
);
`);

// Kunci rahasia JWT dibuat sekali dan disimpan di database
let row = db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get();
if (!row) {
  row = { value: crypto.randomBytes(32).toString('hex') };
  db.prepare("INSERT INTO settings (key,value) VALUES ('jwt_secret',?)").run(row.value);
}
db.jwtSecret = row.value;

if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
  const ins = db.prepare('INSERT INTO products (name,category,price,emoji,description,tag) VALUES (?,?,?,?,?,?)');
  [
    ['Pita Satin Pink','Aksesoris',35000,'🎀','Jepit rambut pita satin lembut warna pink pastel.','Best Seller'],
    ['Kalung Mutiara Mungil','Aksesoris',89000,'📿','Kalung mutiara imitasi dengan liontin hati kecil, anti karat.',null],
    ['Gaun Lace Putih','Fashion',259000,'👗','Gaun renda bergaya vintage dengan pita di pinggang.','Baru'],
    ['Kaus Kaki Renda','Fashion',42000,'🧦','Kaus kaki berenda halus, cocok dipadukan dengan mary jane.',null],
    ['Tas Selempang Pita','Fashion',179000,'👜','Tas mini krem dengan pita besar dan rantai mutiara.',null],
    ['Lilin Aroma Mawar','Rumah',75000,'🕯️','Lilin soy wax wangi mawar dalam wadah kaca bermotif pita.',null],
    ['Cangkir Teh Bunga','Rumah',98000,'🫖','Cangkir keramik dengan lukisan bunga dan pegangan pita emas.',null],
    ['Boneka Beruang Pita','Rumah',125000,'🧸','Boneka beruang lembut dengan pita satin di leher.','Favorit'],
    ['Buku Jurnal Cherry','Alat Tulis',58000,'📔','Jurnal hardcover motif cherry, 120 halaman kertas krem.',null],
    ['Set Kartu Pos Love','Alat Tulis',29000,'💌','10 kartu pos ilustrasi coquette beserta amplop dan stiker.',null],
    ['Parfum Peony Blush','Kecantikan',149000,'🌸','Eau de parfum aroma peony dan vanila lembut, 30 ml.',null],
    ['Lip Tint Strawberry','Kecantikan',49000,'🍓','Lip tint ringan warna pink segar, tahan seharian.',null]
  ].forEach(r => ins.run(...r));
}
module.exports = db;
