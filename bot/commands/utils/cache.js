const store = new Map();

function nowMs() {
  return Date.now();
}

function cleanupExpired(limit = 50) {
  const t = nowMs();
  let cleaned = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAtMs <= t) {
      store.delete(key);
      cleaned += 1;
      if (cleaned >= limit) break;
    }
  }
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAtMs <= nowMs()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expiresAtMs: nowMs() + ttlMs });
}

function del(key) {
  store.delete(key);
}

function delPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

async function getOrSet(key, ttlMs, loaderFn) {
  const cached = get(key);
  if (cached !== undefined) return cached;

  const value = await loaderFn();
  set(key, value, ttlMs);
  cleanupExpired();
  return value;
}

module.exports = {
  get,
  set,
  del,
  delPrefix,
  getOrSet,
};

