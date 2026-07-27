const fs = require('fs').promises;
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../db');
const configModule = require('./configModule');
const ratingMapper = require('./ratingMapper');

const MEDIA_TYPES = ['video', 'short', 'livestream'];
const TAB_MEDIA_TYPES = { videos: 'video', shorts: 'short', streams: 'livestream' };
const RATINGS = ['G', 'TV-Y', 'TV-Y7', 'TV-G', 'PG', 'TV-PG', 'PG-13', 'TV-14', 'R', 'TV-MA', 'NC-17'];
const SAFE_THUMBNAIL_HOSTS = ['ytimg.com', 'ggpht.com', 'googleusercontent.com'];

class CatalogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CatalogError';
    this.status = status;
  }
}

function parseInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) throw new CatalogError(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CatalogError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function normalizeSearch(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 200) {
    throw new CatalogError('search must be a string of 200 characters or fewer');
  }
  return `%${value.trim().toLowerCase()}%`;
}

function normalizeDate(value, name, endOfDay = false) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 40) throw new CatalogError(`${name} must be a date`);
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) throw new CatalogError(`${name} must be a valid date`);
  return parsed.toISOString();
}

function normalizePolicy(policy) {
  const maxRatingLevel = policy?.maxRatingLevel;
  const allowUnrated = policy?.allowUnrated;
  const allowedMediaTypes = policy?.allowedMediaTypes;
  if (!Number.isInteger(maxRatingLevel) || maxRatingLevel < 1 || maxRatingLevel > 4 ||
      typeof allowUnrated !== 'boolean' || !Array.isArray(allowedMediaTypes) ||
      allowedMediaTypes.length === 0 ||
      allowedMediaTypes.some((type) => !MEDIA_TYPES.includes(type))) {
    throw new CatalogError('Invalid external API key policy', 401);
  }
  return {
    maxRatingLevel,
    allowUnrated,
    allowedMediaTypes: [...new Set(allowedMediaTypes)],
  };
}

function ratingSql(policy, effectiveRatingSql) {
  const recognizedRatings = RATINGS.filter((rating) => ratingMapper.mapToNumericRating(rating) !== null);
  const allowedRatings = recognizedRatings.filter(
    (rating) => ratingMapper.mapToNumericRating(rating) <= policy.maxRatingLevel
  );
  const clauses = [`${effectiveRatingSql} IN (:allowedRatings)`];
  if (policy.allowUnrated) {
    clauses.push(`(${effectiveRatingSql} IS NULL OR ${effectiveRatingSql} NOT IN (:recognizedRatings))`);
  }
  return {
    sql: `(${clauses.join(' OR ')})`,
    replacements: { allowedRatings, recognizedRatings },
  };
}

function pagination(query) {
  const page = parseInteger(query.page, 1, 1, 1000000, 'page');
  const pageSize = parseInteger(query.pageSize, 50, 1, 100, 'pageSize');
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function lastFetched(channel, mediaType = null) {
  try {
    const values = JSON.parse(channel.lastFetchedByTab || '{}');
    if (mediaType) return values[mediaType] || null;
    const dates = Object.values(values).filter(Boolean).map((value) => new Date(value));
    if (dates.length === 0 || dates.some((value) => Number.isNaN(value.getTime()))) return null;
    return new Date(Math.max(...dates.map((value) => value.getTime()))).toISOString();
  } catch (_error) {
    return null;
  }
}

function publicVideoThumbnail(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' ||
        !SAFE_THUMBNAIL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      return null;
    }
    return url.toString();
  } catch (_error) {
    return null;
  }
}

