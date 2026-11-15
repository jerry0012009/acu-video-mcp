import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioConnection, audioWorker, analyzeAudio } from '../bundle/audio.mjs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const stage = process.env.ACU_VIDEO_STAGE;
const load = file => import(pathToFileURL(join(stage, 'node_modules/claude-video-vision/dist', file)).href);

test('ACU audio credentials never target Google, redirects or arbitrary hosts', () => {
  assert.equal(audioConnection({}), null);
  for (const url of ['https://google.com', 'http://acu.best', 'https://acu.best.evil.test', 'https://key@acu.best', 'https://acu.best/v1?key=x']) {
    assert.throws(() => audioConnection({ ACU_AUDIO_API_KEY: 'fixture-key', ACU_AUDIO_BASE_URL: url }));
  }
  assert.equal(audioConnection({ ACU_AUDIO_API_KEY: 'fixture-key', ACU_AUDIO_BASE_URL: 'https://console.acucompute.com/v1' }).url,
    'https://console.acucompute.com/v1beta/models/gemini-3.8-flash:generateContent');
});

test('thin transport preserves inline audio, sound tags, timestamp offsets and safe errors', { skip: !stage }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acu-audio-test-'));
  try {
    const file = join(dir, 'fixture.wav');
    await writeFile(file, Buffer.alloc(44 + 32000 * 5));
    const upstream = { ...await load('backends/gemini-api.js'), ...await load('utils/timestamps.js') };
    const connection = audioConnection({ ACU_AUDIO_API_KEY: 'fixture-secret' });
    const worker = audioWorker(connection, upstream, { fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
      const body = JSON.parse(options.body);
      assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'audio/wav');
      assert.match(body.contents[0].parts[1].text, /transcription MUST be \[\]/);
      assert.match(body.contents[0].parts[1].text, /Three seconds is 00:00:03/);
      assert(!('thinkingBudget' in body.generationConfig));
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        transcription: [{ start: '00:00:01', end: '00:00:02', text: 'hello' }],
        audio_tags: [{ start: '00:00:02', end: '00:00:04', tag: 'engine accelerating' }]
      }) }] } }] });
    } });
    const result = await worker(file, 120);
    assert.equal(result.segments[0].start, '00:02:01');
    assert.equal(result.tags[0].end, '00:02:04');
    const failed = audioWorker(connection, upstream, { fetchImpl: async () => new Response('fixture-secret', { status: 502 }) });
    await assert.rejects(failed(file, 0), error => /502/.test(error.message) && !error.message.includes('fixture-secret'));
    const oversized = join(dir, 'large.wav');
    await writeFile(oversized, Buffer.alloc((12 << 20) + 1));
    await assert.rejects(worker(oversized, 0), /budget/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('upstream silence-aware planner stays below inline budget with trailing merge', { skip: !stage }, async () => {
  const { planChunks } = await load('extractors/audio-chunker.js');
  const { chunks } = await planChunks('/unused', 1800, {
    audio_chunk_size_seconds: 120, audio_chunk_overlap_seconds: 0
  }, async () => []);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1).end, 1800);
  assert(chunks.every(c => c.end - c.actual_start <= 240));
});

test('real MOV conversion reuses upstream extraction, no-track handling, chunking and slice offsets', { skip: !stage }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acu-audio-mov-'));
  const connection = audioConnection({ ACU_AUDIO_API_KEY: 'fixture-key' });
  const ffmpeg = join(stage, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const oldPath = process.env.PATH;
  process.env.PATH = join(stage, 'bin') + (process.platform === 'win32' ? ';' : ':') + oldPath;
  try {
    const silent = join(dir, 'no-track.mov'), sound = join(dir, 'sound.mov');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=128x128:rate=1', '-t', '2', '-c:v', 'libx264', '-y', silent]);
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=128x128:rate=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '250', '-c:v', 'libx264', '-c:a', 'aac', '-y', sound]);
    let calls = 0;
    const options = { fetchImpl: async (url, init) => {
      calls++;
      const wav = Buffer.from(JSON.parse(init.body).contents[0].parts[0].inlineData.data, 'base64');
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert(wav.length < (12 << 20));
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        transcription: [], audio_tags: [{ start: '00:00:00', end: '00:00:01', tag: 'tone' }]
      }) }] } }] });
    } };
    assert.equal((await analyzeAudio(stage, { path: silent }, connection, options)).status, 'no_audio');
    assert.equal(calls, 0);
    const result = await analyzeAudio(stage, { path: sound }, connection, options);
    assert.equal(calls, 2);
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.audio_tags.map(t => t.start), ['00:00:00', '00:02:00']);
    const sliced = await analyzeAudio(stage, { path: sound, start_time: '00:00:30', end_time: '00:00:35' }, connection, options);
    assert.equal(sliced.audio_tags[0].start, '00:00:30');
    await assert.rejects(analyzeAudio(stage, { path: sound, start_time: '00:00:00' }, connection, options), /four minutes/);
  } finally { process.env.PATH = oldPath; await rm(dir, { recursive: true, force: true }); }
});
