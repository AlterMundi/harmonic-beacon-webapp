import { existsSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';

const SUPPORTED_EXTENSIONS = new Set(['.ogg', '.wav']);

function supportedAudioFile(path: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Resolve an explicit production source, or scan the records directory. */
export function resolvePlaylist(recordsPath: string, configuredFile?: string): string[] {
  if (!existsSync(recordsPath)) return [];

  const selected = configuredFile?.trim();
  if (selected) {
    const selectedPath = resolve(isAbsolute(selected) ? selected : join(recordsPath, selected));
    const recordsRoot = `${resolve(recordsPath)}/`;
    if (!selectedPath.startsWith(recordsRoot) || !supportedAudioFile(selectedPath)) return [];
    return existsSync(selectedPath) ? [selectedPath] : [];
  }

  return readdirSync(recordsPath)
    .filter(supportedAudioFile)
    .sort()
    .map((file) => join(recordsPath, file));
}
