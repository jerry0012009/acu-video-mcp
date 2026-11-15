// Adapt defaults only; decoding, sampling and MCP tools remain upstream-owned.
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
const root = __dirname;
const pendingAudio = new Map();
const audioModule = import('./audio.mjs');
const childEnv = { ...process.env };
for (const key of ['ACU_AUDIO_API_KEY', 'ACU_AUDIO_BASE_URL', 'ACU_AUDIO_MODEL', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) delete childEnv[key];
process.env.PATH = path.join(root, 'bin') + path.delimiter + process.env.PATH;
process.env.HOME = path.join(root, 'home');
process.env.USERPROFILE = process.env.HOME;
const child = spawn(process.execPath, [path.join(root, 'node_modules/claude-video-vision/dist/index.js')], {
  env: { ...childEnv, PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
});
const reads = new Set(['video_watch', 'video_info', 'video_analyze', 'video_detail']);
let readingID;
createInterface({ input: process.stdin }).on('line', line => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'tools/call') {
      if (msg.params?.name === 'video_watch' && readingID !== undefined) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id,
          error: { code: -32602, message: 'A video read is already running; retry after it completes.' } }) + '\n');
        return;
      }
      if (!reads.has(msg.params?.name)) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id,
          error: { code: -32602, message: 'Only video reading tools are enabled.' } }) + '\n');
        return;
      }
      if (msg.params.name === 'video_watch') {
        readingID = msg.id;
        if (msg.params.arguments?.skip_audio !== true) {
          const args = { ...msg.params.arguments };
          pendingAudio.set(msg.id, audioModule.then(async m => {
            const connection = m.audioConnection();
            if (!connection) return { status: 'not_configured', analyzed: false, error: 'ACU audio is not configured' };
            return m.analyzeAudio(root, args, connection);
          }).catch(() => ({ status: 'failed', analyzed: false, error: 'Audio analysis failed; visual evidence remains available' })));
        }
        msg.params.arguments = { ...msg.params.arguments, skip_audio: true };
      }
      if (msg.params.name === 'video_analyze') {
        msg.params.arguments = { ...msg.params.arguments, filters: {
          ...msg.params.arguments?.filters, transcription: false,
        } };
      }
    }
    child.stdin.write(JSON.stringify(msg) + '\n');
  } catch { child.stdin.write(line + '\n'); }
}).on('close', () => { child.stdin.end(); child.kill(); });
createInterface({ input: child.stdout }).on('line', async line => {
  try {
    const msg = JSON.parse(line);
    if (Array.isArray(msg.result?.tools)) {
      msg.result.tools = msg.result.tools.filter(t => reads.has(t.name));
      for (const tool of msg.result.tools) {
        tool.description += ' Audio on video_watch uses the configured ACU auxiliary model unless skip_audio=true. Audio failure does not invalidate visual frames. video_analyze provides local silence/loudness filters; use video_watch for speech and sound events. Samples are not exhaustive video QA or precise lip-sync measurement.';
      }
    }
    if (pendingAudio.has(msg.id)) {
      const audio = await pendingAudio.get(msg.id);
      pendingAudio.delete(msg.id);
      if (Array.isArray(msg.result?.content) && !msg.result.isError) {
        msg.result.content = msg.result.content.map(part => part.type === 'text' && part.text?.includes('\n\n## Audio Analysis\n')
          ? { ...part, text: part.text.split('\n\n## Audio Analysis\n')[0] } : part);
        msg.result.content.push({ type: 'text', text: JSON.stringify({ acu_audio: audio }) });
      }
    }
    if (msg.id === readingID) readingID = undefined;
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch { process.stdout.write(line + '\n'); }
});
child.on('error', () => process.exit(1));
child.stdin.on('error', () => {});
child.on('close', code => process.exit(code ?? 1));
process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());
