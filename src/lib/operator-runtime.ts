import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

/** Credential files are local root custody, never stdout, argv or environment. */
export async function requireRootPath(file: string, existing = true) {
    if (!path.isAbsolute(file) || path.normalize(file) !== file) throw new Error('Absolute normalized path required');
    let current = existing ? file : path.dirname(file);
    while (true) {
        const info = await lstat(current);
        if (info.uid !== 0 || info.isSymbolicLink() || (info.mode & 0o022)) throw new Error('Unsafe root file custody');
        if (current === file && (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600)) {
            throw new Error('Private file must be a single-link root-owned 0600 regular file');
        }
        if (current === '/') break;
        current = path.dirname(current);
    }
}

export async function createRootOutput(file: string) {
    await requireRootPath(file, false);
    return open(file, 'wx', 0o600);
}
