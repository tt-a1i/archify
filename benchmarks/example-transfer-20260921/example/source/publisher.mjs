// Synthetic source for a worked example; no external service or persistence is implied.
export function createPublisher({authorize, convert, save, onSkip}) {
  let closed = false;
  let published = 0;
  return {
    async publish(text) {
      if (closed) {
        await onSkip('closed');
        return {kind: 'skipped'};
      }
      if (!await authorize(text)) {
        await onSkip('denied');
        return {kind: 'skipped'};
      }
      const document = await convert(text);
      await save(document);
      published += 1;
      return {kind: 'published', document};
    },
    close() { closed = true; },
    status() { return {closed, published}; },
  };
}
