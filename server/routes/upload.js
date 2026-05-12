const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Настройка хранилища
const getStorage = (dataPath) => multer.diskStorage({
  destination: (req, file, cb) => {
    let subfolder = 'files';
    if (file.mimetype?.startsWith('image/')) {
      subfolder = 'avatars';
    }
    const dir = path.join(dataPath, subfolder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

// Загрузка файла
router.post('/', auth, (req, res) => {
  const dataPath = req.app.get('dataPath');
  const upload = multer({
    storage: getStorage(dataPath),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
      const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm',
        'audio/mp3', 'audio/wav', 'audio/ogg',
        'application/pdf', 'application/zip',
        'text/plain', 'application/json',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      if (allowedTypes.includes(file.mimetype) || 
          file.mimetype?.startsWith('image/') ||
          file.mimetype?.startsWith('audio/') ||
          file.mimetype?.startsWith('video/')) {
        cb(null, true);
      } else {
        cb(new Error('Неподдерживаемый тип файла'), false);
      }
    }
  }).single('file');

  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const url = `/uploads/${req.file.filename.includes('avatars') ? 'avatars' : 'files'}/${req.file.filename}`;

    res.json({
      filename: req.file.originalname,
      url,
      size: req.file.size,
      mimeType: req.file.mimetype
    });
  });
});

// Загрузка аватара
router.post('/avatar', auth, (req, res) => {
  const dataPath = req.app.get('dataPath');
  const upload = multer({
    storage: getStorage(dataPath),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (file.mimetype?.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Только изображения'), false);
      }
    }
  }).single('avatar');

  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const url = `/uploads/avatars/${req.file.filename}`;

    // Обновляем аватар пользователя
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, { avatar: url });

    res.json({ url });
  });
});

module.exports = router;
