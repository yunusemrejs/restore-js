var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
const WATCH_ALL_KEY = "watchAll";
class ReStore {
  constructor(options) {
    __publicField(this, "state");
    __publicField(this, "stateProxy");
    __publicField(this, "actions");
    __publicField(this, "mutations");
    __publicField(this, "middlewares");
    __publicField(this, "middlewareKeys");
    __publicField(this, "middlewareContext");
    __publicField(this, "stateKeys");
    __publicField(this, "stateKeyIndex", /* @__PURE__ */ new Map());
    __publicField(this, "bucketKeyIndex", /* @__PURE__ */ new Map());
    __publicField(this, "listenerBuckets", []);
    __publicField(this, "subscriptionMap", /* @__PURE__ */ new Map());
    __publicField(this, "freeNodePool", []);
    __publicField(this, "bitset");
    __publicField(this, "counters", new Uint32Array(4));
    __publicField(this, "nextListenerId", 1);
    __publicField(this, "notifyEpoch", 1);
    __publicField(this, "notifyMarks", new Uint32Array(64));
    __publicField(this, "pendingFlush", false);
    __publicField(this, "flushPromise", null);
    __publicField(this, "resolveFlush", null);
    __publicField(this, "pendingCommit", null);
    __publicField(this, "flushNotifications", () => {
      this.pendingFlush = false;
      if (this.counters[0] === 0) {
        if (this.resolveFlush) {
          this.resolveFlush();
        }
        this.flushPromise = null;
        this.resolveFlush = null;
        return;
      }
      this.notifyEpoch += 1;
      this.flushBucket(this.bucketKeyIndex.get(WATCH_ALL_KEY));
      for (let keyIndex = 0; keyIndex < this.stateKeys.length; keyIndex += 1) {
        const block = keyIndex >>> 5;
        const bit = keyIndex & 31;
        if ((this.bitset[block] & 1 << bit) !== 0) {
          this.flushBucket(keyIndex);
        }
      }
      this.resetDirty();
      if (this.resolveFlush) {
        this.resolveFlush();
      }
      this.flushPromise = null;
      this.resolveFlush = null;
    });
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.middlewareKeys = Object.keys(middlewares);
    this.middlewareContext = { actionName: "", payload: void 0 };
    this.state = state;
    this.stateKeys = Object.keys(state);
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const stateKey = this.stateKeys[i];
      this.stateKeyIndex.set(stateKey, i);
      this.bucketKeyIndex.set(stateKey, i);
      this.listenerBuckets.push({ head: null, tail: null });
    }
    const watchAllIndex = this.listenerBuckets.length;
    this.bucketKeyIndex.set(WATCH_ALL_KEY, watchAllIndex);
    this.listenerBuckets.push({ head: null, tail: null });
    this.bitset = new Uint32Array(Math.max(1, Math.ceil(this.stateKeys.length / 32)));
    this.stateProxy = this.createStateProxy();
  }
  createStateProxy() {
    const store = this;
    return new Proxy(this.state, {
      set(target, prop, value) {
        if (typeof prop !== "string") {
          return false;
        }
        const keyIndex = store.stateKeyIndex.get(prop);
        if (keyIndex === void 0) {
          throw new Error(`State key '${prop}' is not part of the static state shape.`);
        }
        const current = target[prop];
        if (current !== value) {
          target[prop] = value;
          store.markDirty(keyIndex);
        }
        return true;
      },
      deleteProperty() {
        throw new Error("delete is not allowed on state objects because state shape is static.");
      }
    });
  }
  ensureNotifyMarkCapacity(listenerId) {
    if (listenerId < this.notifyMarks.length) {
      return;
    }
    let newLength = this.notifyMarks.length;
    while (listenerId >= newLength) {
      newLength <<= 1;
    }
    const next = new Uint32Array(newLength);
    next.set(this.notifyMarks);
    this.notifyMarks = next;
  }
  markDirty(keyIndex) {
    const block = keyIndex >>> 5;
    const bit = keyIndex & 31;
    const mask = 1 << bit;
    if ((this.bitset[block] & mask) === 0) {
      this.bitset[block] |= mask;
      this.counters[0] += 1;
    }
  }
  resetDirty() {
    for (let i = 0; i < this.bitset.length; i += 1) {
      this.bitset[i] = 0;
    }
    this.counters[0] = 0;
  }
  appendNode(bucketIndex, node) {
    const bucket = this.listenerBuckets[bucketIndex];
    if (bucket.tail === null) {
      bucket.head = node;
      bucket.tail = node;
      node.prev = null;
      node.next = null;
      return;
    }
    node.prev = bucket.tail;
    node.next = null;
    bucket.tail.next = node;
    bucket.tail = node;
  }
  removeNode(node) {
    const bucket = this.listenerBuckets[node.bucketIndex];
    const prevNode = node.prev;
    const nextNode = node.next;
    if (prevNode === null) {
      bucket.head = nextNode;
    } else {
      prevNode.next = nextNode;
    }
    if (nextNode === null) {
      bucket.tail = prevNode;
    } else {
      nextNode.prev = prevNode;
    }
    node.prev = null;
    node.next = null;
  }
  getOrCreateBucketIndex(key) {
    const existing = this.bucketKeyIndex.get(key);
    if (existing !== void 0) {
      return existing;
    }
    const bucketIndex = this.listenerBuckets.length;
    this.bucketKeyIndex.set(key, bucketIndex);
    this.listenerBuckets.push({ head: null, tail: null });
    return bucketIndex;
  }
  getNode(id, callback, bucketIndex) {
    const pooled = this.freeNodePool.pop();
    if (pooled) {
      pooled.id = id;
      pooled.callback = callback;
      pooled.bucketIndex = bucketIndex;
      pooled.prev = null;
      pooled.next = null;
      return pooled;
    }
    return {
      id,
      callback,
      bucketIndex,
      prev: null,
      next: null
    };
  }
  invokeNode(node) {
    const listenerId = node.id;
    if (this.notifyMarks[listenerId] === this.notifyEpoch) {
      return;
    }
    this.notifyMarks[listenerId] = this.notifyEpoch;
    node.callback(this.state);
  }
  flushBucket(bucketIndex) {
    let cursor = this.listenerBuckets[bucketIndex].head;
    while (cursor !== null) {
      this.invokeNode(cursor);
      cursor = cursor.next;
    }
  }
  scheduleFlush() {
    if (!this.flushPromise) {
      this.flushPromise = new Promise((resolve) => {
        this.resolveFlush = resolve;
      });
    }
    if (!this.pendingFlush) {
      this.pendingFlush = true;
      queueMicrotask(this.flushNotifications);
    }
    return this.flushPromise;
  }
  getState() {
    return this.state;
  }
  setState(state) {
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const key = this.stateKeys[i];
      const nextValue = state[key];
      if (this.state[key] !== nextValue) {
        this.state[key] = nextValue;
        this.markDirty(i);
      }
    }
    if (this.counters[0] > 0) {
      this.flushNotifications();
    }
  }
  subscribe(listener) {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    this.ensureNotifyMarkCapacity(listenerId);
    const watchedStates = listener.watchedStates;
    const subscription = {
      id: listenerId,
      callback: listener.callback,
      nodes: []
    };
    if (!watchedStates || watchedStates.size === 0) {
      const bucketIndex = this.bucketKeyIndex.get(WATCH_ALL_KEY);
      const node = this.getNode(listenerId, listener.callback, bucketIndex);
      this.appendNode(bucketIndex, node);
      subscription.nodes.push(node);
      this.subscriptionMap.set(listenerId, subscription);
      return listenerId;
    }
    watchedStates.forEach((stateKey) => {
      const bucketIndex = this.getOrCreateBucketIndex(String(stateKey));
      const node = this.getNode(listenerId, listener.callback, bucketIndex);
      this.appendNode(bucketIndex, node);
      subscription.nodes.push(node);
    });
    this.subscriptionMap.set(listenerId, subscription);
    return listenerId;
  }
  unsubscribe(listenerId) {
    const subscription = this.subscriptionMap.get(listenerId);
    if (!subscription) {
      return;
    }
    for (let i = 0; i < subscription.nodes.length; i += 1) {
      const node = subscription.nodes[i];
      this.removeNode(node);
      this.freeNodePool.push(node);
    }
    subscription.nodes.length = 0;
    this.subscriptionMap.delete(listenerId);
  }
  notify(changedKeys) {
    if (!changedKeys || changedKeys.size === 0) {
      for (let i = 0; i < this.stateKeys.length; i += 1) {
        this.markDirty(i);
      }
      this.flushNotifications();
      return;
    }
    changedKeys.forEach((key) => {
      const keyIndex = this.stateKeyIndex.get(String(key));
      if (keyIndex !== void 0) {
        this.markDirty(keyIndex);
      }
    });
    if (this.counters[0] > 0) {
      this.flushNotifications();
    }
  }
  async dispatch(actionName, payload) {
    const action = this.actions[actionName];
    if (!action) {
      throw new Error(`Action '${actionName}' not found.`);
    }
    let processedPayload = payload;
    this.middlewareContext.actionName = actionName;
    for (let i = 0; i < this.middlewareKeys.length; i += 1) {
      const middlewareKey = this.middlewareKeys[i];
      const middleware = this.middlewares[middlewareKey];
      this.middlewareContext.payload = processedPayload;
      processedPayload = await middleware(this.middlewareContext);
    }
    const actionResult = action(this, processedPayload);
    if (actionResult && typeof actionResult.then === "function") {
      await actionResult;
    }
    if (this.pendingCommit) {
      await this.pendingCommit;
    }
    return actionResult;
  }
  async commit(mutationName, payload) {
    const mutation = this.mutations[mutationName];
    if (!mutation) {
      throw new Error(`Mutation '${mutationName}' not found.`);
    }
    const commitPromise = (async () => {
      await mutation(this.stateProxy, payload);
      if (this.counters[0] === 0) {
        return;
      }
      await this.scheduleFlush();
    })();
    this.pendingCommit = commitPromise;
    await commitPromise;
    if (this.pendingCommit === commitPromise) {
      this.pendingCommit = null;
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
