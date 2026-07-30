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

/**
 * @param {import('express').Request} _req
 * @param {Express.Multer.File} file
 * @param {multer.FileFilterCallback} cb
 */
function fileFilter(_req, file, cb) {
  const raw = String(file.mimetype || '')
    .trim()
    .toLowerCase();
  const normalized =
    raw === 'image/jpg' || raw === 'image/pjpeg' ? 'image/jpeg' : raw;

  const allowed = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]);

  if (!allowed.has(normalized)) {
    cb(
      new AppError(
        'Only JPEG, PNG, WebP, or PDF files are allowed',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_FILE_TYPE' },
      ),
    );
    return;
  }

  // * Keep multer metadata aligned with what we accept.
  file.mimetype = normalized;
  cb(null, true);
}

const registerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxFileBytes, files: 5 },
}).fields([
  { name: 'instituteLogo', maxCount: 1 },
  { name: 'officerPhoto', maxCount: 1 },
  { name: 'officerIdDocument', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'idDocument', maxCount: 1 },
]);
/** Optional profile photo for institute team invites / updates. */
const teamProfileUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxFileBytes, files: 1 },
}).fields([{ name: 'profilePhoto', maxCount: 1 }]);

/**
 * Relative public path for a stored upload (served under /uploads).
 * @param {Express.Multer.File | undefined} file
 * @returns {string}
 */
function toPublicUploadPath(file) {
  if (!file) {
    return '';
  }

  if (!file.size || Number(file.size) <= 0) {
    return '';
  }

  return `/uploads/${file.filename}`;
}

module.exports = {
  registerUpload,
  teamProfileUpload,
  toPublicUploadPath,
  uploadRoot,
};
