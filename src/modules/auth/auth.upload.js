'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../../config');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');

const uploadRoot = path.resolve(process.cwd(), config.upload.dir);

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, uploadRoot);
  },
  filename(_req, file, cb) {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${safeBase}`);
  },
});

/**
 * @param {import('express').Request} _req
 * @param {Express.Multer.File} file
 * @param {multer.FileFilterCallback} cb
 */
function fileFilter(_req, file, cb) {
  const allowed = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]);

  if (!allowed.has(file.mimetype)) {
    cb(
      new AppError(
        'Only JPEG, PNG, WebP, or PDF files are allowed',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_FILE_TYPE' },
      ),
    );
    return;
  }

  cb(null, true);
}

const registerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxFileBytes, files: 3 },
}).fields([
  { name: 'instituteLogo', maxCount: 1 },
  { name: 'officerPhoto', maxCount: 1 },
  { name: 'officerIdDocument', maxCount: 1 },
]);

/**
 * Relative public path for a stored upload (served under /uploads).
 * @param {Express.Multer.File | undefined} file
 * @returns {string}
 */
function toPublicUploadPath(file) {
  if (!file) {
    return '';
  }

  return `/uploads/${file.filename}`;
}

module.exports = { registerUpload, toPublicUploadPath, uploadRoot };
