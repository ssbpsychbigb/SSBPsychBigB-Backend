'use strict';

const mongoose = require('mongoose');
const { User } = require('../auth/user.model');
const { Follow } = require('../feed/follow.model');
const { Post } = require('../feed/post.model');
const { POST_STATUS } = require('../feed/feed.constants');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { toPublicUser } = require('../auth/auth.service');
const { feedService } = require('../feed/feed.service');
const { computeCompletion } = require('./profile.completion');
const { getNetworkInsights: computeNetworkInsights, suggestionReason } = require('./profile.network-insights');
const { UserTimeline, TIMELINE_EVENT_TYPES } = require('./timeline.model');
const { UserAchievement, ACHIEVEMENT_CATEGORIES } = require('./achievement.model');

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const PRIVACY_LEVELS = new Set(['public', 'followers', 'only_me']);
const NETWORK_KINDS = new Set(['followers', 'following', 'mutual']);

const EDITABLE_STRING_FIELDS = [
  'fullName',
  'bio',
  'city',
  'education',
  'hobbies',
  'examGoal',
  'preferredService',
  'targetEntry',
  'ssbBoard',
  'preparationStage',
  'preferredBranch',
  'medicalStatus',
  'expectedJoining',
];

const EDITABLE_NUMBER_FIELDS = [
  'attempts',
  'recommendations',
  'conferenceOuts',
];

/**
 * @param {string} value
 */
function slugifyUsername(value) {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `user${Date.now().toString().slice(-6)}`;
}

/**
 * Ensures the user has a unique public username.
 * @param {import('mongoose').Document} user
 */
async function ensureUsername(user) {
  if (user.username && USERNAME_RE.test(user.username)) {
    return user;
  }

  const seed = slugifyUsername(user.fullName || user.email?.split('@')[0] || 'user');
  let candidate = seed;
  let attempt = 0;

  while (attempt < 40) {
    const taken = await User.exists({
      username: candidate,
      _id: { $ne: user._id },
    });
    if (!taken) {
      user.username = candidate;
      await user.save();
      return user;
    }
    attempt += 1;
    candidate = `${seed}${attempt}`.slice(0, 30);
  }

  user.username = `u${String(user._id).slice(-10)}`;
  await user.save();
  return user;
}

/**
 * @param {import('mongoose').Document} user
 * @param {string | null} viewerId
 */
async function buildStats(user, viewerId) {
  const userId = user._id;
  const otherViewer =
    viewerId && String(viewerId) !== String(userId)
      ? new mongoose.Types.ObjectId(viewerId)
      : null;

  const [followers, following, posts, viewerFollow, theyFollowViewer] =
    await Promise.all([
      Follow.countDocuments({ followingId: userId }),
      Follow.countDocuments({ followerId: userId }),
      Post.countDocuments({
        authorId: userId,
        status: POST_STATUS.PUBLISHED,
      }),
      otherViewer
        ? Follow.exists({
            followerId: otherViewer,
            followingId: userId,
          })
        : Promise.resolve(null),
      otherViewer
        ? Follow.exists({
            followerId: userId,
            followingId: otherViewer,
          })
        : Promise.resolve(null),
    ]);

  return {
    followers,
    following,
    posts,
    followingAuthor: Boolean(viewerFollow),
    followsYou: Boolean(theyFollowViewer),
  };
}

/**
 * @param {string} level
 * @param {{ isOwner: boolean, viewerFollows: boolean }} ctx
 */
function canViewSection(level, { isOwner, viewerFollows }) {
  if (isOwner) return true;
  const vis = PRIVACY_LEVELS.has(level) ? level : 'public';
  if (vis === 'public') return true;
  if (vis === 'followers') return viewerFollows;
  return false;
}

function privacyOf(user) {
  return {
    bio: user.privacyBio || 'public',
    about: user.privacyAbout || 'public',
    defence: user.privacyDefence || 'public',
    journey: user.privacyJourney || 'public',
    achievements: user.privacyAchievements || 'public',
  };
}

/**
 * Public portfolio payload (Module 3).
 * @param {import('mongoose').Document} user
 * @param {{ viewerId?: string | null, isOwner?: boolean }} opts
 */
