'use strict';

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

/**
 * @param {object} community
 * @param {{ isMember?: boolean, membershipRole?: string | null }} [viewer]
 */
function serializeCommunity(community, viewer = {}) {
  const doc =
    typeof community.toObject === 'function' ? community.toObject() : community;
  return {
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
    canModerate:
      viewer.membershipRole === MEMBERSHIP_ROLES.OWNER ||
      viewer.membershipRole === MEMBERSHIP_ROLES.MODERATOR,
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
        return serializeCommunity(community, {
          isMember: true,
          membershipRole: roleById.get(String(m.communityId)) || null,
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
    });
  }

  /**
   * Public detail by slug.
   */
  async getBySlug({ slug, viewerId = null }) {
    const community = await Community.findOne({
      slug: String(slug || '').toLowerCase().trim(),
      status: COMMUNITY_STATUS.ACTIVE,
    }).lean();

    if (!community) {
      throw new AppError('Community not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMUNITY_NOT_FOUND',
      });
    }

    if (
      community.visibility === COMMUNITY_VISIBILITY.PRIVATE &&
      !(await this.#isMember(community._id, viewerId))
    ) {
      throw new AppError('This community is private', HTTP_STATUS.FORBIDDEN, {
        code: 'COMMUNITY_PRIVATE',
      });
    }

    const mem = viewerId
      ? await CommunityMembership.findOne({
          communityId: community._id,
          userId: viewerId,
        }).lean()
      : null;

    return serializeCommunity(community, {
      isMember: Boolean(mem),
      membershipRole: mem?.role || null,
    });
  }

  async join({ slug, user }) {
    const community = await this.#requireActiveBySlug(slug);
    if (community.visibility === COMMUNITY_VISIBILITY.PRIVATE) {
      // MVP: private still joinable if you know the slug (invite-lite).
    }

    const existing = await CommunityMembership.findOne({
      communityId: community._id,
      userId: user._id,
    });
    if (existing) {
      return serializeCommunity(community, {
        isMember: true,
        membershipRole: existing.role,
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
   * Community feed — published posts with this communityId.
   */
  async getFeed({ slug, viewerId = null, cursor, limit }) {
    const community = await this.#requireActiveBySlug(slug);
    const isMember = await this.#isMember(community._id, viewerId);

    if (
      community.visibility === COMMUNITY_VISIBILITY.PRIVATE &&
      !isMember
    ) {
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
    return feedService.createPost({
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
  }

  /**
   * Used by feed createPost — verify membership.
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
