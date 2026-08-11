import { Response, Request } from 'express';

// Express equivalent of the source's ReadableStream + `send()` pattern:
// same headers, same 3s ping heartbeat, same "abort in-flight fal calls on
// client disconnect" behavior (via req's 'close' event instead of a Request
// object's .signal, since Express's req doesn't have one natively).
export interface SseSession {
  send: (data: unknown) => void;
  close: () => void;
  signal: AbortSignal;
}

export function startSse(req: Request, res: Response): SseSession {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (data: unknown) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client likely disconnected - ignore
    }
  };

  const pingInterval = setInterval(() => send({ type: 'ping' }), 3000);

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  const close = () => {
    clearInterval(pingInterval);
    try {
      res.end();
    } catch {
      // ignore
    }
  };

  return { send, close, signal: abortController.signal };
}
