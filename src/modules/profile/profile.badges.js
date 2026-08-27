'use strict';

/**
 * Composed profile badges from verification + achievements (PROF-D03).
 * No gamification catalog — maps existing trust signals.
 */

const LEVEL_BADGES = Object.freeze([
  { min: 5, code: 'platform_partner', label: 'Platform Partner' },
  { min: 4, code: 'verified_institute', label: 'Verified Institute' },
  { min: 3, code: 'verified_officer', label: 'Verified Officer' },
  { min: 2, code: 'verified_expert', label: 'Verified Expert' },
  { min: 1, code: 'verified_member', label: 'Verified Member' },
]);

const ROLE_BADGES = Object.freeze({
  defence_officer: { code: 'defence_officer', label: 'Defence Officer' },
  educator: { code: 'educator', label: 'Educator' },
  institute: { code: 'institute', label: 'Institute' },
  institute_admin: { code: 'institute_admin', label: 'Institute Admin' },
});

/**
 * @param {import('mongoose').Document | Record<string, unknown>} user
 * @param {{
 *   achievementCount?: number,
 *   verifiedAchievementCount?: number,
 *   completionPercent?: number,
 * }} extras
 */
function buildProfileBadges(user, extras = {}) {
  const badges = [];
  const level = Math.max(0, Number(user.verificationLevel) || 0);

  for (const row of LEVEL_BADGES) {
    if (level >= row.min) {
      badges.push({
        code: row.code,
        label: row.label,
        source: 'verification',
      });
      break;
    }
  }

  const roleBadge = ROLE_BADGES[String(user.role || '')];
  if (roleBadge && !badges.some((b) => b.code === roleBadge.code)) {
    badges.push({ ...roleBadge, source: 'role' });
  }

  const stage = String(user.preparationStage || '');
  if (stage === 'recommended' || Number(user.recommendations) > 0) {
    badges.push({
      code: 'ssb_recommended',
      label: 'SSB Recommended',
      source: 'defence',
    });
  }
  if (stage === 'officer') {
    badges.push({
      code: 'serving_officer',
      label: 'Serving Officer',
      source: 'defence',
    });
  }
  if (stage === 'mentor') {
    badges.push({
      code: 'mentor',
      label: 'Mentor',
      source: 'defence',
    });
  }

  const verifiedAchievements = Math.max(
    0,
    Number(extras.verifiedAchievementCount) || 0,
  );
  if (verifiedAchievements > 0) {
    badges.push({
      code: 'verified_achievements',
      label:
        verifiedAchievements === 1
          ? 'Verified Achievement'
          : `${verifiedAchievements} Verified Achievements`,
      source: 'achievement',
    });
  } else if (Number(extras.achievementCount) > 0) {
    badges.push({
      code: 'achievements_logged',
      label: 'Achievements logged',
      source: 'achievement',
    });
  }

  if (Number(extras.completionPercent) >= 100) {
    badges.push({
      code: 'complete_portfolio',
      label: 'Complete Portfolio',
      source: 'completion',
    });
  }

  return badges;
}

module.exports = { buildProfileBadges, LEVEL_BADGES };
