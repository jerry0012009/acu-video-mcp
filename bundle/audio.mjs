import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export function audioConnection(env = process.env) {
  if (!env.ACU_AUDIO_API_KEY) return null;
  const base = new URL(env.ACU_AUDIO_BASE_URL || 'https://console.acucompute.com/v1');
  const host = base.hostname;
  if (base.protocol !== 'https:' || base.username || base.password || base.port || base.search || base.hash ||
      !['', '/', '/v1', '/acu', '/acu/v1'].includes(base.pathname.replace(/\/$/, '')) ||
      !(host === 'acu.best' || host.endsWith('.acu.best') || host === 'acucompute.com' || host.endsWith('.acucompute.com'))) {
    throw new Error('Invalid ACU audio endpoint');
  }
  const model = env.ACU_AUDIO_MODEL || 'gemini-3.8-flash';
  if (!/^gemini-[a-zA-Z0-9._-]{1,100}$/.test(model) || !/^\S{8,4096}$/.test(env.ACU_AUDIO_API_KEY)) throw new Error('Invalid ACU audio configuration');
  base.pathname = base.pathname.replace(/\/$/, '').replace(/\/v1$/, '') + `/v1beta/models/${model}:generateContent`;
  return { url: base.toString(), key: env.ACU_AUDIO_API_KEY, model };
}

const schema = {
  type: 'OBJECT', properties: {
    transcription: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      start: { type: 'STRING' }, end: { type: 'STRING' }, text: { type: 'STRING' }
    }, required: ['start', 'end', 'text'] } },
    audio_tags: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      start: { type: 'STRING' }, end: { type: 'STRING' }, tag: { type: 'STRING' }
    }, required: ['start', 'end', 'tag'] } }
  }, required: ['transcription', 'audio_tags']
};

export function audioWorker(connection, upstream, { fetchImpl = fetch, signal = AbortSignal.timeout(120_000) } = {}) {
  let active = 0;
  const waiting = [];
  return async (wavPath, offsetSec) => {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try {
      signal.throwIfAborted();
      if ((await stat(wavPath)).size > (12 << 20)) throw new Error('Audio chunk exceeds inline request budget');
      const data = (await readFile(wavPath)).toString('base64');
      const body = JSON.stringify({ contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: 'audio/wav', data } },
        { text: 'Listen to this audio. Return verbatim speech in transcription and audible non-speech events (music, sound effects, engines, tires, ambient sounds) in audio_tags. Use HH:MM:SS timestamps relative to this audio chunk. Empty arrays mean no such events were heard. Do not invent sounds from expectations or video prompts. Labels are observations, not objective acoustic measurements.' }
      ] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 4096 } });
      const response = await fetchImpl(connection.url, {
        method: 'POST', headers: { Authorization: `Bearer ${connection.key}`, 'Content-Type': 'application/json' },
        body, signal, redirect: 'error'
      });
      if (!response.ok) throw new Error(`ACU audio request failed (HTTP ${response.status})`);
      const text = await boundedResponse(response, 1 << 20);
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error('ACU audio returned invalid JSON'); }
      const candidate = payload.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error('ACU audio result is incomplete');
      const raw = (candidate?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
      let decoded;
      try { decoded = JSON.parse(raw); } catch { throw new Error('Invalid audio observations'); }
      if (!Array.isArray(decoded?.transcription) || !Array.isArray(decoded?.audio_tags)) throw new Error('Missing audio observations');
      const parsed = upstream.parseGeminiAudioResponse(raw);
      const duration = Math.max(0, ((await stat(wavPath)).size - 44) / 32000);
      const normalize = (items, field) => {
        if (!Array.isArray(items) || items.length > 500) throw new Error('Invalid audio observations');
        return items.map(item => {
          if (!item || !/^\d{2}:\d{2}:\d{2}$/.test(item.start) || !/^\d{2}:\d{2}:\d{2}$/.test(item.end) ||
              typeof item[field] !== 'string' || item[field].length > 4000) throw new Error('Invalid audio observation');
          const start = upstream.parseHMS(item.start), end = upstream.parseHMS(item.end);
          if (start > end || end > duration + 1) throw new Error('Audio timestamp outside analyzed chunk');
          return { start: upstream.formatHMS(start + offsetSec), end: upstream.formatHMS(end + offsetSec), [field]: item[field] };
        });
      };
      return { segments: normalize(parsed.transcription, 'text'), tags: normalize(parsed.audio_tags, 'tag') };
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

async function boundedResponse(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('ACU audio response exceeds budget');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function analyzeAudio(root, args, connection, options = {}) {
  const load = file => import(pathToFileURL(join(root, 'node_modules/claude-video-vision/dist', file)).href);
  const [{ analyzeWithGeminiApi, parseGeminiAudioResponse }, timestamps, { getVideoMetadata }, { resolveVideoInputDetailed }, { defaultConfig }] = await Promise.all([
    load('backends/gemini-api.js'), load('utils/timestamps.js'), load('extractors/frames.js'), load('utils/video-source.js'), load('config.js')
  ]);
  const { path } = await resolveVideoInputDetailed(args.path);
  const metadata = await getVideoMetadata(path);
  if (!metadata.has_audio) return { status: 'no_audio', analyzed: false, model: connection.model, transcription: [], audio_tags: [] };
  if (!(metadata.duration_seconds > 0) || metadata.duration_seconds > 1800) throw new Error('Audio reading supports videos up to 30 minutes');
  // Upstream owns conversion, silence-aware chunking, retries, clamping and cleanup.
  // Its planner may merge a trailing chunk, so use 120s chunks (not the 600s default).
  // Upstream's sliced path bypasses its chunk planner. Bound explicit slices.
  if (args.start_time || args.end_time) {
    const start = args.start_time ? timestamps.parseHMS(args.start_time) : 0;
    const end = args.end_time ? timestamps.parseHMS(args.end_time) : metadata.duration_seconds;
    if (start < 0 || end <= start || end > metadata.duration_seconds + 1 || end - start > 240) throw new Error('Audio slices must be within the video and at most four minutes');
  }
  const result = await analyzeWithGeminiApi(path, {
    ...defaultConfig, audio_model: connection.model, audio_chunk_trigger_seconds: 120,
    audio_chunk_size_seconds: 120, audio_chunk_overlap_seconds: 0
  }, { startTime: args.start_time, endTime: args.end_time }, {
    worker: audioWorker(connection, { parseGeminiAudioResponse, ...timestamps }, options)
  });
  const shifted = timestamps.shiftAudioResult(result, args.start_time ? timestamps.parseHMS(args.start_time) : 0);
  const partial = result.warnings?.some(w => w.event === 'failed');
  return { ...shifted, backend: 'acu-gemini', model: connection.model,
    transcription: shifted.transcription.filter(s => !s.text.startsWith('[transcription failed for this segment')),
    status: partial ? 'partial' : 'complete', analyzed: !partial,
    range: { start: args.start_time || '00:00:00', end: args.end_time || timestamps.formatHMS(metadata.duration_seconds) } };
}
