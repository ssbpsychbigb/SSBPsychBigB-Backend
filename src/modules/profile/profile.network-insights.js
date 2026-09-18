'use strict';

const mongoose = require('mongoose');
const { User } = require('../auth/user.model');
const { Follow } = require('../feed/follow.model');
const { FollowEvent } = require('../feed/follow-event.model');
const { Post } = require('../feed/post.model');
const { POST_STATUS } = require('../feed/feed.constants');

const SAMPLE_CAP = 250;
const EXAM_LABELS = {
  nda: 'NDA',
  cds: 'CDS',
  afcat: 'AFCAT',
  ssb: 'SSB Interview',
  capf: 'CAPF',
  agniveer: 'Agniveer',
  inet: 'INET',
  other: 'Other / Exploring',
};
const ROLE_LABELS = {
  aspirant: 'Aspirants',
  educator: 'Educators',
  officer: 'Officers',
  institute: 'Institutes',
};
const MENTOR_ROLES = new Set(['educator', 'defence_officer', 'institute', 'institute_admin']);
const USER_FIELDS =
  'role examGoal verificationLevel attemptDate ssbBoard preparationStage recommendations city instituteName';

function roleBucket(role) {
  if (role === 'defence_officer') return 'officer';
  if (role === 'educator' || role === 'institute_admin') return 'educator';
  if (role === 'institute') return 'institute';
  return 'aspirant';
}

function examLabel(value) {
  if (!value) return '';
  return EXAM_LABELS[value] || value;
}

function ratio(part, whole) {
  if (!whole) return 0;
  return Math.max(0, Math.min(1, part / whole));
}

function roundShare(value) {
  return Math.round(value * 1000) / 1000;
}

function toSlices(counts, labels) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      label: labels[key] || key,
      count,
      share: total ? roundShare(count / total) : 0,
    }));
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function pickGap({
  following,
  mentorShare,
  sameExamShare,
  mutualRate,
  examLabel: exam,
  username,
}) {
  const lists = username ? `/u/${username}/network` : '/network';
  if (following < 5) {
    return {
      code: 'follow_more',
      label: 'Follow 5 prep partners',
      href: '/network',
    };
  }
  if (mentorShare < 0.08) {
    return {
      code: 'mentors',
      label: exam ? `Follow 3 mentors in ${exam}` : 'Follow 3 mentors',
      href: '/network',
    };
  }
  if (sameExamShare < 0.25 && exam) {
    return {
      code: 'peers',
      label: `Find more ${exam} peers`,
      href: '/network',
    };
  }
  if (mutualRate < 0.2) {
    return {
      code: 'follow_back',
      label: 'Follow back people in your circle',
      href: `${lists}?tab=followers`,
    };
  }
  return {
    code: 'keep_going',
    label: 'Keep building your Prep Circle',
    href: '/network',
  };
}

function insightLine(score, { exam, mentorShare, sameExamShare }) {
  if (score <= 0) {
    return 'Start following mentors and peers to build your Prep Circle.';
  }
  if (score >= 70) {
    if (exam && sameExamShare >= 0.3) return `Strong ${exam} peer + mentor mix.`;
    if (mentorShare >= 0.12) return 'Strong mentor mix in your circle.';
    return exam ? `Strong ${exam} peer mix.` : 'Strong peer + mentor mix.';
  }
  if (score >= 40) return 'Growing circle — add mentors or same-exam peers.';
  return 'Your Prep Circle is just getting started.';
}

/**
 * Owner-only network intelligence (Phase M).
 */