async function listChannels(key, query = {}) {
  const policy = normalizePolicy(key);
  const { page, pageSize, offset } = pagination(query);
  const search = normalizeSearch(query.search);
  const sortColumns = {
    title: 'title',
    videoCount: 'videoCount',
    downloadedCount: 'downloadedCount',
    id: 'id',
  };
  const sortBy = query.sortBy || 'title';
  if (!Object.prototype.hasOwnProperty.call(sortColumns, sortBy)) {
    throw new CatalogError('sortBy must be title, videoCount, downloadedCount, or id');
  }
  const sortOrder = (query.sortOrder || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(sortOrder)) throw new CatalogError('sortOrder must be asc or desc');

  const effectiveRating = 'COALESCE(v.normalized_rating, c.default_rating)';
  const ratings = ratingSql(policy, effectiveRating);
  const videoPolicy = `cv.youtube_removed = false AND cv.ignored = false
    AND cv.media_type IN (:allowedMediaTypes) AND ${ratings.sql}`;
  const whereSearch = search
    ? 'AND (LOWER(COALESCE(c.title, c.uploader, \'\')) LIKE :search OR LOWER(COALESCE(c.description, \'\')) LIKE :search)'
    : '';
  const replacements = {
    keyId: key.id, allowedMediaTypes: policy.allowedMediaTypes, search,
    pageSize, offset, ...ratings.replacements,
  };

  const countRows = await sequelize.query(
    `SELECT COUNT(*) AS total
       FROM channels c
       INNER JOIN api_key_channel_grants g
         ON g.channel_id = c.id AND g.api_key_id = :keyId
      WHERE c.enabled = true ${whereSearch}`,
    { replacements, type: QueryTypes.SELECT }
  );
  const rows = await sequelize.query(
    `SELECT c.id, c.channel_id, COALESCE(c.title, c.uploader, '') AS title,
            c.description, c.sub_folder, c.lastFetchedByTab,
            (SELECT COUNT(*) FROM channelvideos cv
               LEFT JOIN Videos v ON v.youtubeId = cv.youtube_id
              WHERE cv.channel_id = c.channel_id AND ${videoPolicy}) AS videoCount,
            (SELECT COUNT(*) FROM channelvideos cv
               INNER JOIN Videos v ON v.youtubeId = cv.youtube_id AND v.removed = false
              WHERE cv.channel_id = c.channel_id AND ${videoPolicy}) AS downloadedCount
       FROM channels c
       INNER JOIN api_key_channel_grants g
         ON g.channel_id = c.id AND g.api_key_id = :keyId
      WHERE c.enabled = true ${whereSearch}
      ORDER BY ${sortColumns[sortBy]} ${sortOrder.toUpperCase()}, c.id ASC
      LIMIT :pageSize OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }
  );
  const total = Number(countRows[0]?.total || 0);
  return {
    data: rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      title: row.title,
      descriptionSummary: row.description ? row.description.trim().slice(0, 240) : null,
      thumbnailUrl: `/external-api/v1/assets/channels/${row.id}/thumbnail`,
      subfolder: row.sub_folder || null,
      videoCount: Number(row.videoCount || 0),
      downloadedCount: Number(row.downloadedCount || 0),
      lastFetchedAt: lastFetched(row),
    })),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
    dataSource: 'cache',
  };
}

async function listChannelVideos(key, channelDatabaseId, query = {}) {
  const policy = normalizePolicy(key);
  const id = parseInteger(channelDatabaseId, null, 1, Number.MAX_SAFE_INTEGER, 'channel id');
  const { page, pageSize, offset } = pagination(query);
  const search = normalizeSearch(query.search);
  const tabType = query.tabType || 'videos';
  const mediaType = TAB_MEDIA_TYPES[tabType];
  if (!mediaType) throw new CatalogError('tabType must be videos, shorts, or streams');
  if (!policy.allowedMediaTypes.includes(mediaType)) throw new CatalogError('Media type is not allowed', 403);
  const sortColumns = { date: 'cv.publishedAt', title: 'cv.title', duration: 'cv.duration' };
  const sortBy = query.sortBy || 'date';
  if (!sortColumns[sortBy]) throw new CatalogError('sortBy must be date, title, or duration');
  const sortOrder = (query.sortOrder || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(sortOrder)) throw new CatalogError('sortOrder must be asc or desc');
  const minDuration = parseInteger(query.minDuration, null, 0, 604800, 'minDuration');
  const maxDuration = parseInteger(query.maxDuration, null, 0, 604800, 'maxDuration');
  if (minDuration !== null && maxDuration !== null && minDuration > maxDuration) {
    throw new CatalogError('minDuration cannot exceed maxDuration');
  }
  const dateFrom = normalizeDate(query.dateFrom, 'dateFrom');
  const dateTo = normalizeDate(query.dateTo, 'dateTo', true);
  if (dateFrom && dateTo && dateFrom > dateTo) throw new CatalogError('dateFrom cannot exceed dateTo');

  const channelRows = await sequelize.query(
    `SELECT c.id, c.channel_id, COALESCE(c.title, c.uploader, '') AS title, c.lastFetchedByTab
       FROM channels c
       INNER JOIN api_key_channel_grants g
         ON g.channel_id = c.id AND g.api_key_id = :keyId
      WHERE c.id = :channelDatabaseId AND c.enabled = true
      LIMIT 1`,
    { replacements: { keyId: key.id, channelDatabaseId: id }, type: QueryTypes.SELECT }
  );
  if (channelRows.length === 0) throw new CatalogError('Channel not found', 404);
  const channel = channelRows[0];
  const effectiveRating = 'COALESCE(v.normalized_rating, c.default_rating)';
  const ratings = ratingSql(policy, effectiveRating);
  const filters = [
    'cv.channel_id = c.channel_id',
    'cv.media_type = :mediaType',
    'cv.youtube_removed = false',
    'cv.ignored = false',
    ratings.sql,
  ];
  if (minDuration !== null) filters.push('cv.duration >= :minDuration');
  if (maxDuration !== null) filters.push('cv.duration <= :maxDuration');
  if (search) filters.push('LOWER(cv.title) LIKE :search');
  if (dateFrom) filters.push('cv.publishedAt >= :dateFrom');
  if (dateTo) filters.push('cv.publishedAt <= :dateTo');
  const replacements = {
    channelDatabaseId: id, mediaType, minDuration, maxDuration, search, dateFrom, dateTo,
    pageSize, offset, ...ratings.replacements,
  };
  const from = `FROM channelvideos cv
    INNER JOIN channels c ON c.id = :channelDatabaseId AND c.channel_id = cv.channel_id
    LEFT JOIN Videos v ON v.youtubeId = cv.youtube_id
    WHERE ${filters.join(' AND ')}`;
  const countRows = await sequelize.query(
    `SELECT COUNT(*) AS total ${from}`,
    { replacements, type: QueryTypes.SELECT }
  );
  const rows = await sequelize.query(
    `SELECT cv.youtube_id, cv.title, cv.thumbnail, cv.publishedAt, cv.published_at_source,
            cv.duration, cv.media_type, v.description, v.id AS downloaded_id,
            v.removed AS downloaded_removed, ${effectiveRating} AS rating
       ${from}
      ORDER BY ${sortColumns[sortBy]} ${sortOrder.toUpperCase()}, cv.youtube_id ASC
      LIMIT :pageSize OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }
  );
  const total = Number(countRows[0]?.total || 0);
  const lastIndexedAt = lastFetched(channel, mediaType);
  return {
    data: rows.map((row) => ({
      youtubeId: row.youtube_id,
      title: row.title,
      thumbnailUrl: publicVideoThumbnail(row.thumbnail),
      publishedAt: row.published_at_source === 'estimated' ? null : row.publishedAt,
      duration: row.duration,
      description: row.description || null,
      isDownloaded: Boolean(row.downloaded_id) && !row.downloaded_removed,
      isRequested: false,
      requestStatus: null,
      rating: row.rating || null,
      channelId: channel.channel_id,
      channelTitle: channel.title,
      mediaType: row.media_type,
    })),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
    dataSource: 'cache',
    isFullyIndexed: Boolean(lastIndexedAt),
    lastIndexedAt,
    indexingHint: lastIndexedAt ? null : 'This channel tab has not been indexed yet.',
  };
}

