# ACU Video MCP

Self-contained distribution of `claude-video-vision@1.4.0`: standard stdio MCP,
bundled Node 24.22.3 and platform-native FFmpeg/FFprobe. No Magpie patches and no
runtime npm install. Video decoding and frame extraction remain upstream-owned.

Run `acu-video-mcp` as a normal MCP server. `--prepare` unpacks the embedded
dependencies to a versioned per-user cache; `--self-test` checks synthetic MOV
reading without cloud calls. `--register-native` registers the current-user
Chrome host for the fixed ACU TapNow Companion identity. Backup is not allowed.

Tools: video_info, video_watch, video_analyze, video_detail. Visual-only: audio
transcription is disabled, no automatic Whisper download. Returned images need
an image-capable model or a separate verified image interpretation path.

TapNow native requests accept only exact HTTPS TapNow media domains, refuse
redirects/private DNS addresses and limit downloads/sampling. Samples are not
exhaustive video QA. No model inference or generation occurs in this tool.

Build: `node scripts/package.cjs` on Linux x64, Windows x64, macOS Intel/Apple
Silicon. Dependency versions/integrities are locked and Node archive hashes are
pinned. macOS builds are ad-hoc signed, not Developer ID notarized.
