'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../../config');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { FEED_LIMITS, MEDIA_TYPES } = require('./feed.constants');
const { toPublicUploadPath, uploadRoot } = require('../auth/auth.upload');

const feedUploadDir = path.join(uploadRoot, 'feed');

if (!fs.existsSync(feedUploadDir)) {
  fs.mkdirSync(feedUploadDir, { recursive: true });
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const AUDIO_MIME = new Set([
  'audio/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/x-m4a',
  'audio/mp3',
]);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, feedUploadDir);
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
 * @param {string} raw
 * @returns {string}
 */
function normalizeMime(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'image/jpg' || value === 'image/pjpeg') return 'image/jpeg';
  return value;
}

/**
 * @param {import('express').Request} _req
 * @param {Express.Multer.File} file
 * @param {multer.FileFilterCallback} cb
 */
function feedFileFilter(_req, file, cb) {
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

/**
 * @param {Express.Multer.File} file
 * @returns {'image' | 'video'}
 */
function detectMediaType(file) {
  const mime = normalizeMime(file.mimetype);
  if (VIDEO_MIME.has(mime)) return MEDIA_TYPES.VIDEO;
  if (AUDIO_MIME.has(mime)) return MEDIA_TYPES.AUDIO;
  return MEDIA_TYPES.IMAGE;
}

/**
 * @param {Express.Multer.File[]} files
 */
function assertFeedMediaLimits(files) {
  const list = Array.isArray(files) ? files : [];
  let videos = 0;
  let images = 0;

  for (const file of list) {
    const mediaType = detectMediaType(file);
    if (mediaType === MEDIA_TYPES.VIDEO) {
      videos += 1;
      if (file.size > config.upload.feedVideoMaxBytes) {
        throw new AppError(
          `Video must be under ${Math.round(config.upload.feedVideoMaxBytes / (1024 * 1024))} MB`,
          HTTP_STATUS.BAD_REQUEST,
          { code: 'VIDEO_TOO_LARGE' },
        );
      }
    } else {
      images += 1;
      if (file.size > config.upload.maxFileBytes) {
        throw new AppError(
          `Images must be under ${Math.round(config.upload.maxFileBytes / (1024 * 1024))} MB`,
          HTTP_STATUS.BAD_REQUEST,
          { code: 'IMAGE_TOO_LARGE' },
        );
      }
    }
  }

  if (videos > FEED_LIMITS.MAX_VIDEOS) {
    throw new AppError(
      `You can upload at most ${FEED_LIMITS.MAX_VIDEOS} video per post`,
      HTTP_STATUS.BAD_REQUEST,
      { code: 'TOO_MANY_VIDEOS' },
    );
  }

  if (images > FEED_LIMITS.MAX_IMAGES) {
    throw new AppError(
      `You can upload at most ${FEED_LIMITS.MAX_IMAGES} images`,
      HTTP_STATUS.BAD_REQUEST,
      { code: 'TOO_MANY_IMAGES' },
    );
  }

  if (videos > 0 && images > 0) {
    throw new AppError(
      'Mix of images and video is not supported — upload one video or images only',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'MIXED_MEDIA_NOT_ALLOWED' },
    );
  }
}

const multerUpload = multer({
  storage,
  fileFilter: feedFileFilter,
  limits: {
    fileSize: config.upload.feedVideoMaxBytes,
    files: Math.max(FEED_LIMITS.MAX_IMAGES, FEED_LIMITS.MAX_VIDEOS),
  },
}).array('media', Math.max(FEED_LIMITS.MAX_IMAGES, FEED_LIMITS.MAX_VIDEOS));

/**
 * Multer wrapper that enforces image vs video size / mix rules after upload.
 * @type {import('express').RequestHandler}
 */
function feedMediaUpload(req, res, next) {
  multerUpload(req, res, (err) => {
    if (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            `File exceeds the ${Math.round(config.upload.feedVideoMaxBytes / (1024 * 1024))} MB limit`,
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
      assertFeedMediaLimits(req.files || []);
      next();
    } catch (error) {
      for (const file of req.files || []) {
        if (file.path) {
          fs.unlink(file.path, () => {});
        }
      }
      next(error);
    }
  });
}

/**
 * Comment attachments — images or short voice notes.
 */
const commentMulter = multer({
  storage,
  fileFilter(_req, file, cb) {
    const normalized = normalizeMime(file.mimetype);
    if (IMAGE_MIME.has(normalized) || AUDIO_MIME.has(normalized)) {
      file.mimetype = normalized;
      cb(null, true);
      return;
    }
    cb(
      new AppError(
        'Only JPEG/PNG/WebP images or short voice audio are allowed on comments',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_FILE_TYPE' },
      ),
    );
  },
  limits: {
    fileSize: Math.max(config.upload.maxFileBytes, 5 * 1024 * 1024),
    files: FEED_LIMITS.MAX_COMMENT_IMAGES,
  },
}).array('media', FEED_LIMITS.MAX_COMMENT_IMAGES);

/**
 * @type {import('express').RequestHandler}
 */
function commentMediaUpload(req, res, next) {
  commentMulter(req, res, (err) => {
    if (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            `Comment image must be under ${Math.round(config.upload.maxFileBytes / (1024 * 1024))} MB`,
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
 * @returns {string}
 */
function toFeedPublicPath(file) {
  if (!file || !file.size || Number(file.size) <= 0) {
    return '';
  }
  return `/uploads/feed/${file.filename}`;
}

module.exports = {
  feedMediaUpload,
  commentMediaUpload,
  toFeedPublicPath,
  toPublicUploadPath,
  detectMediaType,
  IMAGE_MIME,
  VIDEO_MIME,
  AUDIO_MIME,
};
