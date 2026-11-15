# Audio Reading 0.2.3

Unmodified claude-video-vision 1.4.0 still owns WAV conversion, silence-aware
chunk planning, retries, clamping, slice offsets and temporary cleanup. A
directory comparison of the upstream dist trees found no changes. The only
cloud transport extension uses its worker injection point and ACU native Gemini
inlineData, not Google Files or a second API key.

Four platform jobs passed Go race tests/vet, self-contained synthetic MOV
sampling and the audio reuse tests. Tests use real FFmpeg MOV fixtures with
mock inference: no-track suppression, 250-second segmentation, slice offsets,
bounded WAVs, safe errors and source-independent numeric timestamp formatting.

The released Linux binary was downloaded from v0.2.3 and verified against
SHA256SUMS.txt (`d0b98aa28109d7d682941ae916a938df0e0f83286ea436a13144966c6dde2a89`).
Ordinary public ACU credentials, no request-level Profile override:

- Speech MOV: returned three visual frames and the actual synthesized phrase
  "The secret code is seven blue lanterns", at 00:00:00-00:00:02.
  Request `req_dfc26e1112a1495894d9540b4b6456c3`, completed/acknowledged,
  CNY 0.0000771750.
- Pure 440 Hz tone MOV: returned three frames, empty transcription and a
  00:00:00-00:00:03 sound tag. Model called it "telephone bell ringing".
  Request `req_a51b789ee2ac4974abead1758b94ebf8`, completed/acknowledged,
  CNY 0.0000759500. This verifies sound-event output, not correct physical
  source identification: the fixture is a synthesized continuous tone.
- A direct adapter test of pink noise returned empty transcription and
  a 00:00:00-00:00:05 noise event. It was not the binary native-host test.

Final auxiliary default is gemini-3.5-flash-lite on the existing WAWA Vertex
supply. Earlier 3.8 Flash attempts hallucinated speech on a tone, so 3.8 audio
support was removed without disabling its text service. Earlier string timestamp
attempts confused MM:SS/milliseconds; 0.2.3 requests numeric seconds, validates
range, and formats using the upstream utility. Failed HTTP/invalid observations
remain failures, not silence or quality defects. Audio inference is not
deterministic; these small fixtures are not broad language/music/engine benchmarks.

This does not certify precise lip sync, calibrated loudness, full-video defect
detection, all user keys/policies or private TapNow canvases. No real user media
was used. Audio uses the account's published model token billing; fixture costs
are observations, not a promised per-video price.
