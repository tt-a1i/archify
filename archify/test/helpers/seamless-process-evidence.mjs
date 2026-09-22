import fs from 'node:fs';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Browser adapters supply actual screenshots and drained rAF observations.
// Persist each acquired batch before the next browser call: a detached target,
// failed capture or failed final drain must not erase evidence already read.
export async function collectProcessEvidence({ directory, read, capture, timestamp, action,
  interval = () => pause(60), settle = () => pause(180) }) {
  fs.mkdirSync(directory, { recursive: true });
  const data = { frames: [], events: [], images: [], errors: [] };
  let sampling = true;
  const failed = (phase, error) => { data.errors.push({ phase, error }); };
  const persist = () => {
    fs.writeFileSync(path.join(directory, 'frames.json'), `${JSON.stringify({ frames: data.frames, events: data.events }, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, 'captures.json'), `${JSON.stringify(data.images, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, 'collection.json'), `${JSON.stringify({
      complete: !sampling && data.errors.length === 0,
      errors: data.errors.map(({ phase, error }) => ({ phase, name: error.name, message: error.message })),
    }, null, 2)}\n`);
  };
  const drain = async () => {
    const batch = await read();
    data.frames.push(...(batch.frames || []));
    data.events.push(...(batch.events || []));
    persist();
    return batch.sample;
  };
  persist();
  const captures = (async () => {
    while (sampling) {
      const before = await drain();
      // A full document navigation can temporarily leave no target document.
      // Do not mislabel about:blank or a previous document as a target frame.
      if (!before) { await interval(); continue; }
      const image = await capture();
      const file = `${String(data.images.length).padStart(4, '0')}.png`;
      fs.writeFileSync(path.join(directory, file), Buffer.from(image.data, 'base64'));
      const entry = { file, before: before.at, after: null, href: before.href,
        visible: before.frames.filter(frame => frame.visible).map(frame => frame.diagram) };
      data.images.push(entry);
      persist();
      entry.after = await timestamp();
      persist();
      if (sampling) await interval();
    }
  })().catch(error => failed('capture', error));
  try { await action(); await settle(); }
  catch (error) { failed('action', error); }
  finally {
    sampling = false;
    await captures;
    try { await drain(); } catch (error) { failed('final-drain', error); }
    persist();
  }
  return data;
}
