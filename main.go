package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const version = "0.1.0"
const nativeName = "com.acucompute.video"
const companionOrigin = "chrome-extension://illffggofpdcjmdcenajnbmnokoclabh/"

//go:embed bundle/*
var payload embed.FS

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(ctx context.Context, args []string, in io.Reader, out io.Writer) error {
	if len(args) > 0 && strings.HasPrefix(args[0], "chrome-extension://") {
		return native(ctx, args[0], in, out)
	}
	if len(args) == 1 && args[0] == "--version" {
		_, err := fmt.Fprintln(out, "acu-video-mcp "+version)
		return err
	}
	root, err := preparePayload()
	if err != nil {
		return err
	}
	if len(args) == 1 && args[0] == "--prepare" {
		return json.NewEncoder(out).Encode(map[string]any{"schema": 1, "ready": true, "version": version})
	}
	if len(args) == 1 && args[0] == "--register-native" {
		return registerNative()
	}
	if len(args) == 1 && args[0] == "--self-test" {
		return selfTest(ctx, root, out)
	}
	if len(args) != 0 {
		return errors.New("usage: acu-video-mcp [--version|--prepare|--self-test|--register-native]")
	}
	return serveUpstream(ctx, root, in, out)
}
func cacheRoot() (string, error) {
	d, e := os.UserCacheDir()
	return filepath.Join(d, "acu-video-mcp", version, runtime.GOOS+"-"+runtime.GOARCH), e
}
func preparePayload() (string, error) {
	data, err := payload.ReadFile("bundle/payload.zip")
	if err != nil {
		return "", errors.New("this executable has no packaged dependencies")
	}
	sum := sha256.Sum256(data)
	root, err := cacheRoot()
	if err != nil {
		return "", err
	}
	root = filepath.Join(root, hex.EncodeToString(sum[:8]))
	if ready, err := os.ReadFile(filepath.Join(root, ".ready")); err == nil && string(ready) == hex.EncodeToString(sum[:]) {
		if _, err := os.Stat(filepath.Join(root, program("node"))); err == nil {
			return root, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(root), 0700); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(filepath.Dir(root), ".unpack-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var total uint64
	for _, f := range z.File {
		clean := filepath.Clean(filepath.FromSlash(f.Name))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.Contains(f.Name, "\\") {
			return "", errors.New("unsafe payload path")
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if !f.Mode().IsRegular() {
			return "", errors.New("nonregular payload file")
		}
		total += f.UncompressedSize64
		if total > 600<<20 || f.UncompressedSize64 > 180<<20 {
			return "", errors.New("payload too large")
		}
		dest := filepath.Join(stage, clean)
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return "", err
		}
		r, err := f.Open()
		if err != nil {
			return "", err
		}
		w, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
		if err != nil {
			r.Close()
			return "", err
		}
		_, copyErr := io.Copy(w, io.LimitReader(r, int64(f.UncompressedSize64)+1))
		err = errors.Join(copyErr, w.Close(), r.Close())
		if err != nil {
			return "", err
		}
	}
	if err := os.WriteFile(filepath.Join(stage, ".ready"), []byte(hex.EncodeToString(sum[:])), 0600); err != nil {
		return "", err
	}
	if err := os.Rename(stage, root); err != nil {
		if _, check := os.Stat(filepath.Join(root, ".ready")); check != nil {
			return "", err
		}
	}
	return root, nil
}
func program(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}
func native(ctx context.Context, origin string, in io.Reader, out io.Writer) error {
	reply := func(value any) error {
		b, e := json.Marshal(value)
		if e != nil {
			return e
		}
		if len(b) > 900<<10 {
			return errors.New("native response too large")
		}
		if e := binary.Write(out, binary.LittleEndian, uint32(len(b))); e != nil {
			return e
		}
		_, e = out.Write(b)
		return e
	}
	fail := func(message string) error { return reply(map[string]any{"ok": false, "error": message}) }
	if origin != companionOrigin {
		return fail("untrusted extension origin")
	}
	var n uint32
	if binary.Read(in, binary.LittleEndian, &n) != nil || n == 0 || n > 16<<10 {
		return fail("invalid native request")
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(in, b); err != nil {
		return fail("invalid native request")
	}
	var req struct {
		Action  string `json:"action"`
		Version string `json:"version"`
		URL     string `json:"url"`
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if d.Decode(&req) != nil || d.Decode(&struct{}{}) != io.EOF || req.Action != "video-frames" {
		return fail("invalid native operation")
	}
	if _, err := tapnowVideoURL(req.URL); err != nil {
		return fail(err.Error())
	}
	root, err := preparePayload()
	if err != nil {
		return fail("video dependencies unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 85*time.Second)
	defer cancel()
	return reply(tapnowFrames(ctx, root, req.URL))
}
