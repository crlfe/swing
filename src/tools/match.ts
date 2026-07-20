/**
 * Splits a search string into lines, preserving blank lines only when the search is multi-line. A
 * single-line search that happens to be blank is dropped because it would match everywhere and is
 * almost never intended.
 */
export function splitSearchLines(search: string): string[] {
  const lines = search.split(/\r?\n/);
  if (lines.length > 1) return lines;
  return lines.filter((line) => line.trim() !== "");
}

/**
 * Finds occurrences of `searchLines` within `content` using a trimmed, line-by-line comparison that
 * is resilient to indentation differences.
 *
 * @returns The start indices (0-based) of every matching occurrence.
 */
export function findTrimmedLineMatches(
  content: ReadonlyArray<string>,
  searchLines: ReadonlyArray<string>,
): number[] {
  const trimmedSearch = searchLines.map((l) => l.trim());
  if (trimmedSearch.length === 0) return [];

  const matches: number[] = [];
  for (let i = 0; i <= content.length - trimmedSearch.length; i++) {
    let match = true;
    for (let j = 0; j < trimmedSearch.length; j++) {
      if (content[i + j]?.trim() !== trimmedSearch[j]) {
        match = false;
        break;
      }
    }
    if (match) matches.push(i);
  }
  return matches;
}

/** Convenience: returns the single match index or throws for 0 / many matches. */
export function findSingleMatch(
  content: ReadonlyArray<string>,
  searchLines: ReadonlyArray<string>,
  path: string,
): number {
  const matches = findTrimmedLineMatches(content, searchLines);
  if (matches.length === 0) {
    throw new Error(`Search string not found in file ${path} (tried line-by-line trimmed match)`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple matches found for search string in ${path}. Please be more specific with the search string to ensure only one match exists.`,
    );
  }
  const match = matches[0];
  if (match === undefined) {
    throw new Error(`Search string not found in file ${path}`);
  }
  return match;
}