async function toProfileDto(user, { viewerId = null, isOwner = false } = {}) {
  await ensureUsername(user);
  await ensureJoinedEvent(user);
  const publicUser = toPublicUser(user);
  const stats = await buildStats(user, viewerId);
  const privacy = privacyOf(user);
  const viewerFollows = Boolean(stats.followingAuthor) || isOwner;
  const sectionVisible = {
    bio: canViewSection(privacy.bio, { isOwner, viewerFollows }),
    about: canViewSection(privacy.about, { isOwner, viewerFollows }),
    defence: canViewSection(privacy.defence, { isOwner, viewerFollows }),
    journey: canViewSection(privacy.journey, { isOwner, viewerFollows }),
    achievements: canViewSection(privacy.achievements, { isOwner, viewerFollows }),
  };
  const [journeyCount, achievementCount] = await Promise.all([
    UserTimeline.countDocuments({ userId: user._id }),
    UserAchievement.countDocuments({ userId: user._id }),
  ]);
  const completion = computeCompletion(user, { journeyCount, achievementCount });

  const dto = {
    ...publicUser,
    username: user.username,
    bio: sectionVisible.bio ? user.bio || '' : '',
    coverPhotoPath: user.coverPhotoPath || '',
    city: sectionVisible.about ? user.city || '' : '',
    education: sectionVisible.about ? user.education || '' : '',
    languages: sectionVisible.about
      ? Array.isArray(user.languages)
        ? user.languages
        : []
      : [],
    hobbies: sectionVisible.about ? user.hobbies || '' : '',
    preferredService: sectionVisible.defence ? user.preferredService || '' : '',
    targetEntry: sectionVisible.defence ? user.targetEntry || '' : '',
    ssbBoard: sectionVisible.defence ? user.ssbBoard || '' : '',
    preparationStage: sectionVisible.defence ? user.preparationStage || '' : '',
    attempts: sectionVisible.defence ? Number(user.attempts) || 0 : 0,
    recommendations: sectionVisible.defence ? Number(user.recommendations) || 0 : 0,
    conferenceOuts: sectionVisible.defence ? Number(user.conferenceOuts) || 0 : 0,
    preferredBranch: sectionVisible.defence ? user.preferredBranch || '' : '',
    medicalStatus: sectionVisible.defence ? user.medicalStatus || '' : '',
    expectedJoining: sectionVisible.defence ? user.expectedJoining || '' : '',
    attemptDate: sectionVisible.defence ? user.attemptDate || null : null,
    examGoal: sectionVisible.defence ? publicUser.examGoal : undefined,
    examGoals: sectionVisible.defence ? publicUser.examGoals : [],
    stats,
    isOwner,
    profileUrl: `/u/${user.username}`,
    privacy: isOwner ? privacy : undefined,
    sectionVisible,
    completion: isOwner ? completion : { percent: completion.percent, missing: [] },
  };

  return dto;
}

/**
 * Profile domain service — Module 3 Phase A.
 */
class ProfileService {
  async getMe(viewer) {
    const user = await User.findById(viewer._id);
    if (!user) {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    return toProfileDto(user, {
      viewerId: String(viewer._id),
      isOwner: true,
    });
  }

  async getByUsername(username, viewerId = null) {
    const handle = String(username || '')
      .trim()
      .toLowerCase();
    if (!handle) {
      throw new AppError('Username is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'USERNAME_REQUIRED',
      });
    }

    let user = await User.findOne({ username: handle });
    if (!user && mongoose.Types.ObjectId.isValid(handle)) {
      user = await User.findById(handle);
      if (user) {
        await ensureUsername(user);
      }
    }

    if (!user || ['deleted', 'banned', 'suspended'].includes(user.accountStatus)) {
      throw new AppError('Profile not found', HTTP_STATUS.NOT_FOUND, {
        code: 'PROFILE_NOT_FOUND',
      });
    }

    const isOwner = Boolean(viewerId && String(viewerId) === String(user._id));
    return toProfileDto(user, { viewerId, isOwner });
  }

