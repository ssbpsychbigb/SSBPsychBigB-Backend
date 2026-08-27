'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { Follow } = require('../feed/follow.model');
const { DayBrief, DayBriefView } = require('./day-brief.model');
const {
  DAY_BRIEF_TTL_MS,
  DAY_BRIEF_LIMITS,
  DAY_BRIEF_MEDIA_TYPES,
} = require('./day-brief.constants');
const { logger } = require('../../common/utils/logger');

function roleHeadline(role) {
  switch (String(role || '')) {
    case 'aspirant':
    case 'user':
      return 'Aspirant';
    case 'educator':
      return 'Educator';
    case 'institute':
    case 'institute_admin':
      return 'Institute';
    case 'defence_officer':
      return 'Defence Officer';
    default:
      return 'Member';
  }
}

function serializeCreator(authorDoc) {
  if (!authorDoc) return null;
  return {
    id: String(authorDoc._id),
    name: authorDoc.fullName || authorDoc.instituteName || 'Member',
    username: authorDoc.username || '',
    headline: roleHeadline(authorDoc.role),
    verified: (authorDoc.verificationLevel ?? 0) >= 2,
    followersLabel: '',
    avatarUrl:
      authorDoc.profilePhotoPath ||
      authorDoc.officerPhotoPath ||
      authorDoc.instituteLogoPath ||
      '',
  };
}

/**
 * @param {object} doc
 * @param {object | null} authorDoc
 * @param {{ viewed?: boolean }} extras
 */
function serializeBrief(doc, authorDoc, extras = {}) {
  const isVideo = doc.mediaType === DAY_BRIEF_MEDIA_TYPES.VIDEO;
  const poster = doc.thumbnailUrl || doc.mediaUrl;
  const caption = String(doc.caption || '').trim();
  return {
    id: String(doc._id),
    title: caption.slice(0, 80) || 'Day Brief',
    caption: caption || 'Shared a Day Brief',
    category: 'motivation',
    durationSec: doc.durationSec || DAY_BRIEF_LIMITS.DEFAULT_IMAGE_DURATION_SEC,
    posterUrl: poster,
    videoUrl: isVideo ? doc.mediaUrl : undefined,
    music: 'Original · Day Brief',
    tags: ['#daybrief'],
    creator: serializeCreator(authorDoc),
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date().toISOString(),
    expiresAt: doc.expiresAt
      ? new Date(doc.expiresAt).toISOString()
      : new Date().toISOString(),
    viewed: Boolean(extras.viewed),
  };
}

function assertValidMediaUrl(url) {
  const value = String(url || '').trim();
  if (
    !value.startsWith('/uploads/day-brief/') &&
    !value.startsWith('/uploads/feed/')
  ) {
    throw new AppError('Invalid media URL', HTTP_STATUS.BAD_REQUEST, {
      code: 'INVALID_MEDIA_URL',
    });
  }
  return value;
}

/**
 * Day Brief service — 24h moments for Home strip.
 */
