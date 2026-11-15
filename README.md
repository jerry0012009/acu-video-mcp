# ACU Video MCP

Self-contained distribution of `claude-video-vision@1.4.0`: standard stdio MCP,
bundled Node 24.22.3 and platform-native FFmpeg/FFprobe. No Magpie patches and no
runtime npm install. Video decoding and frame extraction remain upstream-owned.

Run `acu-video-mcp` as a normal MCP server. `--prepare` unpacks the embedded
dependencies to a versioned per-user cache; `--self-test` checks synthetic MOV
reading without cloud calls. `--register-native` registers the current-user
Chrome host for the fixed ACU TapNow Companion identity. Backup is not allowed.

Tools: video_info, video_watch, video_analyze, video_detail. Optional audio
understanding uses the existing ACU Key, not a Google Key or a local Whisper download.
Set `ACU_AUDIO_API_KEY`, `ACU_AUDIO_BASE_URL` (default
`https://console.acucompute.com/v1`), and optionally `ACU_AUDIO_MODEL` (default
`gemini-3.8-flash`) in the standard MCP environment. Runtime supplies these from
the selected ACU connection. `video_watch` returns `acu_audio` with status,
timestamped speech and non-speech sound events; `skip_audio: true` stays local.
Without configuration or on audio failure, visual frames remain available.
`video_analyze` reuses upstream local silence/loudness filters; cloud speech and
sound events are provided by `video_watch`. Returned images need
an image-capable model or a separate verified image interpretation path.

TapNow native requests accept only exact HTTPS TapNow media domains, refuse
redirects/private DNS addresses and limit downloads/sampling. Samples are not
exhaustive video QA or precise lip-sync detection. Audio is sent to ACU for paid
inference only when configured and requested; there is no generation operation.

Audio decoding, conversion (16 kHz mono PCM WAV), silence-aware segmentation,
retry, timestamp clamping and temporary cleanup use unmodified upstream 1.4.0.
The ACU adapter supplies its existing `worker` extension point, using native
Gemini inline audio instead of Google's Files API. Chunk target is 120 seconds
(upstream can merge tails); each WAV is limited to 12 MiB and at most two cloud
requests run at once. Explicit slices are limited to four minutes. Videos are
limited to 30 minutes. Partial failures are reported, never disguised as silence.

Build: `node scripts/package.cjs` on Linux x64, Windows x64, macOS Intel/Apple
Silicon. Dependency versions/integrities are locked and Node archive hashes are
pinned. macOS builds are ad-hoc signed, not Developer ID notarized.
