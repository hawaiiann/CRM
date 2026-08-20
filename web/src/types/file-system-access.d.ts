// Minimal ambient types for the File System Access API — not yet part of TS's
// bundled DOM lib. Only the members diskBackup.ts actually uses.
export {}

declare global {
  type FileSystemPermissionMode = "read" | "readwrite"

  interface FileSystemHandlePermissionDescriptor {
    mode?: FileSystemPermissionMode
  }

  interface FileSystemDirectoryHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: "read" | "readwrite"
    startIn?: string
  }

  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  }
}
