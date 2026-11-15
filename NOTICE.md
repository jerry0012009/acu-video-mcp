# Third-Party Components

This is an independent distribution adapter, not Magpie or an official release
of claude-video-vision. It does not fork Magpie or replace its update channel.

- claude-video-vision 1.4.0 by Jordan Vasconcelos, MIT:
  https://github.com/jordanrendric/claude-video-vision
- Node.js 24.22.3, MIT plus bundled notices: https://nodejs.org/dist/v24.22.3/
- FFmpeg/FFprobe binaries from @ffmpeg-installer/ffmpeg 1.1.0 and
  @ffprobe-installer/ffprobe 2.1.2. Platform-specific LGPL/GPL terms and
  source/build provenance are retained in their packages:
  https://github.com/ffmpeg-installer/ffmpeg-installer
  https://github.com/descriptinc/ffprobe-installer
  https://ffmpeg.org/

The executable extracts unchanged dependency files to a per-user cache; all
package notices remain in the payload. FFmpeg is a separate process, not linked
into the adapter. No runtime npm install, provider key or inference is needed
to extract frames. Upstream licensing applies to each included component.
