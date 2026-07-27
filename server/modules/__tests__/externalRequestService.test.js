const { createExternalRequestService, RequestError } = require('../externalRequestService');

const timestamp = new Date('2026-07-26T12:00:00.000Z');
const youtubeId = 'abcdefghijk';

function record(overrides = {}) {
  return {
    id: '9b89e5bc-8c90-4e72-b245-270fed2eacc2',
    api_key_id: 4,
    channel_id: 8,
    youtube_id: youtubeId,
    request_type: 'video',
    status: 'pending',
    created_at: timestamp,
    updated_at: timestamp,
    decided_at: null,
    completed_at: null,
    message: null,
    update: jest.fn(async function update(values) {
      Object.assign(this, values);
    }),
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const created = record();
  const models = {
    ExternalRequest: {
      create: jest.fn(async (values) => Object.assign(created, values)),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    },
    ApiKeyChannelGrant: { findOne: jest.fn().mockResolvedValue({ id: 1 }) },
    Channel: {
      findByPk: jest.fn().mockResolvedValue({
        id: 8, channel_id: 'UC1234567890123456789012', enabled: true, default_rating: 'TV-Y',
      }),
    },
    ChannelVideo: {
      findOne: jest.fn().mockResolvedValue({
        youtube_id: youtubeId, media_type: 'video', youtube_removed: false, ignored: false,
      }),
    },
    Video: { findOne: jest.fn().mockResolvedValue(null), findAll: jest.fn().mockResolvedValue([]) },
    Job: { findAll: jest.fn().mockResolvedValue([]) },
    ...overrides.models,
  };
  const executor = jest.fn().mockResolvedValue(undefined);
  const service = createExternalRequestService({
    models,
    executor: overrides.executor || executor,
    now: () => timestamp,
  });
  const key = {
    id: 4,
    name: 'Plinx',
    role: 'request',
    autoApproveVideoRequests: false,
    maxRatingLevel: 2,
    allowUnrated: false,
    allowedMediaTypes: ['video'],
    ...overrides.key,
  };
  return { service, models, executor, key, created };
}

describe('external video request service', () => {
  test('persists a pending request without executing a download', async () => {
    const { service, models, executor, key } = fixture();
    const result = await service.createVideoRequest(key, { youtubeId, channelId: 8 });
    expect(result).toMatchObject({
      outcome: 'created',
      request: { type: 'video', status: 'pending', target: { youtubeId, channelId: 8 } },
    });
    expect(models.ExternalRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      api_key_id: 4,
      active_dedupe_key: `4:video:${youtubeId}`,
      status: 'pending',
    }));
    expect(executor).not.toHaveBeenCalled();
  });

  test('auto-approval queues only the canonical URL and server-owned channel mapping', async () => {
    const { service, models, executor, key } = fixture({
      key: { autoApproveVideoRequests: true },
    });
    const result = await service.createVideoRequest(key, {
      youtubeId, channelId: 8, idempotencyKey: 'plinx-1',
    });
    expect(models.ExternalRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      decided_at: timestamp,
      idempotency_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(executor).toHaveBeenCalledWith({
      body: {
        urls: [`https://www.youtube.com/watch?v=${youtubeId}`],
        channelId: 'UC1234567890123456789012',
        ownerChannelMap: { [youtubeId]: 'UC1234567890123456789012' },
        initiatedBy: { type: 'api_key', name: 'Plinx' },
        jobLabel: 'External video request',
        externalRequestId: '9b89e5bc-8c90-4e72-b245-270fed2eacc2',
      },
    });
    expect(result.request.status).toBe('processing');
  });

  test('resumes an interrupted auto-approved dispatch with the stable request job id', async () => {
    const interrupted = record({ status: 'pending', decided_at: timestamp, job_id: null });
    const retryExecutor = jest.fn().mockResolvedValue(interrupted.id);
    const retry = fixture({
      key: { autoApproveVideoRequests: true },
      executor: retryExecutor,
    });
    retry.models.ExternalRequest.findOne.mockResolvedValue(interrupted);
    const result = await retry.service.createVideoRequest(
      retry.key,
      { youtubeId, channelId: 8, idempotencyKey: 'same-request' }
    );
    expect(retry.models.ExternalRequest.create).not.toHaveBeenCalled();
    expect(retryExecutor).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ externalRequestId: interrupted.id }),
    }));
    expect(interrupted.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processing',
      job_id: interrupted.id,
    }));
    expect(result).toMatchObject({
      outcome: 'duplicate',
      request: { status: 'processing' },
    });
  });

  test('fails closed for missing grants, unknown media, and ratings above policy', async () => {
    const missingGrant = fixture();
    missingGrant.models.ApiKeyChannelGrant.findOne.mockResolvedValue(null);
    await expect(missingGrant.service.createVideoRequest(
      missingGrant.key, { youtubeId, channelId: 8 }
    )).rejects.toMatchObject({ status: 404 });

    const unknownMedia = fixture();
    unknownMedia.models.ChannelVideo.findOne.mockResolvedValue({
      youtube_id: youtubeId, media_type: 'unknown', youtube_removed: false, ignored: false,
    });
    await expect(unknownMedia.service.createVideoRequest(
      unknownMedia.key, { youtubeId, channelId: 8 }
    )).rejects.toMatchObject({ status: 403 });

    const mature = fixture();
    mature.models.Channel.findByPk.mockResolvedValue({
      id: 8, channel_id: 'UC1234567890123456789012', enabled: true, default_rating: 'R',
    });
    await expect(mature.service.createVideoRequest(
      mature.key, { youtubeId, channelId: 8 }
    )).rejects.toMatchObject({ status: 403 });
  });

  test('returns downloaded and concurrent duplicate outcomes without a second row', async () => {
    const downloaded = fixture();
    downloaded.models.Video.findOne.mockResolvedValue({
      youtubeId, normalized_rating: 'TV-Y', removed: false,
    });
    await expect(downloaded.service.createVideoRequest(
      downloaded.key, { youtubeId, channelId: 8 }
    )).resolves.toEqual({ outcome: 'already_downloaded', request: null });
    expect(downloaded.models.ExternalRequest.create).not.toHaveBeenCalled();

    const duplicateRecord = record({ status: 'processing' });
    const duplicate = fixture();
    duplicate.models.ExternalRequest.findOne.mockResolvedValue(duplicateRecord);
    const result = await duplicate.service.createVideoRequest(
      duplicate.key, { youtubeId, channelId: 8 }
    );
    expect(result).toMatchObject({ outcome: 'duplicate', request: { status: 'processing' } });
    expect(duplicate.models.ExternalRequest.create).not.toHaveBeenCalled();
  });

  test('returns the winning row when the database unique key resolves a create race', async () => {
    const duplicateRecord = record({ status: 'pending' });
    const concurrent = fixture();
    concurrent.models.ExternalRequest.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(duplicateRecord);
    concurrent.models.ExternalRequest.create.mockRejectedValue(
      Object.assign(new Error('duplicate'), { name: 'SequelizeUniqueConstraintError' })
    );
    await expect(concurrent.service.createVideoRequest(
      concurrent.key, { youtubeId, channelId: 8 }
    )).resolves.toMatchObject({ outcome: 'duplicate', request: { id: duplicateRecord.id } });
  });

  test('marks queue failures terminal so a retry is possible', async () => {
    const queueError = new Error('secret executor failure');
    const failed = fixture({
      key: { autoApproveVideoRequests: true },
      executor: jest.fn().mockRejectedValue(queueError),
    });
    const result = await failed.service.createVideoRequest(
      failed.key, { youtubeId, channelId: 8 }
    );
    expect(failed.created.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      active_dedupe_key: null,
      message: 'Download could not be queued',
    }));
    expect(result.request).toMatchObject({
      status: 'failed',
      message: 'Download could not be queued',
    });
    expect(result.request.message).not.toContain('secret');
  });

  test('lists only the calling key and lazily reconciles completed downloads', async () => {
    const processing = record({ status: 'processing' });
    const own = fixture();
    own.models.ExternalRequest.findAndCountAll.mockResolvedValue({ rows: [processing], count: 1 });
    own.models.Video.findAll.mockResolvedValue([{ youtubeId }]);
    const result = await own.service.listRequests(own.key, {
      page: '1', pageSize: '10', status: 'processing',
    });
    expect(own.models.ExternalRequest.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { api_key_id: 4, status: 'processing' },
      limit: 10,
      offset: 0,
    }));
    expect(processing.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      active_dedupe_key: null,
      completed_at: timestamp,
    }));
    expect(result.data[0].status).toBe('completed');
  });

  test.each(['Error', 'Killed', 'Terminated'])(
    'reconciles a %s downloader job to a retryable failed request',
    async (jobStatus) => {
      const processing = record({ status: 'processing', job_id: 'job-123' });
      const own = fixture();
      own.models.ExternalRequest.findAndCountAll.mockResolvedValue({ rows: [processing], count: 1 });
      own.models.Job.findAll.mockResolvedValue([{ id: 'job-123', status: jobStatus }]);
      const result = await own.service.listRequests(own.key, {});
      expect(own.models.Job.findAll).toHaveBeenCalledWith({
        where: { id: ['job-123'] },
        attributes: ['id', 'status'],
      });
      expect(processing.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        active_dedupe_key: null,
        message: 'Download did not complete',
      }));
      expect(result.data[0]).toMatchObject({
        status: 'failed',
        message: 'Download did not complete',
      });
    }
  );

  test('validates scope, body fields, paging, and status allowlists', async () => {
    const { service, key } = fixture();
    await expect(service.createVideoRequest(
      { ...key, role: 'view' }, { youtubeId, channelId: 8 }
    )).rejects.toBeInstanceOf(RequestError);
    await expect(service.createVideoRequest(
      key, { youtubeId, channelId: 8, resolution: '2160' }
    )).rejects.toThrow('unsupported');
    await expect(service.createVideoRequest(key, { youtubeId })).rejects.toThrow('channelId is required');
    await expect(service.listRequests(key, { status: 'DROP TABLE' })).rejects.toThrow('status');
    await expect(service.listRequests(key, { pageSize: '101' })).rejects.toThrow('pageSize');
  });
});
