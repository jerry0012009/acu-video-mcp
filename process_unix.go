//go:build !windows

package main

import (
	"context"
	"io"
	"os"
	"os/exec"
	"syscall"
)

func command(ctx context.Context, name string, args ...string) *exec.Cmd {
	c := exec.CommandContext(ctx, name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	c.Cancel = func() error { return syscall.Kill(-c.Process.Pid, syscall.SIGKILL) }
	return c
}
func runCommand(c *exec.Cmd) error {
	if err := c.Start(); err != nil {
		return err
	}
	defer syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
	return c.Wait()
}
func serveUpstream(ctx context.Context, root string, in io.Reader, out io.Writer) error {
	c := command(ctx, root+"/node", root+"/launch.cjs")
	c.Stdin, c.Stdout, c.Stderr = in, out, os.Stderr
	return runCommand(c)
}
