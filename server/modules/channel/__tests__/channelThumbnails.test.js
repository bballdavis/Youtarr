/* eslint-env jest */

const mockFactories = require('./mockFactories');
const { EventEmitter } = require('events');

jest.mock('fs');
jest.mock('child_process');
jest.mock('https');
jest.mock('dns', () => ({
  promises: { lookup: jest.fn() },
}));
jest.mock('../../../logger');
jest.mock('../../configModule', () => mockFactories.mockConfigModule());
jest.mock('../../filesystem', () => mockFactories.mockFilesystem());

describe('channelThumbnails', () => {
  let channelThumbnails;
  let fs;
  let logger;
  let https;
  let dns;
  let childProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    fs = require('fs');
    fs.readFileSync = jest.fn().mockReturnValue('');
    fs.writeFileSync = jest.fn();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.copySync = jest.fn();
    fs.createWriteStream = jest.fn().mockReturnValue({
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn()
    });
    fs.promises = {
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(),
      unlink: jest.fn().mockResolvedValue(),
      rename: jest.fn().mockResolvedValue()
    };

    logger = require('../../../logger');
    https = require('https');
    dns = require('dns').promises;
    childProcess = require('child_process');
    childProcess.execFile.mockImplementation((_file, _args, callback) => callback(null, '', ''));
    dns.lookup.mockResolvedValue([{ address: '142.250.190.78', family: 4 }]);

    channelThumbnails = require('../channelThumbnails');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractAvatarThumbnailUrl', () => {
    test('should return null when thumbnails is not an array', () => {
      const channelData = { channel_id: 'UC123', thumbnails: null };
      const result = channelThumbnails.extractAvatarThumbnailUrl(channelData);
      expect(result).toBeNull();
    });

    test('should return null when thumbnails is undefined', () => {
      const channelData = { channel_id: 'UC123' };
      const result = channelThumbnails.extractAvatarThumbnailUrl(channelData);
      expect(result).toBeNull();
    });

    test('should prefer 900x900 thumbnail', () => {
      const channelData = {
        channel_id: 'UC123',
        thumbnails: [
          { url: 'https://example.com/small.jpg', width: 100, height: 100 },
          { url: 'https://example.com/large.jpg', width: 900, height: 900 },
          { url: 'https://example.com/avatar.jpg', id: 'avatar_uncropped' }
        ]
      };
      const result = channelThumbnails.extractAvatarThumbnailUrl(channelData);
      expect(result).toBe('https://example.com/large.jpg');
    });

    test('should fallback to any square thumbnail', () => {
      const channelData = {
        channel_id: 'UC123',
        thumbnails: [
          { url: 'https://example.com/square.jpg', width: 200, height: 200 },
          { url: 'https://example.com/avatar.jpg', id: 'avatar_uncropped' }
        ]
      };
      const result = channelThumbnails.extractAvatarThumbnailUrl(channelData);
      expect(result).toBe('https://example.com/square.jpg');
    });

    test('should fallback to avatar_uncropped as last resort', () => {
      const channelData = {
        channel_id: 'UC123',
        thumbnails: [
          { url: 'https://example.com/non-square.jpg', width: 100, height: 200 },
          { url: 'https://example.com/avatar.jpg', id: 'avatar_uncropped' }
        ]
      };
      const result = channelThumbnails.extractAvatarThumbnailUrl(channelData);
      expect(result).toBe('https://example.com/avatar.jpg');
    });

    test('should return null when no suitable thumbnail found', () => {
      const channelData = {
        channel_id: 'UC123',
        thumbnails: [
          { url: 'https://example.com/non-square.jpg', width: 100, height: 200 }
        ]
      };
      const result = channelThumbnails.extractAvatarThumbnailUrl(channelData);
      expect(result).toBeNull();
    });

    test('should return null when thumbnails array is empty', () => {
      const channelData = { channel_id: 'UC123', thumbnails: [] };
      const result = channelThumbnails.extractAvatarThumbnailUrl(channelData);
      expect(result).toBeNull();
    });
  });

  describe('processChannelThumbnail', () => {
    let originalExtractAvatarThumbnailUrl;
    let originalDownloadChannelThumbnailFromUrl;
    let originalResizeChannelThumbnail;

    beforeEach(() => {
      originalExtractAvatarThumbnailUrl = channelThumbnails.extractAvatarThumbnailUrl;
      originalDownloadChannelThumbnailFromUrl = channelThumbnails.downloadChannelThumbnailFromUrl;
      originalResizeChannelThumbnail = channelThumbnails.resizeChannelThumbnail;
    });

    afterEach(() => {
      channelThumbnails.extractAvatarThumbnailUrl = originalExtractAvatarThumbnailUrl;
      channelThumbnails.downloadChannelThumbnailFromUrl = originalDownloadChannelThumbnailFromUrl;
      channelThumbnails.resizeChannelThumbnail = originalResizeChannelThumbnail;
    });

    test('should download from URL when avatar thumbnail is found', async () => {
      const channelData = { channel_id: 'UC123', thumbnails: [] };
      const channelId = 'UC123';
      const channelUrl = 'https://www.youtube.com/@testchannel';

      channelThumbnails.extractAvatarThumbnailUrl = jest.fn().mockReturnValue('https://example.com/avatar.jpg');
      channelThumbnails.downloadChannelThumbnailFromUrl = jest.fn().mockResolvedValue();
      channelThumbnails.resizeChannelThumbnail = jest.fn().mockResolvedValue();

      await channelThumbnails.processChannelThumbnail(channelData, channelId, channelUrl);

      expect(channelThumbnails.extractAvatarThumbnailUrl).toHaveBeenCalledWith(channelData);
      expect(channelThumbnails.downloadChannelThumbnailFromUrl).toHaveBeenCalledWith('https://example.com/avatar.jpg', channelId);
      expect(channelThumbnails.resizeChannelThumbnail).toHaveBeenCalledWith(channelId);
    });

    test('should not bypass URL validation when a direct download fails', async () => {
      const channelData = { channel_id: 'UC123', thumbnails: [] };
      const channelId = 'UC123';
      const channelUrl = 'https://www.youtube.com/@testchannel';

      channelThumbnails.extractAvatarThumbnailUrl = jest.fn().mockReturnValue('https://example.com/avatar.jpg');
      channelThumbnails.downloadChannelThumbnailFromUrl = jest.fn().mockRejectedValue(new Error('Download failed'));
      channelThumbnails.resizeChannelThumbnail = jest.fn().mockResolvedValue();

      await channelThumbnails.processChannelThumbnail(channelData, channelId, channelUrl);

      expect(channelThumbnails.downloadChannelThumbnailFromUrl).toHaveBeenCalled();
      expect(channelThumbnails.resizeChannelThumbnail).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ channelId }),
        'Rejected or failed channel thumbnail download'
      );
    });

    test('should skip optional artwork when no approved URL is found', async () => {
      const channelData = { channel_id: 'UC123', thumbnails: [] };
      const channelId = 'UC123';
      const channelUrl = 'https://www.youtube.com/@testchannel';

      channelThumbnails.extractAvatarThumbnailUrl = jest.fn().mockReturnValue(null);
      channelThumbnails.resizeChannelThumbnail = jest.fn().mockResolvedValue();

      await channelThumbnails.processChannelThumbnail(channelData, channelId, channelUrl);

      expect(channelThumbnails.resizeChannelThumbnail).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ channelId }),
        'No approved avatar thumbnail URL found in metadata'
      );
    });

    test('should always call resizeChannelThumbnail at the end', async () => {
      const channelData = { channel_id: 'UC123', thumbnails: [] };
      const channelId = 'UC123';
      const channelUrl = 'https://www.youtube.com/@testchannel';

      channelThumbnails.extractAvatarThumbnailUrl = jest.fn().mockReturnValue('https://example.com/avatar.jpg');
      channelThumbnails.downloadChannelThumbnailFromUrl = jest.fn().mockResolvedValue();
      channelThumbnails.resizeChannelThumbnail = jest.fn().mockResolvedValue();

      await channelThumbnails.processChannelThumbnail(channelData, channelId, channelUrl);

      expect(channelThumbnails.resizeChannelThumbnail).toHaveBeenCalledWith(channelId);
    });
  });

  describe('downloadChannelThumbnailFromUrl', () => {
    function mockRequest(responseFactory) {
      https.get.mockImplementation((_url, _options, callback) => {
        const request = new EventEmitter();
        request.destroy = jest.fn((error) => {
          if (error) process.nextTick(() => request.emit('error', error));
        });
        process.nextTick(() => callback(responseFactory()));
        return request;
      });
    }

    function response({ statusCode = 200, headers = {}, body = Buffer.alloc(0) } = {}) {
      const stream = new EventEmitter();
      stream.statusCode = statusCode;
      stream.headers = headers;
      stream.resume = jest.fn();
      process.nextTick(() => {
        if (statusCode === 200) stream.emit('data', body);
        stream.emit('end');
      });
      return stream;
    }

    test.each([
      ['http://i.ytimg.com/thumb.jpg', 'Unsafe thumbnail URL'],
      ['https://user:secret@i.ytimg.com/thumb.jpg', 'Unsafe thumbnail URL'],
      ['https://example.com/thumb.jpg', 'Unsafe thumbnail URL'],
      ['https://i.ytimg.com/thumb.jpg', 'Invalid channel ID', 'bad/id'],
    ])('rejects unsafe input %s', async (url, message, channelId = 'UC123') => {
      await expect(
        channelThumbnails.downloadChannelThumbnailFromUrl(url, channelId)
      ).rejects.toThrow(message);
    });

    test.each([
      ['127.0.0.1', true],
      ['10.0.0.1', true],
      ['169.254.169.254', true],
      ['100.64.0.1', true],
      ['192.168.1.1', true],
      ['8.8.8.8', false],
      ['::1', true],
      ['fd00::1', true],
      ['fec0::1', true],
      ['::ffff:7f00:1', true],
      ['2606:4700:4700::1111', false],
    ])('classifies private address %s', (address, expected) => {
      expect(channelThumbnails.isPrivateAddress(address)).toBe(expected);
    });

    test('validates image magic bytes and dimensions', () => {
      const png = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
      png.writeUInt32BE(800, 16);
      png.writeUInt32BE(600, 20);
      expect(channelThumbnails.imageDimensions(png)).toEqual({ width: 800, height: 600 });
      expect(channelThumbnails.imageDimensions(Buffer.from('not-an-image'))).toBeNull();
    });

    test('rejects a private DNS answer before opening a connection', async () => {
      dns.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      await expect(
        channelThumbnails.downloadChannelThumbnailFromUrl(
          'https://i.ytimg.com/thumb.jpg',
          'UC123'
        )
      ).rejects.toThrow('Unsafe thumbnail address');
      expect(https.get).not.toHaveBeenCalled();
    });

    test('revalidates an unsafe redirect target', async () => {
      mockRequest(() => response({
        statusCode: 302,
        headers: { location: 'https://127.0.0.1/metadata' },
      }));
      await expect(
        channelThumbnails.downloadChannelThumbnailFromUrl(
          'https://i.ytimg.com/thumb.jpg',
          'UC123'
        )
      ).rejects.toThrow('Unsafe thumbnail URL');
    });

    test('pins the validated DNS answer used by the HTTPS request', async () => {
      const png = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
      png.writeUInt32BE(800, 16);
      png.writeUInt32BE(600, 20);
      let requestOptions;
      https.get.mockImplementation((_url, options, callback) => {
        requestOptions = options;
        const request = new EventEmitter();
        request.destroy = jest.fn();
        process.nextTick(() => callback(response({
          headers: { 'content-type': 'image/png' },
          body: png,
        })));
        return request;
      });

      await channelThumbnails.downloadChannelThumbnailFromUrl(
        'https://i.ytimg.com/thumb.png',
        'UC123'
      );
      const lookupCallback = jest.fn();
      requestOptions.lookup('i.ytimg.com', {}, lookupCallback);
      expect(lookupCallback).toHaveBeenCalledWith(null, '142.250.190.78', 4);
      expect(requestOptions.servername).toBe('i.ytimg.com');
    });

    test('rejects oversized and malformed image responses', async () => {
      mockRequest(() => response({
        headers: { 'content-type': 'image/jpeg', 'content-length': String(6 * 1024 * 1024) },
      }));
      await expect(
        channelThumbnails.downloadChannelThumbnailFromUrl(
          'https://i.ytimg.com/large.jpg',
          'UC123'
        )
      ).rejects.toThrow('Thumbnail response is too large');

      https.get.mockReset();
      mockRequest(() => response({
        headers: { 'content-type': 'image/jpeg' },
        body: Buffer.from('not-an-image'),
      }));
      await expect(
        channelThumbnails.downloadChannelThumbnailFromUrl(
          'https://i.ytimg.com/broken.jpg',
          'UC123'
        )
      ).rejects.toThrow('Thumbnail image dimensions are invalid');
    });
  });

  describe('resizeChannelThumbnail', () => {
    test('uses argument-array execution and rejects shell metacharacters', async () => {
      await expect(
        channelThumbnails.resizeChannelThumbnail('UC123;touch-pwned')
      ).rejects.toThrow('Invalid channel ID');
      expect(childProcess.execFile).not.toHaveBeenCalled();

      await channelThumbnails.resizeChannelThumbnail('UC123');
      expect(childProcess.execFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['-i', expect.stringContaining('channelthumb-UC123.jpg')]),
        expect.any(Function)
      );
      expect(childProcess.execFile.mock.calls[0][1]).toEqual(expect.any(Array));
    });
  });
});