class DayBriefService {
  async uploadMedia({ file }) {
    if (!file) {
      throw new AppError('Media file is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'MEDIA_REQUIRED',
      });
    }
    const { toDayBriefPublicPath, detectBriefMediaType } = require('./day-brief.upload');
    const mediaType = file.dayBriefMediaType || detectBriefMediaType(file);
    const url = toDayBriefPublicPath(file);
    if (!url) {
      throw new AppError('Upload failed', HTTP_STATUS.BAD_REQUEST, {
        code: 'UPLOAD_FAILED',
      });
    }
    return {
      mediaType,
      url,
      thumbnail: url,
    };
  }

  /**
   * Active briefs from self + people the viewer follows.
   * @param {{ viewerId: string }} input
   */
  async listFeed({ viewerId }) {
    if (!viewerId || !mongoose.Types.ObjectId.isValid(viewerId)) {
      return { items: [] };
    }

    const now = new Date();
    await this.purgeExpired({ soft: true }).catch(() => undefined);

    const follows = await Follow.find({ followerId: viewerId })
      .select('followingId')
      .lean();
    const authorIds = [
      new mongoose.Types.ObjectId(viewerId),
      ...follows.map((row) => row.followingId),
    ];

    const rows = await DayBrief.find({
      authorId: { $in: authorIds },
      expiresAt: { $gt: now },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate(
        'authorId',
        'fullName username role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath instituteName',
      )
      .lean();

    if (!rows.length) {
      return { items: [] };
    }

    const briefIds = rows.map((row) => row._id);
    const views = await DayBriefView.find({
      briefId: { $in: briefIds },
      viewerId: new mongoose.Types.ObjectId(viewerId),
    })
      .select('briefId')
      .lean();
    const viewedSet = new Set(views.map((row) => String(row.briefId)));

    const items = rows.map((row) =>
      serializeBrief(row, row.authorId, {
        viewed: viewedSet.has(String(row._id)),
      }),
    );

    // * Unviewed first, then newest within each group.
    items.sort((a, b) => {
      if (a.viewed !== b.viewed) return a.viewed ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return { items };
  }

  /**
   * @param {{ user: object, caption?: string, mediaUrl: string, mediaType: string, durationSec?: number, thumbnailUrl?: string }} input
   */
  async create({ user, caption, mediaUrl, mediaType, durationSec, thumbnailUrl }) {
    if (!user?._id) {
      throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, {
        code: 'AUTH_REQUIRED',
      });
    }

    const type = String(mediaType || '').trim();
    if (
      type !== DAY_BRIEF_MEDIA_TYPES.IMAGE &&
      type !== DAY_BRIEF_MEDIA_TYPES.VIDEO
    ) {
      throw new AppError('Invalid media type', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_MEDIA_TYPE',
      });
    }

    const url = assertValidMediaUrl(mediaUrl);
    const thumb = thumbnailUrl
      ? assertValidMediaUrl(thumbnailUrl)
      : url;

    const text = String(caption || '')
      .trim()
      .slice(0, DAY_BRIEF_LIMITS.MAX_CAPTION);

    const now = new Date();
    const activeCount = await DayBrief.countDocuments({
      authorId: user._id,
      expiresAt: { $gt: now },
    });
    if (activeCount >= DAY_BRIEF_LIMITS.MAX_ACTIVE_PER_USER) {
      throw new AppError(
        `You can have at most ${DAY_BRIEF_LIMITS.MAX_ACTIVE_PER_USER} live Day Briefs`,
        HTTP_STATUS.BAD_REQUEST,
        { code: 'TOO_MANY_BRIEFS' },
      );
    }

    let seconds = Number(durationSec);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      seconds =
        type === DAY_BRIEF_MEDIA_TYPES.VIDEO
          ? DAY_BRIEF_LIMITS.DEFAULT_VIDEO_DURATION_SEC
          : DAY_BRIEF_LIMITS.DEFAULT_IMAGE_DURATION_SEC;
    }
    seconds = Math.min(
      DAY_BRIEF_LIMITS.MAX_DURATION_SEC,
      Math.max(1, Math.round(seconds)),
    );

    const brief = await DayBrief.create({
      authorId: user._id,
      caption: text,
      mediaType: type,
      mediaUrl: url,
      thumbnailUrl: thumb,
      durationSec: seconds,
      expiresAt: new Date(now.getTime() + DAY_BRIEF_TTL_MS),
    });

    return serializeBrief(brief.toObject(), user, { viewed: false });
  }

  async markViewed({ viewerId, briefId }) {
    if (!mongoose.Types.ObjectId.isValid(briefId)) {
      throw new AppError('Day Brief not found', HTTP_STATUS.NOT_FOUND, {
        code: 'BRIEF_NOT_FOUND',
      });
    }

    const brief = await DayBrief.findOne({
      _id: briefId,
      expiresAt: { $gt: new Date() },
    });
    if (!brief) {
      throw new AppError('Day Brief not found', HTTP_STATUS.NOT_FOUND, {
        code: 'BRIEF_NOT_FOUND',
      });
    }

    await DayBriefView.updateOne(
      {
        briefId: brief._id,
        viewerId: new mongoose.Types.ObjectId(viewerId),
      },
      { $setOnInsert: { viewedAt: new Date() } },
      { upsert: true },
    );

    return { id: String(brief._id), viewed: true };
  }

  async remove({ user, briefId }) {
    if (!mongoose.Types.ObjectId.isValid(briefId)) {
      throw new AppError('Day Brief not found', HTTP_STATUS.NOT_FOUND, {
        code: 'BRIEF_NOT_FOUND',
      });
    }

    const brief = await DayBrief.findById(briefId);
    if (!brief) {
      throw new AppError('Day Brief not found', HTTP_STATUS.NOT_FOUND, {
        code: 'BRIEF_NOT_FOUND',
      });
    }
    if (String(brief.authorId) !== String(user._id)) {
      throw new AppError('You can only delete your own Day Brief', HTTP_STATUS.FORBIDDEN, {
        code: 'FORBIDDEN',
      });
    }

    await DayBriefView.deleteMany({ briefId: brief._id });
    await brief.deleteOne();
    return { id: String(briefId), deleted: true };
  }

  /**
   * @param {{ soft?: boolean }} [options]
   */
  async purgeExpired({ soft = false } = {}) {
    const cutoff = new Date();
    const expired = await DayBrief.find({ expiresAt: { $lte: cutoff } })
      .select('_id')
      .lean();
    if (!expired.length) {
      return { deleted: 0 };
    }
    const ids = expired.map((row) => row._id);
    await DayBriefView.deleteMany({ briefId: { $in: ids } });
    const result = await DayBrief.deleteMany({ _id: { $in: ids } });
    if (!soft && result.deletedCount) {
      logger.info('Purged expired Day Briefs', { deleted: result.deletedCount });
    }
    return { deleted: result.deletedCount || 0 };
  }
}

const dayBriefService = new DayBriefService();

module.exports = { dayBriefService, serializeBrief };
