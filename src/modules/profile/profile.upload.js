'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../../config');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');

const uploadRoot = path.resolve(__dirname, '../../..', config.upload.dir);

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, uploadRoot);
  },
  filename(_req, file, cb) {
    const safeBase = path
      .basename(file.originalname || 'upload.bin')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const withExt = /\.[a-z0-9]+$/i.test(safeBase) ? safeBase : `${safeBase}.bin`;
    cb(null, `${unique}-${withExt}`);
  },
});

function imageFilter(_req, file, cb) {
  const raw = String(file.mimetype || '')
    .trim()
    .toLowerCase();
  const normalized =
    raw === 'image/jpg' || raw === 'image/pjpeg' ? 'image/jpeg' : raw;
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(normalized)) {
    cb(
      new AppError(
        'Only JPEG, PNG, or WebP images are allowed',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_FILE_TYPE' },
      ),
    );
    return;
  }
  file.mimetype = normalized;
  cb(null, true);
}

const profilePhotoUpload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: Math.min(config.upload.maxFileBytes, 10 * 1024 * 1024), files: 1 },
}).single('photo');

const profileBannerUpload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: Math.min(config.upload.maxFileBytes, 10 * 1024 * 1024), files: 1 },
}).single('banner');

/**
 * @param {Express.Multer.File | undefined} file
 */
function toPublicUploadPath(file) {
  if (!file || !file.size || Number(file.size) <= 0) {
    return '';
  }
  return `/uploads/${file.filename}`;
}

module.exports = {
  profilePhotoUpload,
  profileBannerUpload,
  toPublicUploadPath,
};
