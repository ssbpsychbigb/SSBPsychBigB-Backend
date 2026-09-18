'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const {
  Community,
  CommunityMembership,
  COMMUNITY_VISIBILITY,
  COMMUNITY_STATUS,
  MEMBERSHIP_ROLES,
} = require('./community.model');
const { canCreateCommunity, slugifyName } = require('./community.constants');
const { POST_STATUS, POST_TYPES, POST_VISIBILITY } = require('../feed/feed.constants');
const { Post } = require('../feed/post.model');
const { User } = require('../auth/user.model');
const { CommunityResource } = require('./community-resource.model');
const { CommunityEvent, CommunityEventRsvp } = require('./community-event.model');
const {
  buildContributorReputation,
} = require('./community-reputation');
const { Comment } = require('../feed/comment.model');

function newInviteToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * @param {object} community
 * @param {{ isMember?: boolean, membershipRole?: string | null, includeInvite?: boolean }} [viewer]
 */
function serializeCommunity(community, viewer = {}) {
  const doc =
    typeof community.toObject === 'function' ? community.toObject() : community;
  const canModerate =
    viewer.membershipRole === MEMBERSHIP_ROLES.OWNER ||
    viewer.membershipRole === MEMBERSHIP_ROLES.MODERATOR;
  const payload = {
    id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    description: doc.description || '',
    coverPhotoPath: doc.coverPhotoPath || '',
    avatarPath: doc.avatarPath || '',
    examGoals: doc.examGoals || [],
    visibility: doc.visibility,
    ownerId: String(doc.ownerId),
    ownerRole: doc.ownerRole || '',
    memberCount: doc.memberCount || 0,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    isMember: Boolean(viewer.isMember),
    membershipRole: viewer.membershipRole || null,
    canModerate,
  };
  if (viewer.includeInvite && canModerate && doc.inviteToken) {
    payload.inviteToken = doc.inviteToken;
  }
  return payload;
}

function serializeMember(row, user, reputation = null) {
  const mutedUntil = row.mutedUntil ? new Date(row.mutedUntil) : null;
  const isMuted = Boolean(mutedUntil && mutedUntil.getTime() > Date.now());
  return {
    userId: String(row.userId),
    role: row.role,
    joinedAt: row.joinedAt,
    mutedUntil: isMuted ? mutedUntil.toISOString() : null,
    isMuted,
    user: {
      id: String(user._id),
      fullName: user.fullName || '',
      username: user.username || '',
      role: user.role || '',
      preparationStage: user.preparationStage || '',
      examGoal: user.examGoal || '',
      profilePhotoPath: user.profilePhotoPath || '',
      verificationLevel: user.verificationLevel ?? 0,
    },
    reputation:
      reputation ||
      buildContributorReputation({
        role: row.role,
      }),
  };
}

/**
 * Ensure slug unique; append short suffix if needed.
 * @param {string} base
 */
async function allocateSlug(base) {
  let slug = slugifyName(base) || `community-${Date.now().toString(36)}`;
  let attempt = 0;
  while (attempt < 12) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt + 1}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Community.exists({ slug: candidate });
    if (!exists) return candidate;
    attempt += 1;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

