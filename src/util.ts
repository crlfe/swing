export function arrayGet<T>(items: ArrayLike<T>, index: number): T {
  if (index < 0 || index >= items.length) throw new RangeError();
  return items[index] as T;
}
