//go:build !windows

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

func registerNative() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	base := filepath.Join(home, ".config")
	if x := os.Getenv("XDG_CONFIG_HOME"); filepath.IsAbs(x) {
		base = x
	}
	dirs := []string{filepath.Join(base, "google-chrome", "NativeMessagingHosts"), filepath.Join(base, "chromium", "NativeMessagingHosts"), filepath.Join(base, "google-chrome-for-testing", "NativeMessagingHosts")}
	if runtime.GOOS == "darwin" {
		dirs = []string{filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")}
	}
	data, _ := json.Marshal(map[string]any{"name": nativeName, "description": "ACU video reading MCP", "path": exe, "type": "stdio", "allowed_origins": []string{companionOrigin}})
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, nativeName+".json"), data, 0600); err != nil {
			return err
		}
	}
	return nil
}
