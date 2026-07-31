const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { externalErrorBody } = require('../externalApiResponse');
const { dto } = require('../externalRequestService');

const fixtureDirectory = path.join(
  __dirname,
  '../../../fixtures/external-api-v1'
);
const fixtureBytes = fs.readFileSync(path.join(fixtureDirectory, 'contract.json'));
const fixture = JSON.parse(fixtureBytes.toString('utf8'));

describe('external API shared contract fixture', () => {
  test('covers the complete Plinx-consumed v1 surface', () => {
    expect(fixture.fixtureVersion).toBe(3);
    expect(fixture.capabilities).toEqual(expect.objectContaining({
      apiVersion: '1',
      policy: expect.objectContaining({
        allowedMediaTypes: expect.arrayContaining(['video', 'short']),
      }),
      quota: expect.any(Object),
      features: expect.objectContaining({ videoDetails: true }),
    }));
    expect(fixture.channelsPage.data).toHaveLength(2);
    expect(fixture.catalogPage.pagination.nextCursor).toEqual(expect.any(String));
    expect(fixture.catalogNextPage.pagination.nextCursor).toBeNull();
    expect(new Set(fixture.catalogPage.data.map((video) => video.mediaType)))
      .toEqual(new Set(['video', 'short', 'livestream']));
    expect(fixture.videoDetail.metadata).toEqual(expect.any(Object));
    expect(fixture.sparseVideoDetail.metadata).toBeNull();
    expect(fixture.videoRequestResponses.map((response) => response.outcome))
      .toEqual(['created', 'duplicate', 'already_downloaded']);
  });

  test('contains no credential-shaped fixture fields', () => {
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/x-api-key|x-access-token|key_hash|session-token/i);
  });

  test('matches the published cross-repository checksum', () => {
    const expected = fs.readFileSync(
      path.join(fixtureDirectory, 'SHA256SUMS'),
      'utf8'
    ).trim().split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(fixtureBytes).digest('hex');
    expect(actual).toBe(expected);
  });

  test('matches the versioned external error envelope', () => {
    expect(externalErrorBody(
      404,
      'External API route not found',
      { requestId: '00000000-0000-4000-8000-000000000001' }
    )).toEqual(fixture.error);
  });

  test.each(fixture.requests)('matches the $type request DTO', (expected) => {
    const record = {
      id: expected.id,
      request_type: expected.type,
      status: expected.status,
      youtube_id: expected.target.youtubeId,
      channel_id: expected.target.channelId,
      channel_url: expected.target.channelUrl,
      created_at: expected.createdAt,
      updated_at: expected.updatedAt,
      decided_at: expected.decidedAt,
      completed_at: expected.completedAt,
      message: expected.message,
      grant_to_requesting_key: expected.grantToRequestingKey,
    };
    expect(dto(record)).toEqual(expected);
  });
});
