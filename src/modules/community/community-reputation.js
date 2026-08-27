'use strict';

/**
 * Community contributor reputation from existing contribution counts (COMM-REP).
 * No points ledger — pure thresholds.
 */

const LEVELS = Object.freeze({
  MEMBER: 'member',
  CONTRIBUTOR: 'contributor',
  HELPER: 'helper',
  EXPERT: 'expert',
});

const LEVEL_LABELS = Object.freeze({
  member: 'Member',
  contributor: 'Contributor',
  helper: 'Helper',
  expert: 'Expert',
});

/**
 * @param {{
 *   posts?: number,
 *   acceptedAnswers?: number,
 *   resources?: number,
 *   rsvpsGoing?: number,
 *   role?: string,
 * }} counts
 */
function buildContributorReputation(counts = {}) {
  const posts = Number(counts.posts) || 0;
  const acceptedAnswers = Number(counts.acceptedAnswers) || 0;
  const resources = Number(counts.resources) || 0;
  const rsvpsGoing = Number(counts.rsvpsGoing) || 0;
  const role = String(counts.role || 'member');

  const badges = [];
  if (acceptedAnswers >= 1) {
    badges.push({ code: 'accepted_answer', label: 'Accepted answers' });
  }
  if (resources >= 1) {
    badges.push({ code: 'resource_curator', label: 'Resource curator' });
  }
  if (posts >= 5) {
    badges.push({ code: 'regular', label: 'Regular' });
  }
  if (rsvpsGoing >= 2) {
    badges.push({ code: 'active_rsvp', label: 'Event regular' });
  }
  if (role === 'owner' || role === 'moderator') {
    badges.push({ code: 'community_mod', label: 'Community staff' });
  }

  let level = LEVELS.MEMBER;
  if (
    role === 'owner' ||
    role === 'moderator' ||
    (posts >= 5 && acceptedAnswers >= 2) ||
    (posts >= 8 && resources >= 2)
  ) {
    level = LEVELS.EXPERT;
  } else if (acceptedAnswers >= 1 || resources >= 2) {
    level = LEVELS.HELPER;
  } else if (posts >= 3 || resources >= 1 || rsvpsGoing >= 3) {
    level = LEVELS.CONTRIBUTOR;
  }

  return {
    level,
    levelLabel: LEVEL_LABELS[level] || 'Member',
    badges,
    counts: {
      posts,
      acceptedAnswers,
      resources,
      rsvpsGoing,
    },
  };
}

module.exports = {
  LEVELS,
  LEVEL_LABELS,
  buildContributorReputation,
};
