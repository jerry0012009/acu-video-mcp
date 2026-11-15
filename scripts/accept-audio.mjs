// End-to-end standard MCP acceptance through the ordinary ACU user path.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const [executable, file] = process.argv.slice(2);
const child = spawn(executable, [], { env: { ...process.env,
  ACU_AUDIO_BASE_URL: 'https://console.acucompute.com/v1',
  ACU_AUDIO_MODEL: 'gemini-3.8-flash',
  ACU_AUDIO_API_KEY: readFileSync('/root/.local/share/codex-acu/credentials', 'utf8').trim()
}, stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let next = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const msg = JSON.parse(line);
  if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const request = (method, params) => new Promise(resolve => {
  const id = ++next;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
try {
  const timeout = setTimeout(() => child.kill(), 180_000);
  timeout.unref();
  const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acu-audio-acceptance', version: '1' } });
  assert(!init.error);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const result = await request('tools/call', { name: 'video_watch', arguments: { path: file, fps: 1, view_sample: 3, resolution: 320 } });
  assert(!result.error && !result.result?.isError, 'MCP reading failed');
  const parts = result.result.content;
  const audio = parts.filter(p => p.type === 'text').map(p => { try { return JSON.parse(p.text).acu_audio; } catch { return null; } }).find(Boolean);
  assert.equal(audio?.status, 'complete', 'Audio did not complete');
  assert(audio.transcription.some(s => /seven blue lanterns/i.test(s.text)), 'Spoken fixture was not recognized');
  assert(parts.some(p => p.type === 'image'), 'Visual evidence was lost');
  console.log(JSON.stringify({ ok: true, model: audio.model, status: audio.status, frames: parts.filter(p => p.type === 'image').length,
    transcription: audio.transcription, audio_tags: audio.audio_tags, range: audio.range }));
  clearTimeout(timeout);
} finally { lines.close(); child.stdin.end(); child.kill(); }
