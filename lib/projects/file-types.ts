export const MAX_PROJECT_FILE_SIZE = 25 * 1024 * 1024;

const allowedFiles = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
} as const;

export type AllowedProjectFileExtension = keyof typeof allowedFiles;

export function getAllowedProjectFile(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() as
    | AllowedProjectFileExtension
    | undefined;
  if (!extension || !(extension in allowedFiles)) return null;
  return { extension, mimeType: allowedFiles[extension] };
}

export function sanitizeProjectFileName(fileName: string) {
  return fileName.replace(/[\\/\0]/g, "-").replace(/\s+/g, " ").trim().slice(0, 180);
}

const mediaExtensions = new Set<AllowedProjectFileExtension>([
  "png", "jpg", "jpeg", "webp", "gif",
  "mp4", "mov", "m4v", "webm",
  "mp3", "wav", "m4a", "aac", "flac", "ogg",
]);

export function projectMaterialTarget(fileName: string) {
  const allowed = getAllowedProjectFile(fileName);
  if (!allowed) return null;
  return mediaExtensions.has(allowed.extension) ? "drive" as const : "knowledge" as const;
}
