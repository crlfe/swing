export function arrayGet<T>(items: ArrayLike<T>, index: number): T {
  if (index < 0 || index >= items.length) throw new RangeError();
  return items[index] as T;
}

export function resolvePath(oldPath: string, newPath: string): string {
  if (newPath.startsWith("/")) {
    return newPath.substring(1);
  }
  if (newPath.startsWith(".")) {
    const parts = oldPath.split("/");
    parts.pop();
    const segments = newPath.split("/");
    for (const segment of segments) {
      if (segment === ".") continue;
      else if (segment === "..") parts.pop();
      else parts.push(segment);
    }
    return parts.join("/");
  }
  if (!newPath.includes("/")) {
    const dir = oldPath.substring(0, oldPath.lastIndexOf("/"));
    return dir ? `${dir}/${newPath}` : newPath;
  }
  return newPath;
}
