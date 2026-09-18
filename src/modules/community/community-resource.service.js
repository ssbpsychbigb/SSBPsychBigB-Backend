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
const {
  CommunityResource,
  RESOURCE_KINDS,
} = require('./community-resource.model');
const { User } = require('../auth/user.model');

function asObjectId(id, code = 'NOT_FOUND') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Not found', HTTP_STATUS.NOT_FOUND, { code });
  }
  return new mongoose.Types.ObjectId(id);
}

function serializeCreator(user) {
  if (!user) {
    return { id: '', fullName: 'Member', username: '' };
  }
  return {
    id: String(user._id),
    fullName: user.fullName || user.username || 'Member',
    username: user.username || '',
  };
}

function serializeResource(doc, creator) {
  return {
    id: String(doc._id),
    communityId: String(doc.communityId),
    kind: doc.kind,
    title: doc.title,
    description: doc.description || '',
    url: doc.url || '',
    filePath: doc.filePath || '',
    fileName: doc.fileName || '',
    mime: doc.mime || '',
    size: Number(doc.size) || 0,
    pinnedAt: doc.pinnedAt ? new Date(doc.pinnedAt).toISOString() : null,
    createdBy: serializeCreator(creator),
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date().toISOString(),
  };
}

class CommunityResourceService {
  async #requireActiveBySlug(slug) {
    const community = await Community.findOne({
      slug: String(slug || '').toLowerCase().trim(),
      status: COMMUNITY_STATUS.ACTIVE,
    });
    if (!community) {
      throw new AppError('Community not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMUNITY_NOT_FOUND',
      });
    }
    return community;
  }

  async #assertCanView(community, viewerId) {
    if (community.visibility !== COMMUNITY_VISIBILITY.PRIVATE) return null;
    if (!viewerId) {
      throw new AppError(
        'Join this community to view resources',
        HTTP_STATUS.FORBIDDEN,
        { code: 'COMMUNITY_PRIVATE' },
      );
    }
    const mem = await CommunityMembership.findOne({
      communityId: community._id,
      userId: viewerId,
    }).lean();
    if (!mem) {
      throw new AppError(
        'Join this community to view resources',
        HTTP_STATUS.FORBIDDEN,
        { code: 'COMMUNITY_PRIVATE' },
      );
    }
    return mem;
  }

  async #assertModerator(community, userId) {
    const mem = await CommunityMembership.findOne({
      communityId: community._id,
      userId,
    }).lean();
    if (
      !mem ||
      (mem.role !== MEMBERSHIP_ROLES.OWNER &&
        mem.role !== MEMBERSHIP_ROLES.MODERATOR)
    ) {
      throw new AppError(
        'Only owners and moderators can manage resources',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_COMMUNITY_MOD' },
      );
    }
    return mem;
  }

  async assertModeratorBySlug(slug, userId) {
    const community = await this.#requireActiveBySlug(slug);
    return this.#assertModerator(community, userId);
  }

  async listResources({ slug, viewerId = null, q = '', cursor, limit = 30 }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertCanView(community, viewerId);

    const take = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const filter = { communityId: community._id };
    const query = String(q || '').trim();
    if (query) {
      filter.$or = [
        { title: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        {
          description: new RegExp(
            query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'i',
          ),
        },
        {
          fileName: new RegExp(
            query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'i',
          ),
        },
      ];
    }

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await CommunityResource.find(filter)
      .sort({ pinnedAt: -1, createdAt: -1, _id: -1 })
      .limit(take + 1)
      .lean();

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const creatorIds = [...new Set(page.map((r) => String(r.createdById)))];
    const creators = await User.find({
      _id: creatorIds.map((id) => new mongoose.Types.ObjectId(id)),
    })
      .select('fullName username')
      .lean();
    const creatorMap = new Map(creators.map((u) => [String(u._id), u]));

    return {
      items: page.map((row) =>
        serializeResource(row, creatorMap.get(String(row.createdById))),
      ),
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  async createResource({ slug, user, body = {} }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertModerator(community, user._id);

    const kind = String(body.kind || '').trim();
    if (!RESOURCE_KINDS.includes(kind)) {
      throw new AppError('Invalid resource kind', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_KIND',
      });
    }

    const title = String(body.title || '').trim().slice(0, 160);
    if (!title) {
      throw new AppError('Title is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'TITLE_REQUIRED',
      });
    }

    const description = String(body.description || '')
      .trim()
      .slice(0, 800);

    let url = '';
    let filePath = '';
    let fileName = '';
    let mime = '';
    let size = 0;

    if (kind === 'link') {
      url = String(body.url || '').trim().slice(0, 1000);
      if (!/^https?:\/\//i.test(url)) {
        throw new AppError(
          'Link must start with http:// or https://',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_URL' },
        );
      }
    } else {
      filePath = String(body.filePath || '').trim().slice(0, 500);
      if (!filePath.startsWith('/uploads/community-resources/')) {
        throw new AppError('Upload a file first', HTTP_STATUS.BAD_REQUEST, {
          code: 'FILE_REQUIRED',
        });
      }
      fileName = String(body.fileName || '').trim().slice(0, 240);
      mime = String(body.mime || '').trim().slice(0, 120);
      size = Number(body.size) || 0;
    }

    const doc = await CommunityResource.create({
      communityId: community._id,
      createdById: user._id,
      kind,
      title,
      description,
      url,
      filePath,
      fileName,
      mime,
      size,
      pinnedAt: null,
    });

    return serializeResource(doc, user);
  }

  async setPinned({ slug, user, resourceId, pinned }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertModerator(community, user._id);

    const resource = await CommunityResource.findOne({
      _id: asObjectId(resourceId, 'RESOURCE_NOT_FOUND'),
      communityId: community._id,
    });
    if (!resource) {
      throw new AppError('Resource not found', HTTP_STATUS.NOT_FOUND, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    resource.pinnedAt = pinned ? new Date() : null;
    await resource.save();

    const creator = await User.findById(resource.createdById)
      .select('fullName username')
      .lean();
    return serializeResource(resource, creator);
  }

  async deleteResource({ slug, user, resourceId }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertModerator(community, user._id);

    const resource = await CommunityResource.findOneAndDelete({
      _id: asObjectId(resourceId, 'RESOURCE_NOT_FOUND'),
      communityId: community._id,
    });
    if (!resource) {
      throw new AppError('Resource not found', HTTP_STATUS.NOT_FOUND, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }
    return { id: String(resource._id), deleted: true };
  }
}

const communityResourceService = new CommunityResourceService();

module.exports = { communityResourceService, RESOURCE_KINDS };
