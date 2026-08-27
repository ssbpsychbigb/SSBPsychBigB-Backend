'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../../config');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { uploadRoot } = require('../auth/auth.upload');

const resourceUploadDir = path.join(uploadRoot, 'community-resources');

if (!fs.existsSync(resourceUploadDir)) {
  fs.mkdirSync(resourceUploadDir, { recursive: true });
}

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
]);

const MAX_BYTES = Math.max(
  Number(config.upload.maxFileBytes) || 5 * 1024 * 1024,
  15 * 1024 * 1024,
);

function normalizeMime(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function detectResourceKind(mime) {
  if (mime === 'application/pdf') return 'pdf';
  return 'doc';
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, resourceUploadDir);
  },
  filename(_req, file, cb) {
    const safeBase = path
      .basename(file.originalname || 'resource.bin')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const withExt = /\.[a-z0-9]+$/i.test(safeBase)
      ? safeBase
      : `${safeBase}.bin`;
    cb(null, `${unique}-${withExt}`);
  },
});

function resourceFileFilter(_req, file, cb) {
  const normalized = normalizeMime(file.mimetype);
  if (FILE_MIME.has(normalized)) {
    file.mimetype = normalized;
    cb(null, true);
    return;
  }
  cb(
    new AppError(
      'Unsupported file. Use PDF or Office/TXT/CSV documents.',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'INVALID_FILE_TYPE' },
    ),
  );
}

const multerUpload = multer({
  storage,
  fileFilter: resourceFileFilter,
  limits: { fileSize: MAX_BYTES, files: 1 },
}).single('file');

function communityResourceUpload(req, res, next) {
  multerUpload(req, res, (err) => {
    if (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            `File must be under ${Math.round(MAX_BYTES / (1024 * 1024))} MB`,
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

function toResourcePublicPath(file) {
  if (!file || !file.size || Number(file.size) <= 0) return '';
  return `/uploads/community-resources/${file.filename}`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

module.exports = {
  communityResourceUpload,
  toResourcePublicPath,
  detectResourceKind,
  formatBytes,
  MAX_BYTES,
};
