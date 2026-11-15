package main

import (
	"context"
	"golang.org/x/sys/windows"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func command(ctx context.Context, name string, args ...string) *exec.Cmd {
	c := exec.CommandContext(ctx, name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return c
}
func runCommand(c *exec.Cmd) error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(job)
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		return err
	}
	if err := c.Start(); err != nil {
		return err
	}
	p, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(c.Process.Pid))
	if err != nil {
		c.Process.Kill()
		c.Wait()
		return err
	}
	err = windows.AssignProcessToJobObject(job, p)
	windows.CloseHandle(p)
	if err != nil {
		c.Process.Kill()
		c.Wait()
		return err
	}
	return c.Wait()
}
func serveUpstream(ctx context.Context, root string, in io.Reader, out io.Writer) error {
	c := command(ctx, filepath.Join(root, "node.exe"), filepath.Join(root, "launch.cjs"))
	c.Stdin, c.Stdout, c.Stderr = in, out, os.Stderr
	return runCommand(c)
}
