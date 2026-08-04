'use strict';

/**
 * Rule-based trending score (no AI) + educational boost.
 */

const { POST_STATUS } = require('./feed.constants');

/**
 * @param {object} post lean post with stats
 * @param {object | null} author user doc
 * @returns {number}
 */
function computeTrendingScore(post, author = null) {
  const likes = post.stats?.likes || 0;
  const comments = post.stats?.comments || 0;
  const saves = post.stats?.saves || 0;
  const shares = post.stats?.shares || 0;
  const reports = post.stats?.reports || 0;

  const createdAt = post.createdAt ? new Date(post.createdAt).getTime() : Date.now();
  const ageHours = Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60));
  const freshnessBoost = Math.max(0, 72 - ageHours) * 0.4;

  let verificationBoost = 0;
  const level = author?.verificationLevel ?? 0;
  const role = author?.role || '';

  if (role === 'defence_officer' || level >= 3) {
    verificationBoost = 30;
  } else if (role === 'educator' || level >= 2) {
    verificationBoost = 20;
  } else if (role === 'institute' || role === 'institute_admin') {
    verificationBoost = 15;
  }

  if (post.type === 'question' && post.question?.isAskMentor) {
    verificationBoost += 8;
  }
  if (post.type === 'achievement') {
    verificationBoost += 5;
    if (post.achievement?.verificationStatus === 'verified') {
      verificationBoost += 15;
    }
  }
  if (post.pinnedAt) {
    verificationBoost += 10;
  }

  return (
    likes * 1 +
    comments * 2 +
    saves * 3 +
    shares * 3 +
    verificationBoost +
    freshnessBoost -
    reports * 5
  );
}

/**
 * Recompute and persist trending score for a post.
 * @param {string|object} postIdOrDoc
 */
async function refreshTrendingScore(postIdOrDoc) {
  const { Post } = require('./post.model');
  const post =
    typeof postIdOrDoc === 'object' && postIdOrDoc?._id
      ? postIdOrDoc
      : await Post.findById(postIdOrDoc).lean();
  if (!post || post.status !== POST_STATUS.PUBLISHED) {
    return null;
  }

  const { User } = require('../auth/user.model');
  const author = await User.findById(post.authorId)
    .select('role verificationLevel')
    .lean();
  const score = computeTrendingScore(post, author);
  await Post.updateOne({ _id: post._id }, { $set: { trendingScore: score } });
  return score;
}

module.exports = { computeTrendingScore, refreshTrendingScore };
