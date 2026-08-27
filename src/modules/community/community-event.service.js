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
  CommunityEvent,
  CommunityEventRsvp,
  EVENT_LOCATION_TYPES,
  RSVP_STATUS,
} = require('./community-event.model');
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

function serializeEvent(doc, creator, myRsvp = null) {
  return {
    id: String(doc._id),
    communityId: String(doc.communityId),
    title: doc.title,
    description: doc.description || '',
    startsAt: new Date(doc.startsAt).toISOString(),
    endsAt: doc.endsAt ? new Date(doc.endsAt).toISOString() : null,
    locationType: doc.locationType || 'tbd',
    locationText: doc.locationText || '',
    meetingUrl: doc.meetingUrl || '',
    status: doc.status || 'scheduled',
    goingCount: Number(doc.goingCount) || 0,
    interestedCount: Number(doc.interestedCount) || 0,
    myRsvp: myRsvp || null,
    createdBy: serializeCreator(creator),
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date().toISOString(),
  };
}

function parseStartsAt(raw) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('Invalid start time', HTTP_STATUS.BAD_REQUEST, {
      code: 'INVALID_STARTS_AT',
    });
  }
  return date;
}

function encodeCursor(startsAt, id) {
  return `${new Date(startsAt).toISOString()}|${String(id)}`;
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  const [iso, id] = cursor.split('|');
  if (!iso || !mongoose.Types.ObjectId.isValid(id)) return null;
  const startsAt = new Date(iso);
  if (Number.isNaN(startsAt.getTime())) return null;
  return { startsAt, id: new mongoose.Types.ObjectId(id) };
}

