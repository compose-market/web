export function createObjectUrlPreview(file: Blob): string {
  return URL.createObjectURL(file);
}

export function revokeObjectUrlPreview(url: string | undefined): void {
  if (!url || !url.startsWith("blob:")) {
    return;
  }

  URL.revokeObjectURL(url);
}

export function revokeObjectUrlSet(urls: Iterable<string | undefined>): void {
  for (const url of urls) {
    revokeObjectUrlPreview(url);
  }
}
