import { resolve, normalize, relative, isAbsolute } from 'node:path';

export function validatePath(basePath: string, requestedPath: string): string {
  const resolved = normalize(resolve(basePath, requestedPath));

  if (!resolved.startsWith(resolve(basePath))) {
    throw new Error('Path traversal denied');
  }

  return resolved;
}

export function isPathInside(basePath: string, targetPath: string): boolean {
  const rel = relative(resolve(basePath), resolve(targetPath));
  return !rel.startsWith('..') && !isAbsolute(rel);
}
