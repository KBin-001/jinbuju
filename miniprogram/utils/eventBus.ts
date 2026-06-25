type Handler = (payload?: any) => void;

const channels = new Map<string, Set<Handler>>();

export function on(event: string, handler: Handler): void {
  let set = channels.get(event);
  if (!set) {
    set = new Set();
    channels.set(event, set);
  }
  set.add(handler);
}

export function off(event: string, handler: Handler): void {
  const set = channels.get(event);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) channels.delete(event);
}

export function emit(event: string, payload?: any): void {
  const set = channels.get(event);
  if (!set) return;
  set.forEach((handler) => {
    try {
      handler(payload);
    } catch (error) {
      console.error("[eventBus]", error);
    }
  });
}
