const { spawn, spawnSync } = require('child_process');
const { prepareExternalCookies } = require('./externalCookies');

// Keep the existing ChildProcess API and event handling at each call site.
// The external source is never passed to yt-dlp, which writes its cookie jar
// back on exit. Every invocation gets its own writable snapshot instead.
function spawnYtDlp(args, options) {
  const prepared = prepareExternalCookies(args);
  try {
    const child = spawn('yt-dlp', prepared.args, options);
    if (prepared.cleanup) {
      // 'close' also follows a failed spawn. An 'error' alone can mean a failed
      // kill while yt-dlp is still running, so do not remove its file then.
      child.once('close', prepared.cleanup);
    }
    return child;
  } catch (error) {
    prepared.cleanup?.();
    throw error;
  }
}

function spawnYtDlpSync(args, options) {
  const prepared = prepareExternalCookies(args);
  try {
    return spawnSync('yt-dlp', prepared.args, options);
  } finally {
    prepared.cleanup?.();
  }
}

module.exports = { spawnYtDlp, spawnYtDlpSync };