class CommunityService {
  /**
   * Discover public active communities.
   */
  async listCommunities({ q, examGoal, cursor, limit = 20, viewerId = null }) {
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const filter = {
      status: COMMUNITY_STATUS.ACTIVE,
      visibility: COMMUNITY_VISIBILITY.PUBLIC,
    };
    if (examGoal) {
      filter.examGoals = String(examGoal).trim().toLowerCase();
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
        { slug: { $regex: term, $options: 'i' } },
      ];
    }
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Community.find(filter)
      .sort({ memberCount: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const membershipMap = await this.#membershipMap(
      viewerId,
      page.map((row) => row._id),
    );

    return {
      items: page.map((row) => {
        const mem = membershipMap.get(String(row._id));
        return serializeCommunity(row, {
          isMember: Boolean(mem),
          membershipRole: mem?.role || null,
        });
      }),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  /**
   * Communities the viewer has joined.
   */
  async listMine({ userId, limit = 40 }) {
    const pageSize = Math.min(Math.max(Number(limit) || 40, 1), 80);
    const memberships = await CommunityMembership.find({ userId })
      .sort({ joinedAt: -1 })
      .limit(pageSize)
      .lean();

    if (!memberships.length) {
      return { items: [] };
    }

    const ids = memberships.map((m) => m.communityId);
    const communities = await Community.find({
      _id: { $in: ids },
      status: COMMUNITY_STATUS.ACTIVE,
    }).lean();
    const byId = new Map(communities.map((c) => [String(c._id), c]));
    const roleById = new Map(
      memberships.map((m) => [String(m.communityId), m.role]),
    );

    const items = memberships
      .map((m) => {
        const community = byId.get(String(m.communityId));
        if (!community) return null;
        const role = roleById.get(String(m.communityId)) || null;
        return serializeCommunity(community, {
          isMember: true,
          membershipRole: role,
          includeInvite:
            role === MEMBERSHIP_ROLES.OWNER ||
            role === MEMBERSHIP_ROLES.MODERATOR,
        });
      })
      .filter(Boolean);

    return { items };
  }

  /**
   * Create community + owner membership.
   */
  async createCommunity({ author, body }) {
    if (!canCreateCommunity(author.role)) {
      throw new AppError(
        'Your role cannot create communities',
        HTTP_STATUS.FORBIDDEN,
        { code: 'COMMUNITY_CREATE_FORBIDDEN' },
      );
    }

    const name = String(body.name || '').trim();
    if (name.length < 3) {
      throw new AppError('Community name must be at least 3 characters', HTTP_STATUS.BAD_REQUEST, {
        code: 'NAME_TOO_SHORT',
      });
    }
    if (name.length > 80) {
      throw new AppError('Community name is too long', HTTP_STATUS.BAD_REQUEST, {
        code: 'NAME_TOO_LONG',
      });
    }

    const description = String(body.description || '').trim().slice(0, 2000);
    const visibility = Object.values(COMMUNITY_VISIBILITY).includes(body.visibility)
      ? body.visibility
      : COMMUNITY_VISIBILITY.PUBLIC;
    const examGoals = Array.isArray(body.examGoals)
      ? [...new Set(body.examGoals.map((g) => String(g).trim().toLowerCase()).filter(Boolean))]
      : [];

    const requestedSlug = body.slug ? slugifyName(body.slug) : '';
    const slug = await allocateSlug(requestedSlug || name);

    const community = await Community.create({
      name,
      slug,
      description,
      examGoals,
      visibility,
      ownerId: author._id,
      ownerRole: author.role,
      memberCount: 1,
      inviteToken: newInviteToken(),
      status: COMMUNITY_STATUS.ACTIVE,
      coverPhotoPath: String(body.coverPhotoPath || '').trim(),
      avatarPath: String(body.avatarPath || '').trim(),
    });

    await CommunityMembership.create({
      communityId: community._id,
      userId: author._id,
      role: MEMBERSHIP_ROLES.OWNER,
      joinedAt: new Date(),
    });

    return serializeCommunity(community, {
      isMember: true,
      membershipRole: MEMBERSHIP_ROLES.OWNER,
      includeInvite: true,
    });
  }

  /**
   * Public detail by slug. Private communities need membership or a valid invite token.
   */
  async getBySlug({ slug, viewerId = null, inviteToken = null }) {
    const community = await Community.findOne({
      slug: String(slug || '').toLowerCase().trim(),
      status: COMMUNITY_STATUS.ACTIVE,
    }).lean();

    if (!community) {
      throw new AppError('Community not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMUNITY_NOT_FOUND',
      });
    }

    const mem = viewerId
      ? await CommunityMembership.findOne({
          communityId: community._id,
          userId: viewerId,
        }).lean()
      : null;

    const inviteOk =
      inviteToken &&
      community.inviteToken &&
      String(inviteToken) === String(community.inviteToken);

    if (
      community.visibility === COMMUNITY_VISIBILITY.PRIVATE &&
      !mem &&
      !inviteOk
    ) {
      throw new AppError('This community is private', HTTP_STATUS.FORBIDDEN, {
        code: 'COMMUNITY_PRIVATE',
      });
    }

    return serializeCommunity(community, {
      isMember: Boolean(mem),
      membershipRole: mem?.role || null,
      includeInvite:
        mem?.role === MEMBERSHIP_ROLES.OWNER ||
        mem?.role === MEMBERSHIP_ROLES.MODERATOR,
    });
  }

  async join({ slug, user, inviteToken = null }) {
    const community = await this.#requireActiveBySlug(slug);

    if (community.visibility === COMMUNITY_VISIBILITY.PRIVATE) {
      const tokenOk =
        inviteToken &&
        community.inviteToken &&
        String(inviteToken) === String(community.inviteToken);
      if (!tokenOk) {
        throw new AppError(
          'A valid invite link is required to join this private community',
          HTTP_STATUS.FORBIDDEN,
          { code: 'INVITE_REQUIRED' },
        );
      }
    }

    const existing = await CommunityMembership.findOne({
      communityId: community._id,
      userId: user._id,
    });
    if (existing) {
      return serializeCommunity(community, {
        isMember: true,
        membershipRole: existing.role,
        includeInvite:
          existing.role === MEMBERSHIP_ROLES.OWNER ||
          existing.role === MEMBERSHIP_ROLES.MODERATOR,
      });
    }

    await CommunityMembership.create({
      communityId: community._id,
      userId: user._id,
      role: MEMBERSHIP_ROLES.MEMBER,
      joinedAt: new Date(),
    });
    await Community.updateOne(
      { _id: community._id },
      { $inc: { memberCount: 1 } },
    );

    const fresh = await Community.findById(community._id).lean();
    return serializeCommunity(fresh, {
      isMember: true,
      membershipRole: MEMBERSHIP_ROLES.MEMBER,
    });
  }

  async leave({ slug, user }) {
    const community = await this.#requireActiveBySlug(slug);
    const membership = await CommunityMembership.findOne({
      communityId: community._id,
      userId: user._id,
    });

    if (!membership) {
      return serializeCommunity(community, {
        isMember: false,
        membershipRole: null,
      });
    }

    if (membership.role === MEMBERSHIP_ROLES.OWNER) {
      throw new AppError(
        'Owners cannot leave their community in MVP. Archive or transfer later.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'OWNER_CANNOT_LEAVE' },
      );
    }

    await CommunityMembership.deleteOne({ _id: membership._id });
    await Community.updateOne(
      { _id: community._id, memberCount: { $gt: 0 } },
      { $inc: { memberCount: -1 } },
    );

    const fresh = await Community.findById(community._id).lean();
    return serializeCommunity(fresh, {
      isMember: false,
      membershipRole: null,
    });
  }

  /**
   * Member directory (COMM-D01).
   */
  async listMembers({ slug, viewerId = null, cursor, limit = 30 }) {
    const community = await this.#requireActiveBySlug(slug);
    const isMember = await this.#isMember(community._id, viewerId);

    if (community.visibility === COMMUNITY_VISIBILITY.PRIVATE && !isMember) {
      throw new AppError('Join this community to view members', HTTP_STATUS.FORBIDDEN, {
        code: 'COMMUNITY_PRIVATE',
      });
    }

    const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 80);
    const filter = { communityId: community._id };
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await CommunityMembership.find(filter)
      .sort({ joinedAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const userIds = page.map((row) => row.userId);
    const users = await User.find({ _id: { $in: userIds } })
      .select(
        'fullName username role preparationStage examGoal profilePhotoPath verificationLevel',
      )
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const reputationMap = await this.#reputationMap(community._id, userIds);

    const roleRank = {
      [MEMBERSHIP_ROLES.OWNER]: 0,
      [MEMBERSHIP_ROLES.MODERATOR]: 1,
      [MEMBERSHIP_ROLES.MEMBER]: 2,
    };
    const items = page
      .map((row) => {
        const user = byId.get(String(row.userId));
        if (!user) return null;
        const counts = reputationMap.get(String(row.userId)) || {
          posts: 0,
          acceptedAnswers: 0,
          resources: 0,
          rsvpsGoing: 0,
        };
        return serializeMember(
          row,
          user,
          buildContributorReputation({ ...counts, role: row.role }),
        );
      })
      .filter(Boolean)
      .sort((a, b) => (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9));

    return {
      items,
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  /**
   * Ensure invite token exists; rotate if requested (COMM-D02).
   */
  async getOrRotateInvite({ slug, actor, rotate = false }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#requireModerator(community._id, actor._id);

    let token = community.inviteToken;
    if (!token || rotate) {
      token = newInviteToken();
      await Community.updateOne({ _id: community._id }, { $set: { inviteToken: token } });
    }

    return {
      inviteToken: token,
      path: `/c/${community.slug}?invite=${token}`,
      visibility: community.visibility,
    };
  }

  /**
   * Owner/mod soft-remove a community post (COMM-D03).
   */
  async removePost({ slug, actor, postId }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#requireModerator(community._id, actor._id);

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId);
    if (
      !post ||
      post.status === POST_STATUS.DELETED ||
      !post.communityId ||
      String(post.communityId) !== String(community._id)
    ) {
      throw new AppError('Post not found in this community', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    post.status = POST_STATUS.DELETED;
    post.deletedAt = new Date();
    post.communityPinnedAt = null;
    await post.save();

    return {
      id: String(post._id),
      status: post.status,
      deletedAt: post.deletedAt,
    };
  }

  /**
   * Kick a member (COMM-D04).
   */
  async kickMember({ slug, actor, userId }) {
    const community = await this.#requireActiveBySlug(slug);
    const actorMem = await this.#requireModerator(community._id, actor._id);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError('Member not found', HTTP_STATUS.NOT_FOUND, {
        code: 'MEMBER_NOT_FOUND',
      });
    }
    if (String(userId) === String(actor._id)) {
      throw new AppError('You cannot kick yourself', HTTP_STATUS.BAD_REQUEST, {
        code: 'CANNOT_KICK_SELF',
      });
    }

    const target = await CommunityMembership.findOne({
      communityId: community._id,
      userId,
    });
    if (!target) {
      throw new AppError('Member not found', HTTP_STATUS.NOT_FOUND, {
        code: 'MEMBER_NOT_FOUND',
      });
    }
    if (target.role === MEMBERSHIP_ROLES.OWNER) {
      throw new AppError('Cannot kick the community owner', HTTP_STATUS.FORBIDDEN, {
        code: 'CANNOT_KICK_OWNER',
      });
    }
    if (
      actorMem.role === MEMBERSHIP_ROLES.MODERATOR &&
      target.role !== MEMBERSHIP_ROLES.MEMBER
    ) {
      throw new AppError('Moderators can only kick regular members', HTTP_STATUS.FORBIDDEN, {
        code: 'CANNOT_KICK_MOD',
      });
    }

    await CommunityMembership.deleteOne({ _id: target._id });
    await Community.updateOne(
      { _id: community._id, memberCount: { $gt: 0 } },
      { $inc: { memberCount: -1 } },
    );

    return { userId: String(userId), removed: true };
  }

  /**
   * Mute / unmute a member (COMM-D04).
   */
  async muteMember({ slug, actor, userId, mutedUntil }) {
    const community = await this.#requireActiveBySlug(slug);
    const actorMem = await this.#requireModerator(community._id, actor._id);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError('Member not found', HTTP_STATUS.NOT_FOUND, {
        code: 'MEMBER_NOT_FOUND',
      });
    }
    if (String(userId) === String(actor._id)) {
      throw new AppError('You cannot mute yourself', HTTP_STATUS.BAD_REQUEST, {
        code: 'CANNOT_MUTE_SELF',
      });
    }