class CommunityEventService {
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
        'Join this community to view events',
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
        'Join this community to view events',
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
        'Only owners and moderators can manage events',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_COMMUNITY_MOD' },
      );
    }
    return mem;
  }

  async #assertMember(community, userId) {
    const mem = await CommunityMembership.findOne({
      communityId: community._id,
      userId,
    }).lean();
    if (!mem) {
      throw new AppError(
        'Join this community to RSVP',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_COMMUNITY_MEMBER' },
      );
    }
    return mem;
  }

  async listEvents({
    slug,
    viewerId = null,
    scope = 'upcoming',
    cursor,
    limit = 20,
  }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertCanView(community, viewerId);

    const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const now = new Date();
    const filter = { communityId: community._id };
    const normalizedScope = String(scope || 'upcoming').toLowerCase();

    if (normalizedScope === 'past') {
      filter.status = 'scheduled';
      filter.startsAt = { $lt: now };
    } else if (normalizedScope === 'all') {
      // include cancelled
    } else {
      filter.status = 'scheduled';
      filter.startsAt = { $gte: now };
    }

    const decoded = decodeCursor(cursor);
    const sort =
      normalizedScope === 'past'
        ? { startsAt: -1, _id: -1 }
        : { startsAt: 1, _id: 1 };

    if (decoded) {
      if (normalizedScope === 'past') {
        filter.$or = [
          { startsAt: { $lt: decoded.startsAt } },
          { startsAt: decoded.startsAt, _id: { $lt: decoded.id } },
        ];
      } else {
        filter.$or = [
          { startsAt: { $gt: decoded.startsAt } },
          { startsAt: decoded.startsAt, _id: { $gt: decoded.id } },
        ];
      }
    }

    const rows = await CommunityEvent.find(filter)
      .sort(sort)
      .limit(take + 1)
      .lean();

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    const creatorIds = [...new Set(page.map((r) => String(r.createdById)))];
    const creators = creatorIds.length
      ? await User.find({
          _id: creatorIds.map((id) => new mongoose.Types.ObjectId(id)),
        })
          .select('fullName username')
          .lean()
      : [];
    const creatorMap = new Map(creators.map((u) => [String(u._id), u]));

    let rsvpMap = new Map();
    if (viewerId && page.length) {
      const rsvps = await CommunityEventRsvp.find({
        eventId: { $in: page.map((r) => r._id) },
        userId: viewerId,
      }).lean();
      rsvpMap = new Map(rsvps.map((r) => [String(r.eventId), r.status]));
    }

    return {
      items: page.map((row) =>
        serializeEvent(
          row,
          creatorMap.get(String(row.createdById)),
          rsvpMap.get(String(row._id)) || null,
        ),
      ),
      nextCursor: hasMore
        ? encodeCursor(page[page.length - 1].startsAt, page[page.length - 1]._id)
        : null,
      hasMore,
    };
  }

  async createEvent({ slug, user, body = {} }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertModerator(community, user._id);

    const title = String(body.title || '').trim().slice(0, 160);
    if (!title) {
      throw new AppError('Title is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'TITLE_REQUIRED',
      });
    }

    const startsAt = parseStartsAt(body.startsAt);
    let endsAt = null;
    if (body.endsAt) {
      endsAt = parseStartsAt(body.endsAt);
      if (endsAt.getTime() < startsAt.getTime()) {
        throw new AppError(
          'End time must be after start time',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_ENDS_AT' },
        );
      }
    }

    let locationType = String(body.locationType || 'tbd').trim();
    if (!EVENT_LOCATION_TYPES.includes(locationType)) {
      locationType = 'tbd';
    }

    const locationText = String(body.locationText || '')
      .trim()
      .slice(0, 240);
    let meetingUrl = String(body.meetingUrl || '')
      .trim()
      .slice(0, 1000);
    if (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) {
      throw new AppError(
        'Meeting link must start with http:// or https://',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_URL' },
      );
    }

    if (locationType === 'online' && !meetingUrl) {
      // allow empty — host can add later via edit; OK for MVP create
    }

    const doc = await CommunityEvent.create({
      communityId: community._id,
      createdById: user._id,
      title,
      description: String(body.description || '')
        .trim()
        .slice(0, 2000),
      startsAt,
      endsAt,
      locationType,
      locationText,
      meetingUrl,
      status: 'scheduled',
      goingCount: 0,
      interestedCount: 0,
    });

    return serializeEvent(doc, user, null);
  }

  async cancelEvent({ slug, user, eventId }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertModerator(community, user._id);

    const event = await CommunityEvent.findOne({
      _id: asObjectId(eventId, 'EVENT_NOT_FOUND'),
      communityId: community._id,
    });
    if (!event) {
      throw new AppError('Event not found', HTTP_STATUS.NOT_FOUND, {
        code: 'EVENT_NOT_FOUND',
      });
    }

    event.status = 'cancelled';
    await event.save();

    const creator = await User.findById(event.createdById)
      .select('fullName username')
      .lean();
    return serializeEvent(event, creator, null);
  }

  async setRsvp({ slug, user, eventId, status }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertMember(community, user._id);

    const normalized = String(status || '').trim().toLowerCase();
    if (!RSVP_STATUS.includes(normalized)) {
      throw new AppError(
        'RSVP must be going or interested',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_RSVP' },
      );
    }

    const event = await CommunityEvent.findOne({
      _id: asObjectId(eventId, 'EVENT_NOT_FOUND'),
      communityId: community._id,
      status: 'scheduled',
    });
    if (!event) {
      throw new AppError('Event not found', HTTP_STATUS.NOT_FOUND, {
        code: 'EVENT_NOT_FOUND',
      });
    }

    const existing = await CommunityEventRsvp.findOne({
      eventId: event._id,
      userId: user._id,
    });

    if (!existing) {
      await CommunityEventRsvp.create({
        eventId: event._id,
        communityId: community._id,
        userId: user._id,
        status: normalized,
      });
      if (normalized === 'going') {
        event.goingCount = (event.goingCount || 0) + 1;
      } else {
        event.interestedCount = (event.interestedCount || 0) + 1;
      }
    } else if (existing.status !== normalized) {
      if (existing.status === 'going') {
        event.goingCount = Math.max(0, (event.goingCount || 0) - 1);
      } else {
        event.interestedCount = Math.max(0, (event.interestedCount || 0) - 1);
      }
      if (normalized === 'going') {
        event.goingCount = (event.goingCount || 0) + 1;
      } else {
        event.interestedCount = (event.interestedCount || 0) + 1;
      }
      existing.status = normalized;
      await existing.save();
    }

    await event.save();

    const creator = await User.findById(event.createdById)
      .select('fullName username')
      .lean();
    return serializeEvent(event, creator, normalized);
  }

  async clearRsvp({ slug, user, eventId }) {
    const community = await this.#requireActiveBySlug(slug);
    await this.#assertMember(community, user._id);

    const event = await CommunityEvent.findOne({
      _id: asObjectId(eventId, 'EVENT_NOT_FOUND'),
      communityId: community._id,
    });
    if (!event) {
      throw new AppError('Event not found', HTTP_STATUS.NOT_FOUND, {
        code: 'EVENT_NOT_FOUND',
      });
    }

    const existing = await CommunityEventRsvp.findOneAndDelete({
      eventId: event._id,
      userId: user._id,
    });

    if (existing) {
      if (existing.status === 'going') {
        event.goingCount = Math.max(0, (event.goingCount || 0) - 1);
      } else {
        event.interestedCount = Math.max(0, (event.interestedCount || 0) - 1);
      }
      await event.save();
    }

    const creator = await User.findById(event.createdById)
      .select('fullName username')
      .lean();
    return serializeEvent(event, creator, null);
  }
}

const communityEventService = new CommunityEventService();

module.exports = { communityEventService };
