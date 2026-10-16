// Minimal server-sent-events framing, shared by the server (format) and the browser (parse).
export const sseFrame = (stage, data) => `event: ${stage}\ndata: ${JSON.stringify(data)}\n\n`;

// Split a text buffer into complete events plus the unfinished rest.
export function parseSse(buf) {
  const events = [];
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i); buf = buf.slice(i + 2);
    const stage = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (stage) events.push({ stage, data: data ? JSON.parse(data) : {} });
  }
  return { events, rest: buf };
}
