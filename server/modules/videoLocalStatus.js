const { Video } = require('../models');

async function applyLocalVideoStatus(results) {
  const youtubeIds = results.map(r => r.youtubeId).filter(Boolean);
  if (youtubeIds.length === 0) return;
  const existing = await Video.findAll({
    where: { youtubeId: youtubeIds },
    attributes: [
      'id',
      'youtubeId',
      'removed',
      'filePath',
      'fileSize',
      'audioFilePath',
      'audioFileSize',
      'last_downloaded_at',
      'protected',
      'normalized_rating',
      'rating_source',
    ],
  });
  const recordByYoutubeId = new Map(existing.map(v => [v.youtubeId, v]));
  for (const r of results) {
    const record = recordByYoutubeId.get(r.youtubeId);
    if (!record) continue;
    r.status = record.removed ? 'missing' : 'downloaded';
    r.databaseId = record.id;
    r.filePath = record.filePath;
    r.fileSize = record.fileSize;
    r.audioFilePath = record.audioFilePath;
    r.audioFileSize = record.audioFileSize;
    r.addedAt = record.last_downloaded_at ? new Date(record.last_downloaded_at).toISOString() : null;
    r.isProtected = Boolean(record.protected);
    r.normalizedRating = record.normalized_rating;
    r.ratingSource = record.rating_source;
  }
}

module.exports = { applyLocalVideoStatus };
