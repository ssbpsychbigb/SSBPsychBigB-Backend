'use strict';

/**
 * Officer Readiness Score — rule-based 0–100 (PROF-D01 / DASH-003).
 * Not an assessment grade; synthesizes profile depth + journey signals.
 */

const STAGE_SCORE = Object.freeze({
  exploring: 12,
  written_prep: 28,
  ssb_prep: 42,
  ssb_attended: 58,
  conference_out: 52,
  recommended: 78,
  medical: 85,
  joining: 92,
  officer: 100,
  mentor: 96,
});

/**
 * @param {number} score
 */
function bandFor(score) {
  if (score >= 85) return { code: 'commission_ready', label: 'Commission-ready' };
  if (score >= 70) return { code: 'officer_track', label: 'Officer track' };
  if (score >= 50) return { code: 'strong_trajectory', label: 'Strong trajectory' };
  if (score >= 30) return { code: 'mission_building', label: 'Getting mission-ready' };
  return { code: 'foundation', label: 'Building foundation' };
}

/**
 * @param {import('mongoose').Document | Record<string, unknown>} user
 * @param {{
 *   completionPercent?: number,
 *   journeyCount?: number,
 *   achievementCount?: number,
 * }} extras
 */
function computeOfficerReadiness(user, extras = {}) {
  const factors = [];
  let score = 0;

  const completionSlice = Math.round(
    Math.min(100, Math.max(0, Number(extras.completionPercent) || 0)) * 0.35,
  );
  score += completionSlice;
  factors.push({
    key: 'profile_completion',
    label: 'Profile depth',
    points: completionSlice,
    max: 35,
  });

  const stageKey = String(user.preparationStage || '').trim();
  const stageRaw = STAGE_SCORE[stageKey] ?? (stageKey ? 20 : 0);
  const stageSlice = Math.round(stageRaw * 0.25);
  score += stageSlice;
  factors.push({
    key: 'preparation_stage',
    label: 'Preparation stage',
    points: stageSlice,
    max: 25,
  });

  const defenceFilled = [
    user.examGoal,
    user.preferredService,
    user.preparationStage,
    user.ssbBoard,
    user.targetEntry,
  ].filter((v) => String(v || '').trim()).length;
  const defenceSlice = Math.round((Math.min(5, defenceFilled) / 5) * 15);
  score += defenceSlice;
  factors.push({
    key: 'defence_fields',
    label: 'Defence identity',
    points: defenceSlice,
    max: 15,
  });

  const journeyCount = Math.max(0, Number(extras.journeyCount) || 0);
  const journeySlice = Math.min(10, journeyCount * 3);
  score += journeySlice;
  factors.push({
    key: 'journey',
    label: 'Journey milestones',
    points: journeySlice,
    max: 10,
  });

  const achievementCount = Math.max(0, Number(extras.achievementCount) || 0);
  const achievementSlice = Math.min(10, achievementCount * 3);
  score += achievementSlice;
  factors.push({
    key: 'achievements',
    label: 'Achievements',
    points: achievementSlice,
    max: 10,
  });

  const level = Math.min(5, Math.max(0, Number(user.verificationLevel) || 0));
  const verifySlice = Math.round((level / 5) * 5);
  score += verifySlice;
  factors.push({
    key: 'verification',
    label: 'Verification',
    points: verifySlice,
    max: 5,
  });

  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const band = bandFor(clamped);

  return {
    score: clamped,
    band: band.code,
    bandLabel: band.label,
    factors,
  };
}

module.exports = { computeOfficerReadiness, STAGE_SCORE };
