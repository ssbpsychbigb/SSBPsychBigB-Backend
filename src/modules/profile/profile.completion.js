'use strict';

/**
 * Profile completion score — SRS §3.6 weights.
 */

const COMPLETION_ITEMS = [
  { key: 'basic', label: 'Basic details', weight: 20, href: '/profile/edit' },
  { key: 'defence', label: 'Defence details', weight: 20, href: '/profile/edit' },
  { key: 'education', label: 'Education', weight: 10, href: '/profile/edit' },
  { key: 'bio', label: 'Bio', weight: 10, href: '/profile/edit' },
  { key: 'journey', label: 'Journey timeline', weight: 10, href: '?tab=journey' },
  { key: 'achievements', label: 'Achievements', weight: 10, href: '?tab=achievements' },
  { key: 'photo', label: 'Profile photo', weight: 10, href: '/profile/edit' },
  { key: 'interests', label: 'Interests', weight: 10, href: '/profile/edit' },
  { key: 'verification', label: 'Verification', weight: 10, href: '/profile/edit' },
];

/**
 * @param {import('mongoose').Document | Record<string, unknown>} user
 * @param {{ journeyCount?: number, achievementCount?: number }} extras
 */
function computeCompletion(user, extras = {}) {
  const filled = {
    basic: Boolean(String(user.fullName || '').trim() && String(user.username || '').trim()),
    defence: Boolean(
      String(user.examGoal || '').trim() ||
        String(user.preferredService || '').trim() ||
        String(user.preparationStage || '').trim(),
    ),
    education: Boolean(String(user.education || '').trim()),
    bio: Boolean(String(user.bio || '').trim()),
    journey: Number(extras.journeyCount || 0) > 0,
    achievements: Number(extras.achievementCount || 0) > 0,
    photo: Boolean(String(user.profilePhotoPath || user.officerPhotoPath || '').trim()),
    interests: Boolean(
      String(user.hobbies || '').trim() ||
        (Array.isArray(user.languages) && user.languages.some((l) => String(l).trim())),
    ),
    verification: Number(user.verificationLevel || 0) >= 2,
  };

  let percent = 0;
  const missing = [];

  for (const item of COMPLETION_ITEMS) {
    if (filled[item.key]) {
      percent += item.weight;
    } else {
      missing.push({ key: item.key, label: item.label, weight: item.weight, href: item.href });
    }
  }

  return { percent, missing };
}

module.exports = { computeCompletion, COMPLETION_ITEMS };