  async updateMe(viewer, body = {}) {
    const user = await User.findById(viewer._id);
    if (!user) {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    await ensureUsername(user);

    if (body.username !== undefined) {
      const next = String(body.username || '')
        .trim()
        .toLowerCase();
      if (!USERNAME_RE.test(next)) {
        throw new AppError(
          'Username must be 3–30 characters (a-z, 0-9, underscore)',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_USERNAME' },
        );
      }
      if (next !== user.username) {
        const taken = await User.exists({
          username: next,
          _id: { $ne: user._id },
        });
        if (taken) {
          throw new AppError('Username is already taken', HTTP_STATUS.CONFLICT, {
            code: 'USERNAME_TAKEN',
          });
        }
        user.username = next;
      }
    }

    for (const field of EDITABLE_STRING_FIELDS) {
      if (body[field] !== undefined) {
        user[field] = String(body[field] ?? '').trim().slice(0, field === 'bio' ? 2000 : 200);
      }
    }

    for (const field of EDITABLE_NUMBER_FIELDS) {
      if (body[field] !== undefined) {
        const n = Number(body[field]);
        user[field] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
      }
    }

    if (body.languages !== undefined) {
      const list = Array.isArray(body.languages)
        ? body.languages
        : String(body.languages || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      user.languages = list.slice(0, 12).map((s) => String(s).slice(0, 40));
    }

    if (body.examGoals !== undefined) {
      const list = Array.isArray(body.examGoals)
        ? body.examGoals
        : String(body.examGoals || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      user.examGoals = list.slice(0, 8);
    }

    if (body.attemptDate !== undefined) {
      if (!body.attemptDate) {
        user.attemptDate = null;
      } else {
        const d = new Date(body.attemptDate);
        user.attemptDate = Number.isNaN(d.getTime()) ? null : d;
      }
    }

    const privacyMap = {
      privacyBio: 'bio',
      privacyAbout: 'about',
      privacyDefence: 'defence',
      privacyJourney: 'journey',
      privacyAchievements: 'achievements',
    };
    if (body.privacy && typeof body.privacy === 'object') {
      for (const [field, key] of Object.entries(privacyMap)) {
        const next = body.privacy[key];
        if (next !== undefined && PRIVACY_LEVELS.has(String(next))) {
          user[field] = String(next);
        }
      }
    }

    await user.save();
    return toProfileDto(user, {
      viewerId: String(viewer._id),
      isOwner: true,
    });
  }

  async updatePhoto(viewer, file) {
    if (!file) {
      throw new AppError('Photo file is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'PHOTO_REQUIRED',
      });
    }
    const user = await User.findById(viewer._id);
    if (!user) {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    const { toPublicUploadPath } = require('./profile.upload');
    user.profilePhotoPath = toPublicUploadPath(file);
    await user.save();
    return toProfileDto(user, {
      viewerId: String(viewer._id),
      isOwner: true,
    });
  }

  async updateBanner(viewer, file) {
    if (!file) {
      throw new AppError('Banner file is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'BANNER_REQUIRED',
      });
    }
    const user = await User.findById(viewer._id);
    if (!user) {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    const { toPublicUploadPath } = require('./profile.upload');
    user.coverPhotoPath = toPublicUploadPath(file);
    await user.save();
    return toProfileDto(user, {
      viewerId: String(viewer._id),
      isOwner: true,
    });
  }

  /**
   * Activity tab — published posts by this profile.
   */
  async getPostsByUsername(username, { viewerId = null, cursor, limit } = {}) {
    const profile = await this.getByUsername(username, viewerId);
    return feedService.getAuthorFeed({
      authorId: profile.id,
      viewerId,
      cursor,
      limit,
    });
  }

  /**
   * Followers / Following / Mutual lists (PROF-009 / PROF-010).
   */
  async listNetwork(username, { kind, viewerId = null, cursor, limit } = {}) {
    const tab = String(kind || 'followers');
    if (!NETWORK_KINDS.has(tab)) {
      throw new AppError('Invalid network tab', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_NETWORK_TAB',
      });
    }

    const handle = String(username || '')
      .trim()
      .toLowerCase();
    let user = await User.findOne({ username: handle });
    if (!user && mongoose.Types.ObjectId.isValid(handle)) {
      user = await User.findById(handle);
    }
    if (!user || ['deleted', 'banned', 'suspended'].includes(user.accountStatus)) {
      throw new AppError('Profile not found', HTTP_STATUS.NOT_FOUND, {
        code: 'PROFILE_NOT_FOUND',
      });
    }

    await ensureUsername(user);

    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const filter = {};
    let idField = 'followerId';

    if (tab === 'followers') {
      filter.followingId = user._id;
      idField = 'followerId';
    } else if (tab === 'following') {
      filter.followerId = user._id;
      idField = 'followingId';
    } else {
      const followingRows = await Follow.find({ followerId: user._id })
        .select('followingId')
        .lean();
      const followingIds = followingRows.map((row) => row.followingId);
      filter.followingId = user._id;
      filter.followerId = { $in: followingIds.length ? followingIds : [user._id] };
      idField = 'followerId';
      if (!followingIds.length) {
        return { items: [], nextCursor: null, hasMore: false, kind: tab };
      }
    }

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Follow.find(filter)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const memberIds = page.map((row) => row[idField]);

    const members = await User.find({
      _id: { $in: memberIds },
      accountStatus: { $nin: ['deleted', 'banned', 'suspended'] },
    }).select(
      'fullName username role examGoal profilePhotoPath officerPhotoPath instituteLogoPath instituteName verificationLevel',
    );

    const memberMap = new Map(members.map((m) => [String(m._id), m]));
    await Promise.all(
      members.map(async (m) => {
        if (!m.username) await ensureUsername(m);
      }),
    );

    let viewerFollowingSet = new Set();
    let viewerFollowerSet = new Set();
    if (viewerId && mongoose.Types.ObjectId.isValid(viewerId)) {
      const viewerOid = new mongoose.Types.ObjectId(viewerId);
      const [iFollow, followMe] = await Promise.all([
        Follow.find({
          followerId: viewerOid,
          followingId: { $in: memberIds },
        })
          .select('followingId')
          .lean(),
        Follow.find({
          followingId: viewerOid,
          followerId: { $in: memberIds },
        })
          .select('followerId')
          .lean(),
      ]);
      viewerFollowingSet = new Set(iFollow.map((r) => String(r.followingId)));
      viewerFollowerSet = new Set(followMe.map((r) => String(r.followerId)));
    }

    const items = [];
    for (const row of page) {
      const member = memberMap.get(String(row[idField]));
      if (!member) continue;
      const id = String(member._id);
      items.push({
        id,
        username: member.username || id,
        fullName: member.fullName || 'Member',
        role: member.role,
        examGoal: member.examGoal || '',
        instituteName: member.instituteName || '',
        verificationLevel: member.verificationLevel ?? 0,
        profilePhotoPath:
          member.profilePhotoPath ||
          member.officerPhotoPath ||
          member.instituteLogoPath ||
          '',
        followingAuthor: viewerFollowingSet.has(id),
        followsYou: viewerFollowerSet.has(id),
        isMutual: viewerFollowingSet.has(id) && viewerFollowerSet.has(id),
        isSelf: Boolean(viewerId && id === String(viewerId)),
      });
    }

    return {
      items,
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
      kind: tab,
    };
  }

  /**
   * My Network hub stats (LinkedIn-style overview).
   */
  async getNetworkOverview(viewer) {
    if (!viewer?._id) {
      return {
        followers: 0,
        following: 0,
        mutual: 0,
        newFollowers7d: 0,
        groups: 0,
        events: 0,
        pages: 0,
      };
    }
    const userId = viewer._id;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const followingRows = await Follow.find({ followerId: userId })
      .select('followingId')
      .lean();
    const followingIds = followingRows.map((row) => row.followingId);
    const [followers, mutual, newFollowers7d] = await Promise.all([
      Follow.countDocuments({ followingId: userId }),
      followingIds.length
        ? Follow.countDocuments({
            followingId: userId,
            followerId: { $in: followingIds },
          })
        : Promise.resolve(0),
      Follow.countDocuments({
        followingId: userId,
        createdAt: { $gte: weekAgo },
      }),
    ]);
    return {
      followers,
      following: followingIds.length,
      mutual,
      newFollowers7d,
      groups: 0,
      events: 0,
      pages: 0,
    };
  }

  /**
   * Owner-only Prep Circle + health metrics (Phase M).
   */
  async getNetworkInsights(viewer) {
    return computeNetworkInsights(viewer);
  }

  /**
   * People you may know — active members not already followed.
   */
  async listSuggestions(viewer, { cursor, limit } = {}) {
    const pageSize = Math.min(Math.max(Number(limit) || 12, 1), 24);
    const viewerId = viewer?._id || null;
    const exclude = [];
    if (viewerId) {
      exclude.push(viewerId);
      const followingRows = await Follow.find({ followerId: viewerId })
        .select('followingId')
        .lean();
      followingRows.forEach((row) => exclude.push(row.followingId));
    }

    const idFilter = {};
    if (exclude.length) idFilter.$nin = exclude;
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      idFilter.$lt = new mongoose.Types.ObjectId(cursor);
    }

    const filter = {
      accountStatus: 'active',
    };
    if (Object.keys(idFilter).length) {
      filter._id = idFilter;
    }

    const rows = await User.aggregate([
      { $match: filter },
      { $sort: { verificationLevel: -1, _id: -1 } },
      { $limit: pageSize + 1 },
      {
        $project: {
          fullName: 1,
          username: 1,
          role: 1,
          examGoal: 1,
          city: 1,
          education: 1,
          instituteName: 1,
          ssbBoard: 1,
          attemptDate: 1,
          verificationLevel: 1,
          profilePhotoPath: 1,
          officerPhotoPath: 1,
          instituteLogoPath: 1,
          coverPhotoPath: 1,
        },
      },
    ]);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;

    for (const row of page) {
      if (!row.username) {
        const user = await User.findById(row._id);
        if (user) {
          await ensureUsername(user);
          row.username = user.username;
        }
      }
    }

    let followsYouSet = new Set();
    if (viewerId && page.length) {
      const ids = page.map((row) => row._id);
      const followMe = await Follow.find({
        followingId: viewerId,
        followerId: { $in: ids },
      })
        .select('followerId')
        .lean();
      followsYouSet = new Set(followMe.map((r) => String(r.followerId)));
    }

    return {
      items: page.map((row) => {
        const id = String(row._id);
        return {
          id,
          username: row.username || id,
          fullName: row.fullName || 'Member',
          role: row.role,
          examGoal: row.examGoal || '',
          city: row.city || '',
          education: row.education || '',
          instituteName: row.instituteName || '',
          verificationLevel: row.verificationLevel ?? 0,
          profilePhotoPath:
            row.profilePhotoPath ||
            row.officerPhotoPath ||
            row.instituteLogoPath ||
            '',
          coverPhotoPath: row.coverPhotoPath || '',
          followingAuthor: false,
          followsYou: followsYouSet.has(id),
          isMutual: false,
          isSelf: false,
          reason: suggestionReason(row, viewer, followsYouSet.has(id)),
        };
      }),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  async #loadUserByUsername(username) {
    const handle = String(username || '')
      .trim()
      .toLowerCase();
    let user = await User.findOne({ username: handle });
    if (!user && mongoose.Types.ObjectId.isValid(handle)) {
      user = await User.findById(handle);
    }
    if (!user || ['deleted', 'banned', 'suspended'].includes(user.accountStatus)) {
      throw new AppError('Profile not found', HTTP_STATUS.NOT_FOUND, {
        code: 'PROFILE_NOT_FOUND',
      });
    }
    await ensureUsername(user);
    return user;
  }

  async #assertSectionVisible(user, section, viewerId) {
    const isOwner = Boolean(viewerId && String(viewerId) === String(user._id));
    if (isOwner) return { user, isOwner: true };
    const stats = await buildStats(user, viewerId);
    const privacy = privacyOf(user);
    const ok = canViewSection(privacy[section], {
      isOwner: false,
      viewerFollows: Boolean(stats.followingAuthor),
    });
    if (!ok) {
      throw new AppError('This section is private', HTTP_STATUS.FORBIDDEN, {
        code: 'SECTION_PRIVATE',
      });
    }
    return { user, isOwner: false };
  }

  async listTimeline(username, viewerId = null) {
    const user = await this.#loadUserByUsername(username);
    await this.#assertSectionVisible(user, 'journey', viewerId);
    await ensureJoinedEvent(user);
    const rows = await UserTimeline.find({ userId: user._id })
      .sort({ eventDate: -1, createdAt: -1 })
      .lean();
    return {
      items: rows.map(serializeTimeline),
    };
  }

  async addTimeline(viewer, body = {}) {
    const title = String(body.title || '').trim();
    if (!title) {
      throw new AppError('Title is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'TITLE_REQUIRED',
      });
    }
    const eventType = TIMELINE_EVENT_TYPES.includes(body.eventType)
      ? body.eventType
      : 'custom';
    const eventDate = body.eventDate ? new Date(body.eventDate) : new Date();
    if (Number.isNaN(eventDate.getTime())) {
      throw new AppError('Invalid date', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_DATE',
      });
    }
    const row = await UserTimeline.create({
      userId: viewer._id,
      eventType,
      title: title.slice(0, 120),
      description: String(body.description || '').trim().slice(0, 500),
      eventDate,
      source: 'manual',
    });
    return serializeTimeline(row);
  }

  async removeTimeline(viewer, eventId) {
    const row = await UserTimeline.findOne({
      _id: eventId,
      userId: viewer._id,
    });
    if (!row) {
      throw new AppError('Timeline event not found', HTTP_STATUS.NOT_FOUND, {
        code: 'TIMELINE_NOT_FOUND',
      });
    }
    if (row.source === 'auto') {
      throw new AppError('Automatic milestones cannot be deleted', HTTP_STATUS.FORBIDDEN, {
        code: 'AUTO_EVENT',
      });
    }
    await row.deleteOne();
    return { deleted: true };
  }

  async listAchievements(username, viewerId = null) {
    const user = await this.#loadUserByUsername(username);
    await this.#assertSectionVisible(user, 'achievements', viewerId);
    const rows = await UserAchievement.find({ userId: user._id })
      .sort({ achievementDate: -1, createdAt: -1 })
      .lean();
    return { items: rows.map(serializeAchievement) };
  }

  async addAchievement(viewer, body = {}) {
    const title = String(body.title || '').trim();
    if (!title) {
      throw new AppError('Title is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'TITLE_REQUIRED',
      });
    }
    const category = ACHIEVEMENT_CATEGORIES.includes(body.category)
      ? body.category
      : 'other';
    let achievementDate = null;
    if (body.achievementDate) {
      const d = new Date(body.achievementDate);
      achievementDate = Number.isNaN(d.getTime()) ? null : d;
    }
    const row = await UserAchievement.create({
      userId: viewer._id,
      title: title.slice(0, 160),
      category,
      description: String(body.description || '').trim().slice(0, 800),
      achievementDate,
      certificateUrl: String(body.certificateUrl || '').trim().slice(0, 500),
    });
    return serializeAchievement(row);
  }

  async removeAchievement(viewer, achievementId) {
    const row = await UserAchievement.findOne({
      _id: achievementId,
      userId: viewer._id,
    });
    if (!row) {
      throw new AppError('Achievement not found', HTTP_STATUS.NOT_FOUND, {
        code: 'ACHIEVEMENT_NOT_FOUND',
      });
    }
    await row.deleteOne();
    return { deleted: true };
  }
}

async function ensureJoinedEvent(user) {
  const exists = await UserTimeline.exists({
    userId: user._id,
    eventType: 'joined_bigb',
  });
  if (exists) return;
  await UserTimeline.create({
    userId: user._id,
    eventType: 'joined_bigb',
    title: 'Joined BIGB',
    description: 'Started the defence preparation journey on BIGB.',
    eventDate: user.createdAt || new Date(),
    source: 'auto',
  });
}

function serializeTimeline(doc) {
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    id: String(json.id || json._id),
    eventType: json.eventType,
    title: json.title,
    description: json.description || '',
    eventDate: json.eventDate,
    source: json.source || 'manual',
  };
}

function serializeAchievement(doc) {
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    id: String(json.id || json._id),
    title: json.title,
    category: json.category,
    description: json.description || '',
    achievementDate: json.achievementDate || null,
    certificateUrl: json.certificateUrl || '',
    verificationStatus: json.verificationStatus || 'none',
  };
}

const profileService = new ProfileService();

module.exports = {
  profileService,
  ensureUsername,
  toProfileDto,
};