async function getChannelThumbnail(key, channelDatabaseId) {
  normalizePolicy(key);
  const id = parseInteger(channelDatabaseId, null, 1, Number.MAX_SAFE_INTEGER, 'channel id');
  const rows = await sequelize.query(
    `SELECT c.channel_id
       FROM channels c
       INNER JOIN api_key_channel_grants g
         ON g.channel_id = c.id AND g.api_key_id = :keyId
      WHERE c.id = :channelDatabaseId AND c.enabled = true
      LIMIT 1`,
    { replacements: { keyId: key.id, channelDatabaseId: id }, type: QueryTypes.SELECT }
  );
  const channelId = rows[0]?.channel_id;
  if (!channelId || !/^[A-Za-z0-9_-]+$/.test(channelId)) throw new CatalogError('Thumbnail not found', 404);
  try {
    const imageDirectory = await fs.realpath(path.resolve(configModule.getImagePath()));
    const candidatePath = path.resolve(imageDirectory, `channelthumb-${channelId}.jpg`);
    if (path.dirname(candidatePath) !== imageDirectory) throw new Error('unsafe path');
    const stat = await fs.lstat(candidatePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    const absolutePath = await fs.realpath(candidatePath);
    if (path.dirname(absolutePath) !== imageDirectory) throw new Error('unsafe target');
    return absolutePath;
  } catch (_error) {
    throw new CatalogError('Thumbnail not found', 404);
  }
}

module.exports = {
  listChannels,
  listChannelVideos,
  getChannelThumbnail,
  CatalogError,
  normalizePolicy,
  publicVideoThumbnail,
};
