'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const {
  parsePayload,
  runImmediateBroadcast,
  scheduleBroadcast,
  listBroadcasts,
  cancelBroadcast,
} = require('./scheduled-broadcast.service');

/**
 * Admin notification broadcasts — Wave 5 NOTIF-S04 + NOTIF-S07.
 */
class AdminNotificationsController {
  broadcast = asyncHandler(async (req, res) => {
    const body = req.body || {};
    const payload = parsePayload(body);

    if (body.scheduleAt) {
      const data = await scheduleBroadcast({
        body,
        adminId: req.admin?._id || null,
      });
      return ApiResponse.success(res, {
        statusCode: HTTP_STATUS.CREATED,
        message: 'Broadcast scheduled',
        data: { scheduled: true, broadcast: data },
      });
    }

    const data = await runImmediateBroadcast(payload);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Broadcast queued',
      data: { scheduled: false, ...data },
    });
  });

  list = asyncHandler(async (req, res) => {
    const data = await listBroadcasts({
      status: req.query.status,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Broadcasts',
      data,
    });
  });

  cancel = asyncHandler(async (req, res) => {
    const data = await cancelBroadcast(req.params.id);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Broadcast cancelled',
      data,
    });
  });
}

const adminNotificationsController = new AdminNotificationsController();

module.exports = { adminNotificationsController };
