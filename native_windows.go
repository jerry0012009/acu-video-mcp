package main

import (
	"encoding/json"
	"golang.org/x/sys/windows/registry"
	"os"
	"path/filepath"
)

func registerNative() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	dir = filepath.Join(dir, "ACUVideoMCP")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, _ := json.Marshal(map[string]any{"name": nativeName, "description": "ACU video reading MCP", "path": exe, "type": "stdio", "allowed_origins": []string{companionOrigin}})
	file := filepath.Join(dir, nativeName+".json")
	if err := os.WriteFile(file, data, 0600); err != nil {
		return err
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Google\Chrome\NativeMessagingHosts\`+nativeName, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue("", file)
}
