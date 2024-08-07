import path from 'path';

/** Check if directory is ancestor of given directory */
export function isAncestorDirectory(parent, dir) {
  const relative = path.relative(parent, dir);
  return parent === dir || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}
