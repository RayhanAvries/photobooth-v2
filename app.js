const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database('foto-booth.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    orientation TEXT DEFAULT 'portrait',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id INTEGER,
    filename TEXT NOT NULL,
    orientation TEXT DEFAULT 'portrait',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (frame_id) REFERENCES frames(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('language', 'en');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('countdown_seconds', '5');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('mirror_camera', 'true');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('hand_detection', 'true');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_capture_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_retake_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_print_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_capture_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_retake_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_print_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_background_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_background_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('background_music', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('instagram_url', 'https://instagram.com/kidversa');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('website_url', 'https://kidversa.fun');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('booth_orientation', 'landscape');
`);

const tableInfo = db.prepare("PRAGMA table_info(frames)").all();
if (!tableInfo.some(col => col.name === 'orientation')) {
  db.exec("ALTER TABLE frames ADD COLUMN orientation TEXT DEFAULT 'portrait'");
}
if (!tableInfo.some(col => col.name === 'active')) {
  db.exec("ALTER TABLE frames ADD COLUMN active INTEGER DEFAULT 1");
}

const photosInfo = db.prepare("PRAGMA table_info(photos)").all();
if (!photosInfo.some(col => col.name === 'orientation')) {
  db.exec("ALTER TABLE photos ADD COLUMN orientation TEXT DEFAULT 'portrait'");
}

const soundsInfo = db.prepare("PRAGMA table_info(sounds)").all();
if (!soundsInfo.some(col => col.name === 'category')) {
  db.exec("ALTER TABLE sounds ADD COLUMN category TEXT NOT NULL DEFAULT 'general'");
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

['public/frames', 'public/photos', 'public/sounds', 'public/music', 'uploads'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only image and audio files are allowed'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.get('/api/sounds', (req, res) => {
  const sounds = db.prepare('SELECT * FROM sounds ORDER BY category, created_at DESC').all();
  res.json(sounds);
});

app.post('/api/sounds', upload.single('sound'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' });
  const name = req.body.name || 'Untitled';
  const category = req.body.category || 'general';
  const filename = req.file.filename;
  const destPath = path.join('public/sounds', filename);
  fs.renameSync(req.file.path, destPath);
  const info = db.prepare('INSERT INTO sounds (name, filename, category) VALUES (?, ?, ?)').run(name, filename, category);
  res.status(201).json({ id: info.lastInsertRowid, name, filename, category });
});

app.delete('/api/sounds/:id', (req, res) => {
  const sound = db.prepare('SELECT * FROM sounds WHERE id = ?').get(req.params.id);
  if (!sound) return res.status(404).json({ error: 'Sound not found' });
  const filePath = path.join('public/sounds', sound.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM sounds WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/sound-settings', (req, res) => {
  const settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'sound_%'").all();
  const soundSettings = {};
  settings.forEach(s => { soundSettings[s.key] = s.value; });
  res.json(soundSettings);
});

app.post('/api/background-music', upload.single('music'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' });
  const filename = req.file.filename;
  const destPath = path.join('public/music', filename);
  fs.renameSync(req.file.path, destPath);

  const oldRow = db.prepare("SELECT value FROM settings WHERE key = 'background_music'").get();
  if (oldRow && oldRow.value) {
    const oldPath = path.join('public/music', oldRow.value);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('background_music', filename);
  res.json({ success: true, filename });
});

app.delete('/api/background-music', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'background_music'").get();
  if (row && row.value) {
    const filePath = path.join('public/music', row.value);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare("DELETE FROM settings WHERE key = 'background_music'").run();
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'No background music set' });
  }
});

app.get('/api/frames', (req, res) => {
  const frames = db.prepare('SELECT * FROM frames ORDER BY created_at DESC').all();
  res.json(frames);
});

app.post('/api/frames', upload.single('frame'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  const name = req.body.name || 'Untitled';
  const orientation = req.body.orientation || 'landscape';
  const filename = req.file.filename;
  const destPath = path.join('public/frames', filename);
  fs.renameSync(req.file.path, destPath);
  const info = db.prepare('INSERT INTO frames (name, filename, orientation, active) VALUES (?, ?, ?, 1)').run(name, filename, orientation);
  res.status(201).json({ id: info.lastInsertRowid, name, filename, orientation, active: 1 });
});

app.patch('/api/frames/:id/active', (req, res) => {
  const { active } = req.body;
  if (active === undefined) return res.status(400).json({ error: 'active value required' });
  const frame = db.prepare('SELECT * FROM frames WHERE id = ?').get(req.params.id);
  if (!frame) return res.status(404).json({ error: 'Frame not found' });
  db.prepare('UPDATE frames SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ success: true, active });
});

app.delete('/api/frames/:id', (req, res) => {
  const frame = db.prepare('SELECT * FROM frames WHERE id = ?').get(req.params.id);
  if (!frame) return res.status(404).json({ error: 'Frame not found' });
  const filePath = path.join('public/frames', frame.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM frames WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/photos', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  const { frame_id, orientation } = req.body;
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const filename = uuidv4() + ext;
  const destPath = path.join('public/photos', filename);
  fs.renameSync(req.file.path, destPath);
  const info = db.prepare('INSERT INTO photos (frame_id, filename, orientation) VALUES (?, ?, ?)')
    .run(frame_id || null, filename, orientation || 'landscape');
  res.json({ id: info.lastInsertRowid, filename, url: `/photos/${filename}` });
});

app.get('/api/photos', (req, res) => {
  const { date } = req.query;
  let photos;
  if (date) {
    photos = db.prepare(`
      SELECT photos.*, frames.name as frame_name 
      FROM photos 
      LEFT JOIN frames ON photos.frame_id = frames.id 
      WHERE DATE(photos.created_at) = ? 
      ORDER BY photos.created_at DESC
    `).all(date);
  } else {
    photos = db.prepare(`
      SELECT photos.*, frames.name as frame_name 
      FROM photos 
      LEFT JOIN frames ON photos.frame_id = frames.id 
      ORDER BY photos.created_at DESC
    `).all();
  }
  res.json(photos);
});

app.get('/api/photo/:filename', (req, res) => {
  const filename = req.params.filename;
  const photo = db.prepare('SELECT * FROM photos WHERE filename = ?').get(filename);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  res.json(photo);
});

app.delete('/api/photos/:id', (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const filePath = path.join('public/photos', photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/photos/date/:date', (req, res) => {
  const photos = db.prepare('SELECT * FROM photos WHERE DATE(created_at) = ?').all(req.params.date);
  photos.forEach(photo => {
    const filePath = path.join('public/photos', photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  db.prepare('DELETE FROM photos WHERE DATE(created_at) = ?').run(req.params.date);
  res.json({ success: true, deleted: photos.length });
});

app.get('/api/photos/dates', (req, res) => {
  const dates = db.prepare(`
    SELECT DISTINCT DATE(created_at) as date, COUNT(*) as count 
    FROM photos 
    GROUP BY DATE(created_at) 
    ORDER BY date DESC
  `).all();
  res.json(dates);
});

app.get('/download/:filename', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public', 'photos', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  res.download(filePath, `Kidversa_Studio_${filename}`);
});

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(row => { settings[row.key] = row.value; });
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/booth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'booth.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10MB)' });
    return res.status(400).json({ error: err.message });
  }
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));