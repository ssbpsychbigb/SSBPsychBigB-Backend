'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { uploadRoot } = require('../auth/auth.upload');
const { DAY_BRIEF_LIMITS, DAY_BRIEF_MEDIA_TYPES } = require('./day-brief.constants');

const briefUploadDir = path.join(uploadRoot, 'day-brief');

if (!fs.existsSync(briefUploadDir)) {
  fs.mkdirSync(briefUploadDir, { recursive: true });
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, briefUploadDir);
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

function normalizeMime(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'image/jpg' || value === 'image/pjpeg') return 'image/jpeg';
  return value;
}

function dayBriefFileFilter(_req, file, cb) {
  const normalized = normalizeMime(file.mimetype);
  if (IMAGE_MIME.has(normalized) || VIDEO_MIME.has(normalized)) {
    file.mimetype = normalized;
    cb(null, true);
    return;
  }
  cb(
    new AppError(
      'Only JPEG, PNG, WebP images or MP4/WebM/MOV videos are allowed',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'INVALID_FILE_TYPE' },
    ),
  );
}

function detectBriefMediaType(file) {
  const mime = normalizeMime(file.mimetype);
  if (VIDEO_MIME.has(mime)) return DAY_BRIEF_MEDIA_TYPES.VIDEO;
  return DAY_BRIEF_MEDIA_TYPES.IMAGE;
}

function toDayBriefPublicPath(file) {
  if (!file || !file.size || Number(file.size) <= 0) return '';
  return `/uploads/day-brief/${file.filename}`;
}

const multerUpload = multer({
  storage,
  fileFilter: dayBriefFileFilter,
  limits: {
    fileSize: DAY_BRIEF_LIMITS.MAX_VIDEO_BYTES,
    files: 1,
  },
}).single('media');

/**
 * @type {import('express').RequestHandler}
 */
function dayBriefMediaUpload(req, res, next) {
  multerUpload(req, res, (err) => {
    if (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            `File exceeds the ${Math.round(DAY_BRIEF_LIMITS.MAX_VIDEO_BYTES / (1024 * 1024))} MB limit`,
            HTTP_STATUS.BAD_REQUEST,
            { code: 'FILE_TOO_LARGE' },
          ),
        );
        return;
      }
      next(err);
      return;
    }

    try {
      const file = req.file;
      if (!file) {
        throw new AppError('Media file is required', HTTP_STATUS.BAD_REQUEST, {
          code: 'MEDIA_REQUIRED',
        });
      }
      const mediaType = detectBriefMediaType(file);
      const maxBytes =
        mediaType === DAY_BRIEF_MEDIA_TYPES.VIDEO
          ? DAY_BRIEF_LIMITS.MAX_VIDEO_BYTES
          : DAY_BRIEF_LIMITS.MAX_IMAGE_BYTES;
      if (file.size > maxBytes) {
        throw new AppError(
          mediaType === DAY_BRIEF_MEDIA_TYPES.VIDEO
            ? 'Video must be under 40 MB for Day Brief'
            : 'Image must be under 8 MB',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'FILE_TOO_LARGE' },
        );
      }
      file.dayBriefMediaType = mediaType;
      next();
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  dayBriefMediaUpload,
  toDayBriefPublicPath,
  detectBriefMediaType,
  DAY_BRIEF_MEDIA_TYPES,
};
