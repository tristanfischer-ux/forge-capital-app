/** Load rows for a long id list in PostgREST-safe batches. */
export async function inChunks<T>(
  ids: string[],
  load: (chunk: string[]) => Promise<T[]>,
  size = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    if (!chunk.length) continue;
    out.push(...(await load(chunk)));
  }
  return out;
}