async function getNetworkInsights(viewer) {
  if (!viewer?._id) {
    return emptyInsights();
  }

  const userId = viewer._id;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const now = Date.now();
  const viewerAttempt = viewer.attemptDate ? new Date(viewer.attemptDate).getTime() : now;
  const windowStart = new Date(viewerAttempt - 30 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(viewerAttempt + 30 * 24 * 60 * 60 * 1000);
  const viewerExam = String(viewer.examGoal || '').trim();
  const viewerBoard = String(viewer.ssbBoard || '').trim();
  const exam = examLabel(viewerExam);

  const followingRows = await Follow.find({ followerId: userId })
    .select('followingId')
    .lean();
  const followingIds = followingRows.map((row) => row.followingId);

  const [followers, mutual, newFollowers7d, unfollows7d] = await Promise.all([
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
    FollowEvent.countDocuments({
      targetId: userId,
      kind: 'unfollow',
      createdAt: { $gte: weekAgo },
    }),
  ]);

  const following = followingIds.length;
  const followBackRate = ratio(mutual, following);
  const mutualRate = followBackRate;

  const sampleFollowIds = followingIds.slice(0, SAMPLE_CAP);
  const followerSampleRows = await Follow.find({ followingId: userId })
    .select('followerId')
    .sort({ _id: -1 })
    .limit(SAMPLE_CAP)
    .lean();
  const sampleFollowerIds = followerSampleRows.map((row) => row.followerId);

  const sampleIds = [
    ...new Set([...sampleFollowIds, ...sampleFollowerIds].map((id) => String(id))),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const members = sampleIds.length
    ? await User.find({ _id: { $in: sampleIds } }).select(USER_FIELDS).lean()
    : [];
  const memberMap = new Map(members.map((row) => [String(row._id), row]));
  const followingMembers = sampleFollowIds
    .map((id) => memberMap.get(String(id)))
    .filter(Boolean);

  const mentorsFollowing = followingMembers.filter((row) =>
    MENTOR_ROLES.has(row.role),
  ).length;
  const mentorShare = ratio(mentorsFollowing, followingMembers.length);
  const sameExamCount = followingMembers.filter(
    (row) => viewerExam && row.examGoal === viewerExam,
  ).length;
  const sameExamShare = ratio(sameExamCount, followingMembers.length);
  const verifiedCount = followingMembers.filter(
    (row) => (row.verificationLevel || 0) >= 2,
  ).length;
  const verifiedShare = ratio(verifiedCount, followingMembers.length);

  let activeShare = 0;
  let activeInNetwork7d = 0;
  if (sampleFollowIds.length) {
    const [active14, active7] = await Promise.all([
      Post.distinct('authorId', {
        authorId: { $in: sampleFollowIds },
        status: POST_STATUS.PUBLISHED,
        createdAt: { $gte: fourteenAgo },
      }),
      Post.distinct('authorId', {
        authorId: { $in: sampleFollowIds },
        status: POST_STATUS.PUBLISHED,
        createdAt: { $gte: weekAgo },
      }),
    ]);
    activeShare = ratio(active14.length, followingMembers.length);
    activeInNetwork7d = active7.length;
  }

  const emptyPenalty = following === 0 ? 18 : 0;
  const prepCircleScore = clampScore(
    32 * mutualRate +
      24 * mentorShare +
      16 * sameExamShare +
      14 * verifiedShare +
      14 * activeShare -
      emptyPenalty,
  );

  const roleCounts = { aspirant: 0, educator: 0, officer: 0, institute: 0 };
  const examCounts = {};
  for (const row of followingMembers.length ? followingMembers : members) {
    roleCounts[roleBucket(row.role)] += 1;
    const key = row.examGoal || 'other';
    examCounts[key] = (examCounts[key] || 0) + 1;
  }

  const attemptWithin30d = followingMembers.filter((row) => {
    if (!row.attemptDate) return false;
    const t = new Date(row.attemptDate).getTime();
    return t >= windowStart.getTime() && t <= windowEnd.getTime();
  }).length;

  const boardCounts = {};
  for (const row of followingMembers) {
    const board = String(row.ssbBoard || '').trim();
    if (!board) continue;
    boardCounts[board] = (boardCounts[board] || 0) + 1;
  }
  const sameSsbBoard = Object.entries(boardCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([board, count]) => ({ board, count }));

  const recommendedInCircle = followingMembers.filter(
    (row) =>
      row.preparationStage === 'recommended' ||
      row.preparationStage === 'officer' ||
      (row.recommendations || 0) > 0,
  ).length;

  const gap = pickGap({
    following,
    mentorShare,
    sameExamShare,
    mutualRate,
    examLabel: exam,
    username: viewer.username,
  });

  return {
    followers,
    following,
    mutual,
    newFollowers7d,
    unfollows7d,
    followBackRate: roundShare(followBackRate),
    mutualRate: roundShare(mutualRate),
    activeInNetwork7d,
    prepCircleScore,
    insight: insightLine(prepCircleScore, { exam, mentorShare, sameExamShare }),
    gap,
    cohort: {
      byRole: toSlices(roleCounts, ROLE_LABELS),
      byExam: toSlices(examCounts, { ...EXAM_LABELS, other: 'Other' }),
    },
    proximity: {
      attemptWithin30d,
      sameSsbBoard,
      recommendedInCircle,
      viewerBoard: viewerBoard || '',
    },
    mentorsFollowing,
  };
}

function emptyInsights() {
  return {
    followers: 0,
    following: 0,
    mutual: 0,
    newFollowers7d: 0,
    unfollows7d: 0,
    followBackRate: 0,
    mutualRate: 0,
    activeInNetwork7d: 0,
    prepCircleScore: 0,
    insight: 'Start following mentors and peers to build your Prep Circle.',
    gap: {
      code: 'follow_more',
      label: 'Follow 5 prep partners',
      href: '/network',
    },
    cohort: { byRole: [], byExam: [] },
    proximity: {
      attemptWithin30d: 0,
      sameSsbBoard: [],
      recommendedInCircle: 0,
      viewerBoard: '',
    },
    mentorsFollowing: 0,
  };
}

/**
 * One-line reason for People you may know.
 */
function suggestionReason(row, viewer, followsYou) {
  if (followsYou) {
    return { code: 'follows_you', label: 'Follows you' };
  }
  const exam = examLabel(row.examGoal);
  if (viewer?.examGoal && row.examGoal && row.examGoal === viewer.examGoal && exam) {
    return { code: 'same_exam', label: `Also preparing for ${exam}` };
  }
  const city = String(row.city || '').trim();
  const viewerCity = String(viewer?.city || '').trim();
  if (city && viewerCity && city.toLowerCase() === viewerCity.toLowerCase()) {
    return { code: 'same_city', label: `From ${city}` };
  }
  const institute = String(row.instituteName || '').trim();
  const viewerInstitute = String(viewer?.instituteName || '').trim();
  if (
    institute &&
    viewerInstitute &&
    institute.toLowerCase() === viewerInstitute.toLowerCase()
  ) {
    return { code: 'same_institute', label: `Also at ${institute}` };
  }
  const board = String(row.ssbBoard || '').trim();
  const viewerBoard = String(viewer?.ssbBoard || '').trim();
  if (board && viewerBoard && board.toLowerCase() === viewerBoard.toLowerCase()) {
    return { code: 'same_ssb', label: `Same SSB · ${board}` };
  }
  if (row.attemptDate) {
    const days = Math.round(
      (new Date(row.attemptDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    if (days >= 0 && days <= 30) {
      return {
        code: 'attempt_soon',
        label: days === 0 ? 'Attempt today' : `Attempting in ${days} day${days === 1 ? '' : 's'}`,
      };
    }
  }
  if (row.role === 'defence_officer') {
    return { code: 'officer', label: 'Officer in the community' };
  }
  if (row.role === 'educator' || row.role === 'institute_admin') {
    return { code: 'mentor', label: 'Mentor in the community' };
  }
  if (row.role === 'institute') {
    return { code: 'institute', label: 'Defence institute' };
  }
  if (exam) return { code: 'exam', label: `Preparing for ${exam}` };
  if (city) return { code: 'city', label: city };
  return { code: 'suggested', label: 'Suggested for you' };
}

module.exports = { getNetworkInsights, suggestionReason };
