package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type videoMCPContent struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
}

func readFrames(ctx context.Context, root, file string) ([]videoMCPContent, error) {
	c := command(ctx, filepath.Join(root, program("node")), filepath.Join(root, "launch.cjs"))
	in, err := c.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := c.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	if err := c.Start(); err != nil {
		return nil, err
	}
	defer func() { in.Close(); c.Process.Kill(); c.Wait() }()
	enc := json.NewEncoder(in)
	send := func(id int, method string, p any) error {
		return enc.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": p})
	}
	if err := send(1, "initialize", map[string]any{"protocolVersion": "2024-11-05", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "acu-video-mcp", "version": version}}); err != nil {
		return nil, err
	}
	dec := json.NewDecoder(io.LimitReader(out, 8<<20))
	for {
		var r struct {
			ID     int             `json:"id"`
			Error  json.RawMessage `json:"error"`
			Result struct {
				Content []videoMCPContent `json:"content"`
				IsError bool              `json:"isError"`
			} `json:"result"`
		}
		if err := dec.Decode(&r); err != nil {
			return nil, errors.New("video MCP did not finish")
		}
		if len(r.Error) > 0 || r.Result.IsError {
			return nil, errors.New("video MCP could not decode this file")
		}
		if r.ID == 1 {
			if err := enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"}); err != nil {
				return nil, err
			}
			if err := send(2, "tools/call", map[string]any{"name": "video_info", "arguments": map[string]string{"path": file}}); err != nil {
				return nil, err
			}
		}
		if r.ID == 2 {
			var meta struct {
				Duration float64 `json:"duration_seconds"`
			}
			if len(r.Result.Content) != 1 || json.Unmarshal([]byte(r.Result.Content[0].Text), &meta) != nil || meta.Duration <= 0 || meta.Duration > 1800 {
				return nil, errors.New("video must be shorter than 30 minutes")
			}
			fps := 12 / meta.Duration
			if fps > 2 {
				fps = 2
			}
			if err := send(3, "tools/call", map[string]any{"name": "video_watch", "arguments": map[string]any{"path": file, "fps": fps, "view_sample": 12, "resolution": 640, "skip_audio": true}}); err != nil {
				return nil, err
			}
		}
		if r.ID == 3 {
			return r.Result.Content, nil
		}
	}
}
func selfTest(ctx context.Context, root string, out io.Writer) error {
	dir, err := os.MkdirTemp("", "acu-video-selftest-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "fixture.mov")
	c := command(ctx, filepath.Join(root, "bin", program("ffmpeg")), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=12", "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", file)
	if err := runCommand(c); err != nil {
		return err
	}
	parts, err := readFrames(ctx, root, file)
	if err != nil {
		return err
	}
	images, late := 0, false
	for _, p := range parts {
		if p.Type == "image" {
			images++
		}
		if strings.Contains(p.Text, "00:00:09") {
			late = true
		}
	}
	if images != 12 || !late {
		return errors.New("video sampling self-test failed")
	}
	return json.NewEncoder(out).Encode(map[string]any{"ok": true, "version": version, "frames": images, "lateFrame": late, "audioAnalyzed": false, "runtimeDependenciesDownloaded": false})
}
