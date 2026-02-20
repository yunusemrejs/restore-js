var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
const WATCH_ALL = "watchAll";
const NOOP_LISTENER = () => void 0;
class ReStore {
  constructor(options) {
    __publicField(this, "state");
    __publicField(this, "stateKeys");
    __publicField(this, "stateKeyToIndex");
    __publicField(this, "dirtyFlags");
    __publicField(this, "metadata");
    __publicField(this, "actions");
    __publicField(this, "mutations");
    __publicField(this, "middlewares");
    __publicField(this, "middlewareNames");
    __publicField(this, "actionCache");
    __publicField(this, "mutationCache");
    __publicField(this, "nextListenerId");
    __publicField(this, "listenerBuckets");
    __publicField(this, "listenerRegistrations");
    __publicField(this, "listenerNodePool");
    __publicField(this, "pendingFlushPromise");
    __publicField(this, "resolvePendingFlush");
    __publicField(this, "mutationSnapshot");
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;
    this.state = state;
    this.stateKeys = Object.keys(this.state);
    this.stateKeyToIndex = /* @__PURE__ */ new Map();
    for (let index = 0; index < this.stateKeys.length; index += 1) {
      this.stateKeyToIndex.set(this.stateKeys[index], index);
    }
    Object.seal(this.state);
    this.dirtyFlags = new Uint32Array(this.stateKeys.length || 1);
    this.metadata = new Uint32Array(3);
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.middlewareNames = Object.keys(this.middlewares);
    this.actionCache = { name: "", fn: null };
    this.mutationCache = { name: "", fn: null };
    this.nextListenerId = 1;
    this.listenerBuckets = /* @__PURE__ */ new Map();
    this.listenerRegistrations = /* @__PURE__ */ new Map();
    this.listenerNodePool = [];
    this.listenerBuckets.set(WATCH_ALL, { head: null, tail: null });
    this.pendingFlushPromise = null;
    this.resolvePendingFlush = null;
    this.mutationSnapshot = new Array(this.stateKeys.length);
  }
  getState() {
    return this.state;
  }
  setState(nextState) {
    this.assertStateShape(nextState);
    const localState = this.state;
    const keys = this.stateKeys;
    let dirtyCount = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const nextValue = nextState[key];
      if (localState[key] !== nextValue) {
        localState[key] = nextValue;
        if (this.dirtyFlags[index] === 0) {
          this.dirtyFlags[index] = 1;
          dirtyCount += 1;
        }
      }
    }
    if (dirtyCount > 0) {
      this.metadata[2] += dirtyCount;
      this.scheduleFlush();
    }
  }
  subscribe(listener) {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    this.metadata[0] = this.nextListenerId;
    const watchedStates = listener.watchedStates.size > 0 ? listener.watchedStates : /* @__PURE__ */ new Set([WATCH_ALL]);
    const registration = { id: listenerId, nodes: [] };
    watchedStates.forEach((stateKey) => {
      const key = stateKey === WATCH_ALL ? WATCH_ALL : stateKey;
      let bucket = this.listenerBuckets.get(key);
      if (!bucket) {
        bucket = { head: null, tail: null };
        this.listenerBuckets.set(key, bucket);
      }
      const node = this.acquireNode();
      node.id = listenerId;
      node.callback = listener.callback;
      node.key = key;
      node.prev = bucket.tail;
      node.next = null;
      if (bucket.tail) {
        bucket.tail.next = node;
      } else {
        bucket.head = node;
      }
      bucket.tail = node;
      registration.nodes.push(node);
    });
    this.listenerRegistrations.set(listenerId, registration);
    return listenerId;
  }
  unsubscribe(listenerId) {
    const registration = this.listenerRegistrations.get(listenerId);
    if (!registration) {
      return;
    }
    const { nodes } = registration;
    for (let index = 0; index < nodes.length; index += 1) {
      this.detachNode(nodes[index]);
    }
    this.listenerRegistrations.delete(listenerId);
  }
  async dispatch(actionName, payload) {
    const action = this.getAction(actionName);
    if (!action) {
      throw new Error(`Action '${actionName}' not found.`);
    }
    let processedPayload = payload;
    const middlewareNames = this.middlewareNames;
    const middlewareCollection = this.middlewares;
    for (let index = 0; index < middlewareNames.length; index += 1) {
      const middleware = middlewareCollection[middlewareNames[index]];
      processedPayload = await middleware({ actionName, payload: processedPayload });
    }
    const actionResult = action(this, processedPayload);
    const resolvedResult = await Promise.resolve(actionResult);
    if (this.pendingFlushPromise) {
      await this.pendingFlushPromise;
    }
    return resolvedResult;
  }
  async commit(mutationName, payload) {
    const mutation = this.getMutation(mutationName);
    if (!mutation) {
      throw new Error(`Mutation '${mutationName}' not found.`);
    }
    const keys = this.stateKeys;
    for (let index = 0; index < keys.length; index += 1) {
      this.mutationSnapshot[index] = this.state[keys[index]];
    }
    await mutation(this.state, payload);
    let dirtyCount = 0;
    for (let index = 0; index < keys.length; index += 1) {
      if (this.mutationSnapshot[index] !== this.state[keys[index]] && this.dirtyFlags[index] === 0) {
        this.dirtyFlags[index] = 1;
        dirtyCount += 1;
      }
    }
    if (dirtyCount === 0) {
      return;
    }
    this.metadata[2] += dirtyCount;
    this.scheduleFlush();
    if (this.pendingFlushPromise) {
      await this.pendingFlushPromise;
    }
  }
  getAction(actionName) {
    if (this.actionCache.name === actionName) {
      return this.actionCache.fn;
    }
    const action = this.actions[actionName] || null;
    this.actionCache.name = actionName;
    this.actionCache.fn = action;
    return action;
  }
  getMutation(mutationName) {
    if (this.mutationCache.name === mutationName) {
      return this.mutationCache.fn;
    }
    const mutation = this.mutations[mutationName] || null;
    this.mutationCache.name = mutationName;
    this.mutationCache.fn = mutation;
    return mutation;
  }
  scheduleFlush() {
    if (this.metadata[1] === 1) {
      return;
    }
    this.metadata[1] = 1;
    if (!this.pendingFlushPromise) {
      this.pendingFlushPromise = new Promise((resolve) => {
        this.resolvePendingFlush = resolve;
      });
    }
    queueMicrotask(() => {
      this.flushNotifications();
    });
  }
  flushNotifications() {
    this.metadata[1] = 0;
    if (this.metadata[2] === 0) {
      this.resolveFlushPromise();
      return;
    }
    this.notifyWatchAll();
    const keys = this.stateKeys;
    for (let index = 0; index < keys.length; index += 1) {
      if (this.dirtyFlags[index] === 1) {
        this.dirtyFlags[index] = 0;
        this.notifyBucket(keys[index]);
      }
    }
    this.metadata[2] = 0;
    this.resolveFlushPromise();
  }
  notifyWatchAll() {
    this.notifyBucket(WATCH_ALL);
  }
  notifyBucket(key) {
    const bucket = this.listenerBuckets.get(key);
    if (!bucket || !bucket.head) {
      return;
    }
    let node = bucket.head;
    while (node) {
      const next = node.next;
      node.callback(this.state);
      node = next;
    }
  }
  resolveFlushPromise() {
    if (this.resolvePendingFlush) {
      const resolver = this.resolvePendingFlush;
      this.resolvePendingFlush = null;
      this.pendingFlushPromise = null;
      resolver();
    }
  }
  assertStateShape(nextState) {
    const keys = Object.keys(nextState);
    if (keys.length !== this.stateKeys.length) {
      throw new Error("State shape mismatch: dynamic property add/remove is not allowed.");
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (!this.stateKeyToIndex.has(keys[index])) {
        throw new Error("State shape mismatch: dynamic property add/remove is not allowed.");
      }
    }
  }
  acquireNode() {
    const node = this.listenerNodePool.pop();
    if (node) {
      return node;
    }
    return {
      id: 0,
      callback: NOOP_LISTENER,
      key: WATCH_ALL,
      prev: null,
      next: null
    };
  }
  detachNode(node) {
    const bucket = this.listenerBuckets.get(node.key);
    if (!bucket) {
      return;
    }
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      bucket.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      bucket.tail = node.prev;
    }
    node.prev = null;
    node.next = null;
    node.callback = NOOP_LISTENER;
    this.listenerNodePool.push(node);
  }
}
function createStore(options) {
  return new ReStore(options);
}
export {
  ReStore,
  createStore
};
