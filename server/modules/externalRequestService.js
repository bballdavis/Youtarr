const crypto = require('crypto');
const { Op, UniqueConstraintError } = require('sequelize');
const ratingMapper = require('./ratingMapper');
const { normalizePolicy } = require('./externalCatalogService');

const REQUEST_STATUSES = [
  'pending', 'approved', 'processing', 'completed',
  'rejected', 'failed', 'cancelled',
];
const ACTIVE_STATUSES = ['pending', 'approved', 'processing'];
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

function parseInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) throw new RequestError(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RequestError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function dto(record) {
  const value = record.toJSON ? record.toJSON() : record;
  return {
    id: value.id,
    type: 'video',
    status: value.status,
    target: { youtubeId: value.youtube_id, channelId: value.channel_id },
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    ...(value.decided_at ? { decidedAt: value.decided_at } : {}),
    ...(value.completed_at ? { completedAt: value.completed_at } : {}),
    ...(value.message ? { message: value.message } : {}),
  };
}

function normalizeStoredKey(record) {
  const value = record?.toJSON ? record.toJSON() : record;
  if (!value) return null;
  return {
    id: value.id,
    name: value.name,
    role: value.role,
    isActive: value.is_active,
    revokedAt: value.revoked_at,
    autoApproveVideoRequests: value.auto_approve_video_requests,
    maxRatingLevel: value.max_rating_level,
    allowUnrated: value.allow_unrated,
    allowedMediaTypes: value.allowed_media_types,
  };
}

function sanitizeReason(value) {
  if (typeof value !== 'string') {
    throw new RequestError('reason is required');
  }
  // eslint-disable-next-line no-control-regex
  const sanitized = value.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (sanitized.length < 1 || sanitized.length > 300) {
    throw new RequestError('reason must be between 1 and 300 characters');
  }
  return sanitized;
}

function adminDto(record, catalogVideo = null) {
  const value = record.toJSON ? record.toJSON() : record;
  const key = value.apiKey || value.api_key || null;
  const channel = value.channel || null;
  const job = value.job || null;
  return {
    ...dto(record),
    requester: key ? {
      id: key.id,
      name: key.name,
      keyPrefix: key.key_prefix,
      role: key.role,
      isActive: key.is_active === true,
      revokedAt: key.revoked_at || null,
    } : null,
    target: {
      youtubeId: value.youtube_id,
      channelId: value.channel_id,
      youtubeChannelId: channel?.channel_id || null,
      channelTitle: channel?.title || channel?.uploader || null,
      title: catalogVideo?.title || null,
      mediaType: catalogVideo?.media_type || null,
      contentRating: catalogVideo?.content_rating || channel?.default_rating || null,
    },
    job: job ? {
      id: job.id,
      status: job.status,
      type: job.jobType,
      createdAt: job.timeCreated,
      startedAt: job.timeInitiated,
    } : null,
  };
}

function createExternalRequestService({
  models = require('../models'),
  executor = (jobData) => require('./downloadModule').doGroupedManualDownloads(jobData),
  now = () => new Date(),
  sequelize = require('../db').sequelize,
} = {}) {
  const {
    ExternalRequest, ApiKey, ApiKeyChannelGrant, Channel, ChannelVideo, Video, Job,
  } = models;

  async function reconcile(records) {
    const processing = records.filter((record) => record.status === 'processing');
    const youtubeIds = [...new Set(processing.map((record) => record.youtube_id))];
    if (youtubeIds.length === 0) return records;
    const videos = await Video.findAll({
      where: { youtubeId: youtubeIds, removed: false },
      attributes: ['youtubeId'],
    });
    const completed = new Set(videos.map((video) => video.youtubeId));
    const completedAt = now();
    const completedRecords = processing.filter((record) => completed.has(record.youtube_id));
    await Promise.all(completedRecords.map(async (record) => {
      await record.update({
        status: 'completed',
        active_dedupe_key: null,
        completed_at: completedAt,
        updated_at: completedAt,
      });
    }));
    const unresolved = processing.filter(
      (record) => !completed.has(record.youtube_id) && record.job_id
    );
    if (unresolved.length > 0) {
      const jobs = await Job.findAll({
        where: { id: [...new Set(unresolved.map((record) => record.job_id))] },
        attributes: ['id', 'status'],
      });
      const terminalFailures = new Set(
        jobs
          .filter((job) => ['Error', 'Killed', 'Terminated'].includes(job.status))
          .map((job) => job.id)
      );
      await Promise.all(unresolved
        .filter((record) => terminalFailures.has(record.job_id))
        .map((record) => record.update({
          status: 'failed',
          active_dedupe_key: null,
          message: 'Download did not complete',
          updated_at: completedAt,
        })));
    }
    return records;
  }

  async function validateTarget(key, youtubeId, channelId, transaction = null) {
    const policy = normalizePolicy(key);
    const queryOptions = transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {};
    const grant = await ApiKeyChannelGrant.findOne({
      where: { api_key_id: key.id, channel_id: channelId },
      ...queryOptions,
    });
    const channel = await Channel.findByPk(channelId, {
      attributes: ['id', 'channel_id', 'enabled', 'default_rating'],
      ...queryOptions,
    });
    if (!grant || !channel || channel.enabled !== true || !channel.channel_id) {
      throw new RequestError('Video not found', 404);
    }
    const cached = await ChannelVideo.findOne({
      where: { youtube_id: youtubeId, channel_id: channel.channel_id },
      attributes: ['youtube_id', 'media_type', 'youtube_removed', 'ignored'],
      ...queryOptions,
    });
    if (!cached || cached.youtube_removed !== false || cached.ignored !== false) {
      throw new RequestError('Video not found', 404);
    }
    if (!['video', 'short', 'livestream'].includes(cached.media_type)) {
      throw new RequestError('Video is not eligible', 403);
    }
    if (!policy.allowedMediaTypes.includes(cached.media_type)) {
      throw new RequestError('Video is not eligible', 403);
    }
    const storedVideo = await Video.findOne({
      where: { youtubeId },
      attributes: ['youtubeId', 'normalized_rating', 'removed'],
      ...queryOptions,
    });
    if (storedVideo && storedVideo.removed !== true && storedVideo.removed !== false) {
      throw new RequestError('Video is not eligible', 403);
    }
    const downloaded = storedVideo?.removed === false ? storedVideo : null;
    const effectiveRating = storedVideo?.normalized_rating || channel.default_rating || null;
    const numericRating = ratingMapper.mapToNumericRating(effectiveRating);
    if ((effectiveRating !== null && numericRating === null) ||
        (numericRating === null && !policy.allowUnrated) ||
        (numericRating !== null && numericRating > policy.maxRatingLevel)) {
      throw new RequestError('Video is not eligible', 403);
    }
    return { channel, downloaded };
  }

  const adminIncludes = () => [
    {
      model: ApiKey,
      as: 'apiKey',
      attributes: [
        'id', 'name', 'key_prefix', 'role', 'is_active', 'revoked_at',
        'auto_approve_video_requests', 'max_rating_level', 'allow_unrated',
        'allowed_media_types',
      ],
      required: true,
    },
    {
      model: Channel,
      as: 'channel',
      attributes: ['id', 'channel_id', 'title', 'uploader', 'default_rating'],
      required: true,
    },
    {
      model: Job,
      as: 'job',
      attributes: ['id', 'status', 'jobType', 'timeCreated', 'timeInitiated'],
      required: false,
    },
  ];

  async function catalogMetadata(records) {
    const youtubeIds = [...new Set(records.map((record) => record.youtube_id))];
    if (youtubeIds.length === 0) return new Map();
    const rows = await ChannelVideo.findAll({
      where: { youtube_id: youtubeIds },
      attributes: ['youtube_id', 'channel_id', 'title', 'media_type'],
    });
    const videos = await Video.findAll({
      where: { youtubeId: youtubeIds },
      attributes: ['youtubeId', 'normalized_rating'],
    });
    const videoById = new Map(videos.map((row) => {
      const value = row.toJSON ? row.toJSON() : row;
      return [value.youtubeId, value];
    }));
    return new Map(rows.map((row) => {
      const value = row.toJSON ? row.toJSON() : row;
      return [`${value.channel_id}:${value.youtube_id}`, value];
    }).map(([key, value]) => {
      const stored = videoById.get(value.youtube_id);
      return [key, {
        ...value,
        content_rating: stored?.normalized_rating || null,
      }];
    }));
  }

  async function adminDtos(records) {
    const metadata = await catalogMetadata(records);
    return records.map((record) => {
      const value = record.toJSON ? record.toJSON() : record;
      const channel = value.channel;
      return adminDto(
        record,
        metadata.get(`${channel?.channel_id || ''}:${value.youtube_id}`) || null
      );
    });
  }

  async function findDuplicate(keyId, activeDedupeKey, idempotencyHash, youtubeId, channelId) {
    const clauses = [{ active_dedupe_key: activeDedupeKey }];
    if (idempotencyHash) clauses.push({ api_key_id: keyId, idempotency_hash: idempotencyHash });
    const existing = await ExternalRequest.findOne({ where: { [Op.or]: clauses } });
    if (!existing) return null;
    if (existing.youtube_id !== youtubeId || existing.channel_id !== channelId) {
      throw new RequestError('Idempotency key was already used for another target', 409);
    }
    await reconcile([existing]);
    return existing;
  }

  async function dispatchAutoApproved(record, key, channel) {
    try {
      const jobId = await executor({
        body: {
          urls: [`https://www.youtube.com/watch?v=${record.youtube_id}`],
          channelId: channel.channel_id,
          ownerChannelMap: { [record.youtube_id]: channel.channel_id },
          initiatedBy: { type: 'api_key', name: key.name },
          jobLabel: 'External video request',
          // The downloader uses this UUID as the job identity. A retry after a
          // crash can therefore observe/reuse the accepted job instead of
          // starting the same download twice.
          externalRequestId: record.id,
        },
      });
      const acceptedAt = now();
      await record.update({
        status: 'processing',
        job_id: jobId || record.id,
        updated_at: acceptedAt,
      });
    } catch (error) {
      const failedAt = now();
      await record.update({
        status: 'failed',
        active_dedupe_key: null,
        message: 'Download could not be queued',
        updated_at: failedAt,
      });
    }
    return record;
  }

  async function createVideoRequest(key, input) {
    if (!['request', 'delete', 'admin'].includes(key.role)) {
      throw new RequestError('video:request scope is required', 403);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new RequestError('Request body must be an object');
    }
    const supported = ['youtubeId', 'channelId', 'idempotencyKey'];
    if (Object.keys(input).some((name) => !supported.includes(name))) {
      throw new RequestError('Request body contains unsupported fields');
    }
    if (typeof input.youtubeId !== 'string' || !VIDEO_ID_PATTERN.test(input.youtubeId)) {
      throw new RequestError('youtubeId must be an 11-character YouTube video ID');
    }
    if (input.channelId === undefined) throw new RequestError('channelId is required');
    const channelId = parseInteger(input.channelId, null, 1, Number.MAX_SAFE_INTEGER, 'channelId');
    let idempotencyHash = null;
    if (input.idempotencyKey !== undefined) {
      if (typeof input.idempotencyKey !== 'string' ||
          input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200) {
        throw new RequestError('idempotencyKey must be a string of 1 to 200 characters');
      }
      idempotencyHash = crypto.createHash('sha256').update(input.idempotencyKey).digest('hex');
    }
    const { channel, downloaded } = await validateTarget(key, input.youtubeId, channelId);
    if (downloaded) return { outcome: 'already_downloaded', request: null };

    const activeDedupeKey = `${key.id}:video:${input.youtubeId}`;
    const existing = await findDuplicate(
      key.id, activeDedupeKey, idempotencyHash, input.youtubeId, channelId
    );
    if (existing) {
      // Auto-approved requests are created as pending before enqueue. If the
      // process stopped in that boundary, an idempotent client retry resumes
      // dispatch with the request UUID as the stable downloader job ID.
      if (existing.status === 'pending' && existing.decided_at && !existing.job_id) {
        await dispatchAutoApproved(existing, key, channel);
      }
      return { outcome: 'duplicate', request: dto(existing) };
    }

    const timestamp = now();
    const autoApprove = key.autoApproveVideoRequests === true;
    let record;
    try {
      record = await ExternalRequest.create({
        api_key_id: key.id,
        channel_id: channelId,
        youtube_id: input.youtubeId,
        request_type: 'video',
        status: 'pending',
        active_dedupe_key: activeDedupeKey,
        idempotency_hash: idempotencyHash,
        decided_at: autoApprove ? timestamp : null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError) && error.name !== 'SequelizeUniqueConstraintError') {
        throw error;
      }
      const duplicate = await findDuplicate(
        key.id, activeDedupeKey, idempotencyHash, input.youtubeId, channelId
      );
      if (!duplicate) throw error;
      return { outcome: 'duplicate', request: dto(duplicate) };
    }

    if (autoApprove) {
      await dispatchAutoApproved(record, key, channel);
    }
    return { outcome: 'created', request: dto(record) };
  }

  async function listRequests(key, query = {}) {
    const page = parseInteger(query.page, 1, 1, 1000000, 'page');
    const pageSize = parseInteger(query.pageSize, 50, 1, 100, 'pageSize');
    const status = query.status;
    if (status !== undefined && !REQUEST_STATUSES.includes(status)) {
      throw new RequestError(`status must be one of: ${REQUEST_STATUSES.join(', ')}`);
    }
    const where = { api_key_id: key.id, ...(status ? { status } : {}) };
    const result = await ExternalRequest.findAndCountAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    // A filtered page is a consistent snapshot of the stored status. Mutating
    // rows after the filtered count would make the response contradict its
    // own predicate and pagination. Unfiltered polling/detail reads perform
    // lazy terminal reconciliation.
    if (!status) await reconcile(result.rows);
    return {
      data: result.rows.map(dto),
      pagination: {
        page,
        pageSize,
        total: result.count,
        totalPages: result.count === 0 ? 0 : Math.ceil(result.count / pageSize),
      },
    };
  }

  async function getRequest(key, id) {
    if (typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new RequestError('Request not found', 404);
    }
    const record = await ExternalRequest.findOne({ where: { id, api_key_id: key.id } });
    if (!record) throw new RequestError('Request not found', 404);
    await reconcile([record]);
    return dto(record);
  }

  async function listAdminRequests(query = {}) {
    const page = parseInteger(query.page, 1, 1, 1000000, 'page');
    const pageSize = parseInteger(query.pageSize, 50, 1, 100, 'pageSize');
    const status = query.status;
    if (status !== undefined && !REQUEST_STATUSES.includes(status)) {
      throw new RequestError(`status must be one of: ${REQUEST_STATUSES.join(', ')}`);
    }
    const apiKeyId = query.apiKeyId === undefined
      ? null
      : parseInteger(query.apiKeyId, null, 1, Number.MAX_SAFE_INTEGER, 'apiKeyId');
    const where = {
      request_type: 'video',
      ...(status ? { status } : {}),
      ...(apiKeyId ? { api_key_id: apiKeyId } : {}),
    };
    const result = await ExternalRequest.findAndCountAll({
      where,
      include: adminIncludes(),
      distinct: true,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    if (!status) await reconcile(result.rows);
    const requesters = await ApiKey.findAll({
      attributes: ['id', 'name', 'key_prefix', 'role', 'is_active', 'revoked_at'],
      order: [['name', 'ASC'], ['id', 'ASC']],
    });
    return {
      data: await adminDtos(result.rows),
      pagination: {
        page,
        pageSize,
        total: result.count,
        totalPages: result.count === 0 ? 0 : Math.ceil(result.count / pageSize),
      },
      filterOptions: {
        requesters: requesters.map((key) => {
          const value = key.toJSON ? key.toJSON() : key;
          return {
            id: value.id,
            name: value.name,
            keyPrefix: value.key_prefix,
            role: value.role,
            isActive: value.is_active === true,
            revokedAt: value.revoked_at || null,
          };
        }),
      },
    };
  }

  async function getAdminRequest(id) {
    if (typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new RequestError('Request not found', 404);
    }
    const record = await ExternalRequest.findOne({
      where: { id, request_type: 'video' },
      include: adminIncludes(),
    });
    if (!record) throw new RequestError('Request not found', 404);
    await reconcile([record]);
    return (await adminDtos([record]))[0];
  }

  async function reviewVideoRequest(id, action, input = {}) {
    if (typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new RequestError('Request not found', 404);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new RequestError('Request body must be an object');
    }
    if (!['approve', 'reject'].includes(action)) {
      throw new RequestError('Unsupported review action');
    }
    const allowedFields = action === 'reject' ? ['reason'] : [];
    if (Object.keys(input).some((field) => !allowedFields.includes(field))) {
      throw new RequestError('Request body contains unsupported fields');
    }
    const reason = action === 'reject' ? sanitizeReason(input.reason) : null;

    await sequelize.transaction(async (transaction) => {
      const record = await ExternalRequest.findOne({
        where: { id, request_type: 'video' },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!record) throw new RequestError('Request not found', 404);

      if (action === 'reject') {
        if (record.status !== 'pending') {
          throw new RequestError('Only pending requests can be rejected', 409);
        }
        const rejectedAt = now();
        await record.update({
          status: 'rejected',
          active_dedupe_key: null,
          message: reason,
          decided_at: rejectedAt,
          updated_at: rejectedAt,
        }, { transaction });
        return;
      }

      if (record.status !== 'pending' &&
          !(record.status === 'approved' && !record.job_id)) {
        throw new RequestError('Only pending requests can be approved', 409);
      }

      const failApproval = async (message) => {
        const failedAt = now();
        await record.update({
          status: 'failed',
          active_dedupe_key: null,
          message,
          decided_at: record.decided_at || failedAt,
          updated_at: failedAt,
        }, { transaction });
      };

      const storedKey = await ApiKey.findByPk(record.api_key_id, {
        attributes: [
          'id', 'name', 'role', 'is_active', 'revoked_at',
          'auto_approve_video_requests', 'max_rating_level', 'allow_unrated',
          'allowed_media_types',
        ],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const key = normalizeStoredKey(storedKey);
      if (!key || key.isActive !== true || key.revokedAt ||
          !['request', 'delete', 'admin'].includes(key.role)) {
        await failApproval('Request is no longer eligible');
        return;
      }

      let target;
      try {
        target = await validateTarget(key, record.youtube_id, record.channel_id, transaction);
      } catch (error) {
        if (!(error instanceof RequestError) && error.name !== 'CatalogError') throw error;
        await failApproval('Request is no longer eligible');
        return;
      }
      if (target.downloaded) {
        const completedAt = now();
        await record.update({
          status: 'completed',
          active_dedupe_key: null,
          message: 'Video is already downloaded',
          decided_at: record.decided_at || completedAt,
          completed_at: completedAt,
          updated_at: completedAt,
        }, { transaction });
        return;
      }

      const duplicate = await ExternalRequest.findOne({
        where: {
          id: { [Op.ne]: record.id },
          active_dedupe_key: `${record.api_key_id}:video:${record.youtube_id}`,
          status: { [Op.in]: ACTIVE_STATUSES },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (duplicate) {
        await failApproval('Another active request already exists');
        return;
      }

      const approvedAt = now();
      if (record.status === 'pending') {
        await record.update({
          status: 'approved',
          decided_at: approvedAt,
          updated_at: approvedAt,
        }, { transaction });
      }
      try {
        const jobId = await executor({
          body: {
            urls: [`https://www.youtube.com/watch?v=${record.youtube_id}`],
            channelId: target.channel.channel_id,
            ownerChannelMap: { [record.youtube_id]: target.channel.channel_id },
            initiatedBy: { type: 'api_key', name: key.name },
            jobLabel: 'External video request',
            externalRequestId: record.id,
          },
        });
        const acceptedAt = now();
        await record.update({
          status: 'processing',
          job_id: jobId || record.id,
          updated_at: acceptedAt,
        }, { transaction });
      } catch (_error) {
        await failApproval('Download could not be queued');
      }
    });

    return getAdminRequest(id);
  }

  return {
    createVideoRequest,
    listRequests,
    getRequest,
    listAdminRequests,
    getAdminRequest,
    reviewVideoRequest,
  };
}

module.exports = {
  createExternalRequestService,
  RequestError,
  REQUEST_STATUSES,
  ACTIVE_STATUSES,
  dto,
  adminDto,
  sanitizeReason,
};
