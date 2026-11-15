package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeRejectsUntrustedOriginAndUnsafeURL(t *testing.T) {
	for _, origin := range []string{"chrome-extension://lohhkeighnafehcjelhlimegfgpelghg/", "https://app.tapnow.ai/", companionOrigin} {
		data := []byte(`{"action":"video-frames","version":"0.1.25","url":"https://127.0.0.1/private.mov"}`)
		var in, out bytes.Buffer
		binary.Write(&in, binary.LittleEndian, uint32(len(data)))
		in.Write(data)
		if err := native(context.Background(), origin, &in, &out); err != nil {
			t.Fatal(err)
		}
		var n uint32
		if binary.Read(&out, binary.LittleEndian, &n) != nil {
			t.Fatal("invalid frame")
		}
		var result tapnowVideoReply
		if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.OK || result.Error == "" {
			t.Fatal(result, err)
		}
	}
}
func TestVideoDownloadAndSamplingCleanTemporaryFiles(t *testing.T) {
	oldFetch, oldSample := fetchTapnowVideo, sampleVideo
	defer func() { fetchTapnowVideo, sampleVideo = oldFetch, oldSample }()
	fetchTapnowVideo = func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Referer") != "https://app.tapnow.ai/" || r.Header.Get("Authorization") != "" {
			t.Fatal(r.Header)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"video/quicktime"}}, Body: io.NopCloser(strings.NewReader("fixture"))}, nil
	}
	file := ""
	sampleVideo = func(_ context.Context, _ string, p string) ([]videoMCPContent, error) {
		file = p
		return []videoMCPContent{{Type: "image", Data: "aGVsbG8=", MimeType: "image/jpeg"}}, nil
	}
	result := tapnowFrames(context.Background(), t.TempDir(), "https://files.tapnow.media/a.mov")
	if !result.OK || result.AudioAnalyzed {
		t.Fatal(result)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("retained media")
	}
}
func TestNativeNeverRegistersBackup(t *testing.T) {
	if strings.Contains(companionOrigin, "lohhkeighnafehcjelhlimegfgpelghg") {
		t.Fatal("backup allowed")
	}
}
func TestPayloadReadyUsesPrivateVersionedCache(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	t.Setenv("USERPROFILE", root)
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	t.Setenv("LocalAppData", filepath.Join(root, "local"))
	t.Setenv("LOCALAPPDATA", filepath.Join(root, "local"))
	p, err := cacheRoot()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p, version) {
		t.Fatal(p)
	}
}

func TestNativeRejectsAudioSecretsOutsideTrustedExtension(t *testing.T) {
	data := []byte(`{"action":"video-frames","url":"https://files.tapnow.media/a.mov","audio":{"apiKey":"fixture-private-key","baseUrl":"https://console.acucompute.com/v1","model":"gemini-3.8-flash"}}`)
	var in, out bytes.Buffer
	binary.Write(&in, binary.LittleEndian, uint32(len(data)))
	in.Write(data)
	if err := native(context.Background(), "chrome-extension://lohhkeighnafehcjelhlimegfgpelghg/", &in, &out); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "fixture-private-key") || !strings.Contains(out.String(), "untrusted") {
		t.Fatal("unsafe native response")
	}
}