    const target = await CommunityMembership.findOne({
      communityId: community._id,
      userId,
    });
    if (!target) {
      throw new AppError('Member not found', HTTP_STATUS.NOT_FOUND, {
        code: 'MEMBER_NOT_FOUND',
      });
    }
    if (target.role === MEMBERSHIP_ROLES.OWNER) {
      throw new AppError('Cannot mute the community owner', HTTP_STATUS.FORBIDDEN, {
        code: 'CANNOT_MUTE_OWNER',
      });
    }
    if (
      actorMem.role === MEMBERSHIP_ROLES.MODERATOR &&
      target.role !== MEMBERSHIP_ROLES.MEMBER
    ) {
      throw new AppError('Moderators can only mute regular members', HTTP_STATUS.FORBIDDEN, {
        code: 'CANNOT_MUTE_MOD',
      });
    }

    let until = null;
    if (mutedUntil) {
      until = new Date(mutedUntil);
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
        throw new AppError('mutedUntil must be a future date', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_MUTE',
        });
      }
    }

    target.mutedUntil = until;
    await target.save();

    const user = await User.findById(userId)
      .select(
        'fullName username role preparationStage examGoal profilePhotoPath verificationLevel',
      )
      .lean();
    return serializeMember(target.toObject(), user);
  }

  /**
   * Promote / demote moderator (COMM-D05) — owner only.
   */
  async setMemberRole({ slug, actor, userId, role }) {
    const community = await this.#requireActiveBySlug(slug);
    const actorMem = await CommunityMembership.findOne({
      communityId: community._id,
      userId: actor._id,
    }).lean();

    if (!actorMem || actorMem.role !== MEMBERSHIP_ROLES.OWNER) {
      throw new AppError('Only the owner can change moderator roles', HTTP_STATUS.FORBIDDEN, {
        code: 'OWNER_ONLY',
      });
    }

    if (role !== MEMBERSHIP_ROLES.MODERATOR && role !== MEMBERSHIP_ROLES.MEMBER) {
      throw new AppError('Role must be moderator or member', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_ROLE',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError('Member not found', HTTP_STATUS.NOT_FOUND, {
        code: 'MEMBER_NOT_FOUND',
      });
    }
    if (String(userId) === String(actor._id)) {
      throw new AppError('Cannot change your own owner role', HTTP_STATUS.BAD_REQUEST, {
        code: 'CANNOT_CHANGE_OWNER',
      });
    }

    const target = await CommunityMembership.findOne({
      communityId: community._id,
      userId,
    });
    if (!target) {
      throw new AppError('Member not found', HTTP_STATUS.NOT_FOUND, {
        code: 'MEMBER_NOT_FOUND',
      });
    }
    if (target.role === MEMBERSHIP_ROLES.OWNER) {
      throw new AppError('Cannot change the owner role', HTTP_STATUS.FORBIDDEN, {
        code: 'CANNOT_CHANGE_OWNER',
      });
    }

    target.role = role;
    await target.save();

    const user = await User.findById(userId)
      .select(
        'fullName username role preparationStage examGoal profilePhotoPath verificationLevel',
      )
      .lean();
    return serializeMember(target.toObject(), user);
  }

  /**
   * Pin / unpin a post in the community feed (COMM-D06).
   */
  async pinPost({ slug, actor, postId, pinned }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#requireModerator(community._id, actor._id);

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId);
    if (
      !post ||
      post.status !== POST_STATUS.PUBLISHED ||
      !post.communityId ||
      String(post.communityId) !== String(community._id)
    ) {
      throw new AppError('Post not found in this community', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    post.communityPinnedAt = pinned ? new Date() : null;
    await post.save();

    return {
      id: String(post._id),
      communityPinnedAt: post.communityPinnedAt,
    };
  }

  /**
   * Community feed — published posts with this communityId.
   */
  async getFeed({ slug, viewerId = null, cursor, limit, type = null }) {
    const community = await this.#requireActiveBySlug(slug);
    const isMember = await this.#isMember(community._id, viewerId);

    if (community.visibility === COMMUNITY_VISIBILITY.PRIVATE && !isMember) {
      throw new AppError('Join this community to view its feed', HTTP_STATUS.FORBIDDEN, {
        code: 'COMMUNITY_PRIVATE',
      });
    }

    const { feedService } = require('../feed/feed.service');
    return feedService.getCommunityFeed({
      communityId: String(community._id),
      viewerId,
      cursor,
      limit,
      type,
    });
  }

  /**
   * Owner/mod creates an announcement post in the community.
   */
  async createAnnouncement({ slug, author, body }) {
    const community = await this.#requireActiveBySlug(slug);
    const membership = await CommunityMembership.findOne({
      communityId: community._id,
      userId: author._id,
    }).lean();

    if (
      !membership ||
      (membership.role !== MEMBERSHIP_ROLES.OWNER &&
        membership.role !== MEMBERSHIP_ROLES.MODERATOR)
    ) {
      throw new AppError(
        'Only owners and moderators can post announcements',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_COMMUNITY_MOD' },
      );
    }

    const content = String(body.content || '').trim();
    if (!content) {
      throw new AppError('Announcement text is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMPTY_ANNOUNCEMENT',
      });
    }

    const { feedService } = require('../feed/feed.service');
    const post = await feedService.createPost({
      author,
      body: {
        content,
        type: POST_TYPES.TEXT,
        status: POST_STATUS.PUBLISHED,
        visibility: POST_VISIBILITY.PUBLIC,
        categories: body.categories?.length ? body.categories : ['entry_guidance'],
        communityId: String(community._id),
        isAnnouncement: true,
      },
    });

    const { notificationService } = require('../notifications/notification.service');
    await notificationService.safe(() =>
      notificationService.notifyCommunityAnnouncement({
        actor: author,
        post: { _id: post.id || post._id, content: post.content || content },
        community,
      }),
    );

    return post;
  }

  /**
   * Owner/mod basic analytics — counts from existing collections (COMM-012).
   * DAU skipped (no activity pipeline yet).
   */
  async getAnalytics({ slug, userId }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#requireModerator(community._id, userId);

    const now = Date.now();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const communityId = community._id;
    const published = {
      communityId,
      status: POST_STATUS.PUBLISHED,
    };

    const [
      newMembers7d,
      posts7d,
      posts30d,
      questionsTotal,
      announcementsTotal,
      resourcesTotal,
      upcomingEvents,
      goingRsvpsUpcoming,
    ] = await Promise.all([
      CommunityMembership.countDocuments({
        communityId,
        joinedAt: { $gte: d7 },
      }),
      Post.countDocuments({ ...published, createdAt: { $gte: d7 } }),
      Post.countDocuments({ ...published, createdAt: { $gte: d30 } }),
      Post.countDocuments({
        ...published,
        type: POST_TYPES.QUESTION,
      }),
      Post.countDocuments({
        ...published,
        isAnnouncement: true,
      }),
      CommunityResource.countDocuments({ communityId }),
      CommunityEvent.countDocuments({
        communityId,
        status: 'scheduled',
        startsAt: { $gte: new Date(now) },
      }),
      CommunityEvent.aggregate([
        {
          $match: {
            communityId,
            status: 'scheduled',
            startsAt: { $gte: new Date(now) },
          },
        },
        {
          $group: {
            _id: null,
            going: { $sum: '$goingCount' },
          },
        },
      ]),
    ]);

    return {
      memberCount: Number(community.memberCount) || 0,
      newMembers7d,
      posts7d,
      posts30d,
      questionsTotal,
      announcementsTotal,
      resourcesTotal,
      upcomingEvents,
      upcomingGoing: Number(goingRsvpsUpcoming[0]?.going) || 0,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Used by feed createPost — verify membership + mute.
   */
  async assertMember(communityId, userId) {
    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      throw new AppError('Community not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMUNITY_NOT_FOUND',
      });
    }
    const community = await Community.findOne({
      _id: communityId,
      status: COMMUNITY_STATUS.ACTIVE,
    }).lean();
    if (!community) {
      throw new AppError('Community not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMUNITY_NOT_FOUND',
      });
    }
    const mem = await CommunityMembership.findOne({
      communityId,
      userId,
    }).lean();
    if (!mem) {
      throw new AppError(
        'Join the community before posting',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_COMMUNITY_MEMBER' },
      );
    }
    if (mem.mutedUntil && new Date(mem.mutedUntil).getTime() > Date.now()) {
      throw new AppError(
        'You are muted in this community and cannot post right now',
        HTTP_STATUS.FORBIDDEN,
        { code: 'COMMUNITY_MUTED' },
      );
    }
    return community;
  }

  async #requireActiveBySlug(slug) {
    const community = await Community.findOne({
      slug: String(slug || '').toLowerCase().trim(),
      status: COMMUNITY_STATUS.ACTIVE,
    }).lean();
    if (!community) {
      throw new AppError('Community not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMUNITY_NOT_FOUND',
      });
    }
    return community;
  }

  async #reputationMap(communityId, userIds) {
    const map = new Map();
    const unique = [
      ...new Set(
        (userIds || [])
          .map((id) => String(id))
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ];
    if (!unique.length) return map;

    const oids = unique.map((id) => new mongoose.Types.ObjectId(id));
    unique.forEach((id) => {
      map.set(id, {
        posts: 0,
        acceptedAnswers: 0,
        resources: 0,
        rsvpsGoing: 0,
      });
    });

    const [postAgg, resourceAgg, rsvpAgg, acceptedPosts] = await Promise.all([
      Post.aggregate([
        {
          $match: {
            communityId,
            status: POST_STATUS.PUBLISHED,
            authorId: { $in: oids },
          },
        },
        { $group: { _id: '$authorId', n: { $sum: 1 } } },
      ]),
      CommunityResource.aggregate([
        {
          $match: {
            communityId,
            createdById: { $in: oids },
          },
        },
        { $group: { _id: '$createdById', n: { $sum: 1 } } },
      ]),
      CommunityEventRsvp.aggregate([
        {
          $match: {
            communityId,
            userId: { $in: oids },
            status: 'going',
          },
        },
        { $group: { _id: '$userId', n: { $sum: 1 } } },
      ]),
      Post.find({
        communityId,
        status: POST_STATUS.PUBLISHED,
        type: POST_TYPES.QUESTION,
        'question.acceptedAnswerId': { $ne: null },
      })
        .select('question.acceptedAnswerId')
        .lean(),
    ]);

    for (const row of postAgg) {
      const key = String(row._id);
      const entry = map.get(key);
      if (entry) entry.posts = row.n;
    }
    for (const row of resourceAgg) {
      const key = String(row._id);
      const entry = map.get(key);
      if (entry) entry.resources = row.n;
    }
    for (const row of rsvpAgg) {
      const key = String(row._id);
      const entry = map.get(key);
      if (entry) entry.rsvpsGoing = row.n;
    }

    const commentIds = acceptedPosts
      .map((p) => p.question?.acceptedAnswerId)
      .filter(Boolean);
    if (commentIds.length) {
      const comments = await Comment.find({
        _id: { $in: commentIds },
        authorId: { $in: oids },
      })
        .select('authorId')
        .lean();
      for (const comment of comments) {
        const key = String(comment.authorId);
        const entry = map.get(key);
        if (entry) entry.acceptedAnswers += 1;
      }
    }

    return map;
  }

  async #requireModerator(communityId, userId) {
    const mem = await CommunityMembership.findOne({
      communityId,
      userId,
    }).lean();
    if (
      !mem ||
      (mem.role !== MEMBERSHIP_ROLES.OWNER &&
        mem.role !== MEMBERSHIP_ROLES.MODERATOR)
    ) {
      throw new AppError(
        'Only owners and moderators can do that',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_COMMUNITY_MOD' },
      );
    }
    return mem;
  }

  async #isMember(communityId, userId) {
    if (!userId) return false;
    const mem = await CommunityMembership.exists({ communityId, userId });
    return Boolean(mem);
  }

  async #membershipMap(viewerId, communityIds) {
    const map = new Map();
    if (!viewerId || !communityIds.length) return map;
    const rows = await CommunityMembership.find({
      userId: viewerId,
      communityId: { $in: communityIds },
    }).lean();
    rows.forEach((row) => {
      map.set(String(row.communityId), row);
    });
    return map;
  }
}

const communityService = new CommunityService();

module.exports = {
  communityService,
  serializeCommunity,
};
