const fs = require('fs-extra');
const fsPromises = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const configModule = require('../configModule');
const logger = require('../../logger');
const { copySyncWithFallback } = require('../filesystem');
const { safeUrlHost } = require('../safeCommandLogging');

const execFileAsync = promisify(execFile);
const SAFE_THUMBNAIL_HOSTS = ['ytimg.com', 'ggpht.com', 'googleusercontent.com'];
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const MAX_THUMBNAIL_DIMENSION = 4096;
const MAX_REDIRECTS = 3;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isSafeThumbnailHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return SAFE_THUMBNAIL_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`)
  );
}

function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] <= 2) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 ||
        parts[1] === 51 && parts[2] === 100)) ||
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
      parts[0] >= 224;
  }
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase().split('%')[0];
    return value === '::' || value === '::1' ||
      value.startsWith('fc') || value.startsWith('fd') ||
      value.startsWith('fe8') || value.startsWith('fe9') ||
      value.startsWith('fea') || value.startsWith('feb') ||
      value.startsWith('fec') || value.startsWith('fed') ||
      value.startsWith('fee') || value.startsWith('fef') ||
      value.startsWith('2001:db8:') ||
      value.startsWith('ff') || value.startsWith('::ffff:');
  }
  return true;
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb,
        0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
}

class ChannelThumbnails {
  /**
   * Resize channel thumbnail image
   * @param {string} channelId - Channel ID
   * @returns {Promise<void>}
   */
  async resizeChannelThumbnail(channelId) {
    if (!CHANNEL_ID_PATTERN.test(channelId)) throw new Error('Invalid channel ID');
    const imagePath = configModule.getImagePath();
    const realImagePath = path.join(
      imagePath,
      `channelthumb-${channelId}.jpg`
    );
    const smallImagePath = path.join(
      imagePath,
      `channelthumb-${channelId}-small.jpg`
    );

    try {
      await execFileAsync(configModule.ffmpegPath, [
        '-loglevel', 'error',
        '-y',
        '-i', realImagePath,
        '-vf', 'scale=iw*0.4:ih*0.4',
        '-q:v', '2',
        smallImagePath,
      ]);
      await fsPromises.rename(smallImagePath, realImagePath);
      logger.debug({ channelId }, 'Channel thumbnail resized successfully');
    } catch (err) {
      logger.error({ channelId, errorCode: err?.code }, 'Error resizing channel thumbnail');
    }
  }

  /**
   * Extract the avatar thumbnail URL from channel metadata
   * @param {Object} channelData - Channel metadata from yt-dlp
   * @returns {string|null} - Avatar thumbnail URL or null if not found
   */
  extractAvatarThumbnailUrl(channelData) {
    if (!channelData.thumbnails || !Array.isArray(channelData.thumbnails)) {
      return null;
    }
    // Prefer 900x900 (height and width), then any square dimension thumb, then avatar_uncropped
    // (avatar_uncropped last since it is good, but usually HUGE)
    const avatarThumb = channelData.thumbnails.find(t => t.width === 900 && t.height === 900)
      || channelData.thumbnails.find(t => t.width && t.height && t.width === t.height)
      || channelData.thumbnails.find(t => t.id === 'avatar_uncropped');
    logger.info({
      channelId: channelData.channel_id,
      thumbnailHost: safeUrlHost(avatarThumb?.url),
      width: avatarThumb?.width,
      height: avatarThumb?.height,
    }, 'Extracted avatar thumbnail URL');
    return avatarThumb?.url || null;
  }

  /**
   * Download channel thumbnail directly from URL
   * @param {string} thumbnailUrl - Direct URL to the thumbnail image
   * @param {string} channelId - Channel ID for naming the file
   * @returns {Promise<void>}
   */
  async downloadChannelThumbnailFromUrl(thumbnailUrl, channelId, redirectCount = 0) {
    const https = require('https');
    if (!CHANNEL_ID_PATTERN.test(channelId)) throw new Error('Invalid channel ID');
    if (redirectCount > MAX_REDIRECTS) throw new Error('Too many thumbnail redirects');
    let parsed;
    try {
      parsed = new URL(thumbnailUrl);
    } catch (_error) {
      throw new Error('Invalid thumbnail URL');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        !isSafeThumbnailHost(parsed.hostname)) {
      throw new Error('Unsafe thumbnail URL');
    }
    const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('Unsafe thumbnail address');
    }
    const selected = addresses[0];
    const imageDir = configModule.getImagePath();
    const imagePath = path.join(imageDir, `channelthumb-${channelId}.jpg`);
    const temporaryPath = path.join(
      imageDir,
      `.channelthumb-${channelId}-${crypto.randomUUID()}.tmp`
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      let durationTimer;
      const fail = async (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(durationTimer);
        await fsPromises.unlink(temporaryPath).catch(() => {});
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(durationTimer);
        resolve();
      };
      const req = https.get(parsed, {
        timeout: 15000,
        servername: parsed.hostname,
        lookup: (_hostname, _options, callback) =>
          callback(null, selected.address, selected.family),
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          const redirectUrl = new URL(response.headers.location, parsed).toString();
          return this.downloadChannelThumbnailFromUrl(
            redirectUrl,
            channelId,
            redirectCount + 1
          )
            .then(succeed)
            .catch(fail);
        }

        if (response.statusCode !== 200) {
          response.resume();
          return fail(new Error(`Failed to download thumbnail: HTTP ${response.statusCode}`));
        }
        const contentType = String(response.headers['content-type'] || '')
          .split(';', 1)[0].trim().toLowerCase();
        if (!['image/jpeg', 'image/png'].includes(contentType)) {
          response.resume();
          return fail(new Error('Thumbnail response is not a supported image'));
        }
        const declaredLength = Number(response.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_THUMBNAIL_BYTES) {
          response.resume();
          return fail(new Error('Thumbnail response is too large'));
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_THUMBNAIL_BYTES) {
            response.destroy(new Error('Thumbnail response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', fail);
        response.on('end', async () => {
          try {
            const content = Buffer.concat(chunks);
            const dimensions = imageDimensions(content);
            if (!dimensions || dimensions.width < 1 || dimensions.height < 1 ||
                dimensions.width > MAX_THUMBNAIL_DIMENSION ||
                dimensions.height > MAX_THUMBNAIL_DIMENSION) {
              throw new Error('Thumbnail image dimensions are invalid');
            }
            await fsPromises.writeFile(temporaryPath, content, { flag: 'wx' });
            await fsPromises.rename(temporaryPath, imagePath);
          } catch (error) {
            return fail(error);
          }
          logger.debug({ channelId }, 'Channel thumbnail downloaded via HTTP');
          return succeed();
        });
      });
      durationTimer = setTimeout(() => {
        const error = new Error('Thumbnail download timed out');
        req.destroy(error);
        fail(error);
      }, 15000);
      durationTimer.unref?.();

      req.on('timeout', () => {
        req.destroy(new Error('Thumbnail download timed out'));
      });

      req.on('error', fail);
    });
  }

  /**
   * Process channel thumbnail (download and resize)
   * @param {Object} channelData - Channel metadata containing thumbnails array
   * @param {string} channelId - Channel ID
   * @returns {Promise<void>}
   */
  async processChannelThumbnail(channelData, channelId) {
    const thumbnailUrl = this.extractAvatarThumbnailUrl(channelData);
    logger.info({
      channelId,
      thumbnailHost: safeUrlHost(thumbnailUrl),
    }, 'Processing channel thumbnail');

    if (!thumbnailUrl) {
      logger.info({ channelId }, 'No approved avatar thumbnail URL found in metadata');
      return;
    }

    try {
      await this.downloadChannelThumbnailFromUrl(thumbnailUrl, channelId);
    } catch (err) {
      // Artwork is optional. Never route a rejected URL through yt-dlp because
      // that would bypass the redirect, address, size, type and image checks.
      logger.warn({
        channelId,
        errorCode: err?.code,
      }, 'Rejected or failed channel thumbnail download');
      return;
    }
    await this.resizeChannelThumbnail(channelId);
  }

  /**
   * Backfill poster.jpg files for existing channel folders.
   * Copies channelthumb to each channel's folder as poster.jpg if it doesn't exist.
   * @param {Array} channels - Array of channel database records
   * @returns {Promise<void>}
   */
  async backfillChannelPosters(channels) {
    try {
      const config = configModule.getConfig() || {};
      const shouldWriteChannelPosters = config.writeChannelPosters !== false;

      if (!shouldWriteChannelPosters) {
        return;
      }

      const outputDir = configModule.directoryPath;
      const imageDir = configModule.getImagePath();

      if (!outputDir || !fs.existsSync(outputDir)) {
        return;
      }

      for (const channel of channels) {
        if (!channel.channel_id) continue;

        // Use folder_name (sanitized by yt-dlp) if available, fall back to uploader
        const channelFolderName = channel.folder_name || channel.uploader;
        if (!channelFolderName) continue;

        const channelFolderPath = path.join(outputDir, channelFolderName);
        const channelPosterPath = path.join(channelFolderPath, 'poster.jpg');

        // Check if channel folder exists and poster.jpg doesn't exist
        if (fs.existsSync(channelFolderPath) && !fs.existsSync(channelPosterPath)) {
          const channelThumbPath = path.join(imageDir, `channelthumb-${channel.channel_id}.jpg`);

          if (fs.existsSync(channelThumbPath)) {
            try {
              copySyncWithFallback(channelThumbPath, channelPosterPath);
            } catch (copyErr) {
              logger.error({
                errorCode: copyErr?.code,
              }, 'Error backfilling poster for channel');
            }
          }
        }
      }
    } catch (err) {
      logger.error({ errorCode: err?.code }, 'Error during channel poster backfill');
    }
  }
}

module.exports = new ChannelThumbnails();
module.exports.isSafeThumbnailHost = isSafeThumbnailHost;
module.exports.isPrivateAddress = isPrivateAddress;
module.exports.imageDimensions = imageDimensions;
