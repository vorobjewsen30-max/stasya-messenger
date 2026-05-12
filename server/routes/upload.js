const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('./auth');
const { generateId, DATA_PATH } = require('../database');

// Хранилище
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subfolder = 'files';
    if (file.mimetype?.startsWith('image/')) subfolder = 'avatars';
    const dir = path.join(DATA_PATH, subfolder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${generateId()}${ext}`);
  }
});

// Загрузка файла
router.post('/', authMiddleware, (req, res) => {
  const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mp3', 'audio/wav', 'audio/ogg', 'application/pdf', 'application/zip', 'text/plain'];
      if (allowed.includes(file.mimetype) || file.mimetype?.startsWith('image/') || file.mimetype?.startsWith('audio/') || file.mimetype?.startsWith('video/')) {
        cb(null, true);
      } else {
        cb(new Error('Неподдерживаемый тип файла'), false);
      }
    }
  }).single('file');

  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const subfolder = req.file.mimetype?.startsWith('image/') ? 'avatars' : 'files';
    const url = `/uploads/${subfolder}/${req.file.filename}`;

    res.json({ filename: req.file.originalname, url, size: req.file.size, mimeType: req.file.mimetype });
  });
});

// Загрузка аватара
router.post('/avatar', authMiddleware, (req, res) => {
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype?.startsWith('image/')) cb(null, true);
      else cb(new Error('Только изображения'), false);
    }
  }).single('avatar');

  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const url = `/uploads/avatars/${req.file.filename}`;
    const { db } = require('../database');
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, req.user.id);

    res.json({ url });
  });
});

module.exports = router;
