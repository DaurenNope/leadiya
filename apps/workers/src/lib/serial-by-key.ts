const tails = new Map<string, Promise<unknown>>()

export async function enqueueSerialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  tails.set(key, run)
  try {
    return await run
  } finally {
    if (tails.get(key) === run) {
      tails.delete(key)
    }
  }
}
