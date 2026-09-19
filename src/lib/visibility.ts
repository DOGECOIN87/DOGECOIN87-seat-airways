export function visibilityAwareInterval(
  task: () => void | Promise<void>,
  intervalMs: number,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const schedule = () => {
    if (stopped || document.visibilityState === 'hidden') return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, intervalMs);
  };

  const run = async () => {
    if (stopped || document.visibilityState === 'hidden' || running) return;
    running = true;
    try {
      await task();
    } finally {
      running = false;
      schedule();
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      if (timer) clearTimeout(timer);
      timer = undefined;
    } else {
      void run();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  void run();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export function abortableFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timeout));
}
