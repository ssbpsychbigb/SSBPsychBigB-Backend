'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../../config');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { uploadRoot } = require('../auth/auth.upload');

const chatUploadDir = path.join(uploadRoot, 'chat');

if (!fs.existsSync(chatUploadDir)) {
  fs.mkdirSync(chatUploadDir, { recursive: true });
}

const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const FILE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
]);

/** Chat attachments stay lighter than feed video. */
const CHAT_MAX_BYTES = Math.max(
  Number(config.upload.maxFileBytes) || 5 * 1024 * 1024,
  10 * 1024 * 1024,
);

/**
 * @param {string} raw
 */
function normalizeMime(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'image/jpg' || value === 'image/pjpeg') return 'image/jpeg';
  return value;
}

/**
 * @param {string} mime
 */
function detectKind(mime) {
  if (IMAGE_MIME.has(mime)) return 'image';
  return 'file';
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, chatUploadDir);
  },
  filename(_req, file, cb) {
    const safeBase = path
      .basename(file.originalname || 'upload.bin')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const withExt = /\.[a-z0-9]+$/i.test(safeBase)
      ? safeBase
      : `${safeBase}.bin`;
    cb(null, `${unique}-${withExt}`);
  },
});

/**
 * @param {import('express').Request} _req
 * @param {Express.Multer.File} file
 * @param {multer.FileFilterCallback} cb
 */
function chatFileFilter(_req, file, cb) {
  const normalized = normalizeMime(file.mimetype);
  if (IMAGE_MIME.has(normalized) || FILE_MIME.has(normalized)) {
    file.mimetype = normalized;
    cb(null, true);
    return;
  }
  cb(
    new AppError(
      'Unsupported file type. Use images (JPEG/PNG/WebP/GIF) or PDF/Office/TXT/ZIP.',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'INVALID_FILE_TYPE' },
    ),
  );
}

const multerUpload = multer({
  storage,
  fileFilter: chatFileFilter,
  limits: {
    fileSize: CHAT_MAX_BYTES,
    files: 1,
  },
}).single('file');

/**
 * Multer wrapper for a single chat attachment.
 * @type {import('express').RequestHandler}
 */
function chatFileUpload(req, res, next) {
  multerUpload(req, res, (err) => {
    if (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            `File must be under ${Math.round(CHAT_MAX_BYTES / (1024 * 1024))} MB`,
            HTTP_STATUS.BAD_REQUEST,
            { code: 'FILE_TOO_LARGE' },
          ),
        );
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

/**
 * @param {Express.Multer.File} file
 */
function toChatPublicPath(file) {
  if (!file || !file.size || Number(file.size) <= 0) {
    return '';
  }
  return `/uploads/chat/${file.filename}`;
}

/**
 * @param {number} bytes
 */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

module.exports = {
  chatFileUpload,
  toChatPublicPath,
  detectKind,
  formatBytes,
  CHAT_MAX_BYTES,
  IMAGE_MIME,
  FILE_MIME,
};
