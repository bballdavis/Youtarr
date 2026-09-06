/* eslint-env jest */
const express = require('express');
const request = require('supertest');
jest.mock('../../modules/videoLocalStatus', () => ({ applyLocalVideoStatus: jest.fn() }));
jest.mock('../../modules/download/videoActivity', () => ({ snapshot: jest.fn() }));
const { applyLocalVideoStatus } = require('../../modules/videoLocalStatus');
const activity = require('../../modules/download/videoActivity');

describe('video activity endpoints', () => {
  let app;
  let enqueue;
  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.log = { error: jest.fn() }; next(); });
    const verifyToken = (req, res, next) => req.headers['x-access-token'] ? next() : res.sendStatus(401);
    enqueue = jest.fn().mockResolvedValue({ queued: 0, acceptedIds: [], alreadyActiveIds: ['aaaaaaaaaaa'] });
    const downloadModule = { doGroupedManualDownloads: enqueue };
    app.use(require('../videos')({ verifyToken, videosModule: {}, downloadModule, videoLocalStatus: { applyLocalVideoStatus } }));
    app.use(require('../jobs')({ verifyToken, jobModule: {}, downloadModule, videoActivity: activity }));
  });

  it('requires authentication for snapshots and local metadata', async () => {
    await request(app).get('/api/jobs/video-activity').expect(401);
    await request(app).post('/api/videos/local-status').send({ youtubeIds: [] }).expect(401);
    expect(activity.snapshot).not.toHaveBeenCalled();
    expect(applyLocalVideoStatus).not.toHaveBeenCalled();
  });

  it('returns the current activity snapshot', async () => {
    const snapshot = { instanceId: 'server', revision: 1, videos: { aaaaaaaaaaa: { jobId: 'job', state: 'queued' } } };
    activity.snapshot.mockReturnValue(snapshot);
    const response = await request(app).get('/api/jobs/video-activity').set('x-access-token', 'token').expect(200);
    expect(response.body).toEqual(snapshot);
  });

  it('validates and deduplicates local-status IDs', async () => {
    await request(app).post('/api/videos/local-status').set('x-access-token', 'token').send({ youtubeIds: ['invalid'] }).expect(400);
    await request(app).post('/api/videos/local-status').set('x-access-token', 'token').send({ youtubeIds: Array(501).fill('aaaaaaaaaaa') }).expect(400);
    applyLocalVideoStatus.mockImplementation(async results => { results[0].status = 'downloaded'; });
    const response = await request(app).post('/api/videos/local-status').set('x-access-token', 'token')
      .send({ youtubeIds: ['aaaaaaaaaaa', 'aaaaaaaaaaa'] }).expect(200);
    expect(response.body.results).toEqual([{ youtubeId: 'aaaaaaaaaaa', status: 'downloaded' }]);
  });

  it('reports already-active submissions without pretending to enqueue a job', async () => {
    const response = await request(app).post('/triggerspecificdownloads').set('x-access-token', 'token')
      .send({ urls: ['https://youtu.be/aaaaaaaaaaa'] }).expect(200);
    expect(response.body).toMatchObject({ queued: 0, alreadyActiveIds: ['aaaaaaaaaaa'] });
  });

  it('reports enqueue failure instead of returning early success', async () => {
    enqueue.mockRejectedValue(new Error('database unavailable'));
    await request(app).post('/triggerspecificdownloads').set('x-access-token', 'token')
      .send({ urls: ['https://youtu.be/aaaaaaaaaaa'] }).expect(500);
  });
});
