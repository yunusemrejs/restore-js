var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
class ListenerNode {
  constructor(id, callback) {
    __publicField(this, "id");
    __publicField(this, "callback");
    __publicField(this, "next");
    __publicField(this, "prev");
    __publicField(this, "active");
    __publicField(this, "bucket");
    this.id = id;
    this.callback = callback;
    this.next = null;
    this.prev = null;
    this.active = 1;
    this.bucket = null;
  }
  init(id, callback) {
    this.id = id;
    this.callback = callback;
    this.next = null;
    this.prev = null;
    this.active = 1;
    this.bucket = null;
    return this;
  }
}
class ListenerBucket {
  constructor() {
    __publicField(this, "head");
    __publicField(this, "tail");
    this.head = null;
    this.tail = null;
  }
  append(node) {
    const tail = this.tail;
    if (tail === null) {
      node.bucket = this;
      this.head = node;
      this.tail = node;
      return;
    }
    node.bucket = this;
    node.prev = tail;
    tail.next = node;
    this.tail = node;
  }
  remove(node) {
    const prev = node.prev;
    const next = node.next;
    if (prev !== null) {
      prev.next = next;
    } else {
      this.head = next;
    }
    if (next !== null) {
      next.prev = prev;
    } else {
      this.tail = prev;
    }
    node.next = null;
    node.prev = null;
    node.active = 0;
    node.bucket = null;
  }
}
class ReStore {
  constructor(options) {
    __publicField(this, "state");
    __publicField(this, "actions");
    __publicField(this, "mutations");
    __publicField(this, "middlewares");
    __publicField(this, "nextListenerId");
    __publicField(this, "listenerPool");
    __publicField(this, "listenerById");
    __publicField(this, "buckets");
    __publicField(this, "commitInfo");
    __publicField(this, "pendingChangedKeys");
    __publicField(this, "notifyQueued");
    __publicField(this, "proxyCache");
    __publicField(this, "stateProxy");
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;
    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = Object.values(middlewares);
    this.nextListenerId = 1;
    this.listenerPool = [];
    this.listenerById = /* @__PURE__ */ new Map();
    this.buckets = /* @__PURE__ */ new Map();
    this.buckets.set("watchAll", new ListenerBucket());
    this.commitInfo = new Uint32Array(4);
    this.pendingChangedKeys = /* @__PURE__ */ new Set();
    this.notifyQueued = 0;
    this.proxyCache = /* @__PURE__ */ new Map();
    this.stateProxy = new Proxy(this.state, {
      get: (target, key) => {
        if (typeof key !== "string") {
          return Reflect.get(target, key);
        }
        const cached = this.proxyCache.get(key);
        if (cached !== void 0 || this.proxyCache.has(key)) {
          return cached;
        }
        const value = target[key];
        this.proxyCache.set(key, value);
        return value;
      },
      set: (target, key, value) => {
        if (typeof key === "string") {
          target[key] = value;
          this.proxyCache.set(key, value);
          this.queueKeyForNotify(key);
          return true;
        }
        return Reflect.set(target, key, value);
      }
    });
  }
  getState() {
    return this.state;
  }
  getStateProxy() {
    return this.stateProxy;
  }
  setState(state) {
    this.state = state;
    this.proxyCache.clear();
    this.commitInfo[0] = this.commitInfo[0] + 1 >>> 0;
    this.queueNotifyAll();
  }
  subscribe(listener) {
    const listenerId = this.nextListenerId++;
    const watchedStates = listener.watchedStates;
    const targetKeys = watchedStates.size === 0 ? null : watchedStates;
    const handle = { nodes: [] };
    if (targetKeys === null) {
      const bucket = this.getBucket("watchAll");
      const node = this.acquireNode(listenerId, listener.callback);
      bucket.append(node);
      handle.nodes.push(node);
    } else {
      for (const stateKey of targetKeys) {
        const bucket = this.getBucket(stateKey);
        const node = this.acquireNode(listenerId, listener.callback);
        bucket.append(node);
        handle.nodes.push(node);
      }
    }
    this.listenerById.set(listenerId, handle);
    return listenerId;
  }
  unsubscribe(listenerId) {
    const handle = this.listenerById.get(listenerId);
    if (!handle) {
      return;
    }
    for (let i = 0; i < handle.nodes.length; i += 1) {
      const node = handle.nodes[i];
      if (!node || node.active === 0) {
        continue;
      }
      const bucket = node.bucket;
      if (bucket) {
        bucket.remove(node);
        this.listenerPool.push(node);
      }
    }
    this.listenerById.delete(listenerId);
  }
  notify(changedKeys) {
    if (!changedKeys || changedKeys.size === 0) {
      this.callBucket(this.getBucket("watchAll"));
      this.buckets.forEach((bucket, key) => {
        if (key === "watchAll") {
          return;
        }
        this.callBucket(bucket);
      });
      return;
    }
    this.callBucket(this.getBucket("watchAll"));
    changedKeys.forEach((key) => {
      const bucket = this.buckets.get(key);
      if (bucket) {
        this.callBucket(bucket);
      }
    });
  }
  async dispatch(actionName, payload) {
    const action = this.actions[actionName];
    if (!action) {
      throw new Error(`Action '${actionName}' not found.`);
    }
    let processedPayload = payload;
    for (let i = 0; i < this.middlewares.length; i += 1) {
      const middleware = this.middlewares[i];
      processedPayload = await middleware({
        actionName,
        payload: processedPayload
      });
    }
    const actionResult = action(this, processedPayload);
    await Promise.resolve();
    return actionResult;
  }
  async commit(mutationName, payload) {
    const mutation = this.mutations[mutationName];
    if (!mutation) {
      throw new Error(`Mutation '${mutationName}' not found.`);
    }
    this.commitInfo[1] = this.commitInfo[1] + 1 >>> 0;
    const beforeVersion = this.commitInfo[0];
    const beforeState = this.state;
    const previousKeys = Object.keys(this.state);
    const previousValues = new Array(previousKeys.length);
    const previousKeySet = new Set(previousKeys);
    for (let i = 0; i < previousKeys.length; i += 1) {
      previousValues[i] = this.state[previousKeys[i]];
    }
    await mutation(this.state, payload);
    this.commitInfo[0] = beforeVersion + 1 >>> 0;
    if (beforeState !== this.state) {
      this.proxyCache.clear();
      this.queueNotifyAll();
      return;
    }
    for (let i = 0; i < previousKeys.length; i += 1) {
      const key = previousKeys[i];
      if (this.state[key] !== previousValues[i]) {
        this.queueKeyForNotify(key);
      }
    }
    const currentKeys = Object.keys(this.state);
    for (let i = 0; i < currentKeys.length; i += 1) {
      const key = currentKeys[i];
      if (!previousKeySet.has(key)) {
        this.queueKeyForNotify(key);
      }
    }
  }
  queueKeyForNotify(key) {
    this.pendingChangedKeys.add(key);
    if ((this.notifyQueued & 1) === 1) {
      return;
    }
    this.notifyQueued = 1;
    queueMicrotask(() => {
      this.flushNotifyQueue();
    });
  }
  queueNotifyAll() {
    this.pendingChangedKeys.clear();
    if ((this.notifyQueued & 1) === 1) {
      return;
    }
    this.notifyQueued = 1;
    queueMicrotask(() => {
      this.flushNotifyQueue(true);
    });
  }
  flushNotifyQueue(forceAll = false) {
    this.notifyQueued = 0;
    if (forceAll) {
      this.notify();
      this.pendingChangedKeys.clear();
      return;
    }
    if (this.pendingChangedKeys.size === 0) {
      return;
    }
    const changedKeys = new Set(this.pendingChangedKeys);
    this.pendingChangedKeys.clear();
    this.notify(changedKeys);
  }
  getBucket(key) {
    const existing = this.buckets.get(key);
    if (existing) {
      return existing;
    }
    const bucket = new ListenerBucket();
    this.buckets.set(key, bucket);
    return bucket;
  }
  acquireNode(id, callback) {
    const recycled = this.listenerPool.pop();
    if (recycled) {
      return recycled.init(id, callback);
    }
    return new ListenerNode(id, callback);
  }
  callBucket(bucket) {
    let node = bucket.head;
    while (node !== null) {
      if (node.active === 1) {
        node.callback(this.state);
      }
      node = node.next;
    }
  }
}
function createStore(options) {
  return new ReStore(options);
}
export {
  ReStore,
  createStore
};
