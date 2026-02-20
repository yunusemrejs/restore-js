var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
const WATCH_ALL_KEY = "watchAll";
const EMPTY_STATE = /* @__PURE__ */ Object.create(null);
class ReStore {
  constructor(options) {
    __publicField(this, "state");
    __publicField(this, "actions");
    __publicField(this, "mutations");
    __publicField(this, "middlewares");
    __publicField(this, "middlewareKeys");
    __publicField(this, "stateKeys");
    __publicField(this, "stateKeyIndex");
    __publicField(this, "nextListenerId");
    __publicField(this, "listHead");
    __publicField(this, "listTail");
    __publicField(this, "changedKeyWords");
    __publicField(this, "subscriptionNodes");
    __publicField(this, "freeNodeHead");
    __publicField(this, "nodeCount");
    __publicField(this, "listenerNodeHeadById");
    __publicField(this, "listenerEpochById");
    __publicField(this, "epochCounter");
    __publicField(this, "previousStateValues");
    __publicField(this, "isFlushScheduled");
    __publicField(this, "pendingFlushPromise");
    __publicField(this, "resolveFlushPromise");
    const { state, actions = EMPTY_STATE, mutations = EMPTY_STATE, middlewares = EMPTY_STATE } = options;
    this.stateKeys = Object.keys(state);
    this.stateKeyIndex = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      this.stateKeyIndex.set(this.stateKeys[i], i);
    }
    this.state = this.createShapedState(state);
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.middlewareKeys = Object.keys(middlewares);
    this.nextListenerId = 1;
    const listCount = this.stateKeys.length + 1;
    this.listHead = new Int32Array(listCount);
    this.listTail = new Int32Array(listCount);
    this.listHead.fill(-1);
    this.listTail.fill(-1);
    this.changedKeyWords = new Uint32Array(Math.max(1, Math.ceil(this.stateKeys.length / 32)));
    this.subscriptionNodes = [];
    this.freeNodeHead = -1;
    this.nodeCount = 0;
    this.listenerNodeHeadById = new Int32Array(32);
    this.listenerNodeHeadById.fill(-1);
    this.listenerEpochById = new Uint32Array(32);
    this.epochCounter = 1;
    this.previousStateValues = new Array(this.stateKeys.length);
    this.isFlushScheduled = 0;
    this.pendingFlushPromise = null;
    this.resolveFlushPromise = null;
  }
  getState() {
    return this.state;
  }
  setState(state) {
    this.state = this.createShapedState(state);
    this.markAllChanged();
    this.scheduleFlush();
  }
  subscribe(listener) {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    this.ensureListenerCapacity(listenerId + 1);
    const watchedStates = listener.watchedStates && listener.watchedStates.size > 0 ? listener.watchedStates : /* @__PURE__ */ new Set([WATCH_ALL_KEY]);
    for (const stateKey of watchedStates) {
      const listIndex = this.getListIndex(stateKey);
      if (listIndex === -1) {
        continue;
      }
      this.attachNode(listenerId, listIndex, listener.callback);
    }
    return listenerId;
  }
  unsubscribe(listenerId) {
    if (listenerId <= 0 || listenerId >= this.listenerNodeHeadById.length) {
      return;
    }
    let nodeIndex = this.listenerNodeHeadById[listenerId];
    this.listenerNodeHeadById[listenerId] = -1;
    while (nodeIndex !== -1) {
      const node = this.subscriptionNodes[nodeIndex];
      const nextByListener = node.nextByListener;
      this.detachNode(nodeIndex);
      nodeIndex = nextByListener;
    }
  }
  notify(changedKeys) {
    if (!changedKeys || changedKeys.size === 0) {
      this.markAllChanged();
    } else {
      for (const changedKey of changedKeys) {
        const keyIndex = this.stateKeyIndex.get(changedKey);
        if (keyIndex !== void 0) {
          this.changedKeyWords[keyIndex >>> 5] |= 1 << (keyIndex & 31);
        }
      }
    }
    this.scheduleFlush();
  }
  async dispatch(actionName, payload) {
    const action = this.actions[actionName];
    if (!action) {
      throw new Error(`Action '${actionName}' not found.`);
    }
    let processedPayload = payload;
    const context = { actionName, payload: processedPayload };
    for (let i = 0; i < this.middlewareKeys.length; i += 1) {
      const key = this.middlewareKeys[i];
      const middleware = this.middlewares[key];
      context.payload = processedPayload;
      processedPayload = await middleware(context);
    }
    const actionResult = action(this, processedPayload);
    if (this.pendingFlushPromise) {
      await this.pendingFlushPromise;
    }
    return actionResult;
  }
  async commit(mutationName, payload) {
    const mutation = this.mutations[mutationName];
    if (!mutation) {
      throw new Error(`Mutation '${mutationName}' not found.`);
    }
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const key = this.stateKeys[i];
      this.previousStateValues[i] = this.state[key];
    }
    const mutationResult = mutation(this.state, payload);
    if (mutationResult && typeof mutationResult.then === "function") {
      await mutationResult;
    }
    let changedCount = 0;
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const key = this.stateKeys[i];
      if (this.previousStateValues[i] !== this.state[key]) {
        this.changedKeyWords[i >>> 5] |= 1 << (i & 31);
        changedCount += 1;
      }
    }
    const currentKeys = Object.keys(this.state);
    if (currentKeys.length !== this.stateKeys.length) {
      throw new Error("State shape mutation detected. Dynamic key add/delete is not supported.");
    }
    if (changedCount > 0) {
      this.scheduleFlush();
      if (this.pendingFlushPromise) {
        await this.pendingFlushPromise;
      }
    }
  }
  createShapedState(state) {
    const shapedState = /* @__PURE__ */ Object.create(null);
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const key = this.stateKeys[i];
      shapedState[key] = state[key];
    }
    return shapedState;
  }
  markAllChanged() {
    for (let i = 0; i < this.changedKeyWords.length; i += 1) {
      this.changedKeyWords[i] = 4294967295;
    }
    const overflowBits = this.changedKeyWords.length * 32 - this.stateKeys.length;
    if (overflowBits > 0) {
      this.changedKeyWords[this.changedKeyWords.length - 1] >>>= overflowBits;
    }
  }
  scheduleFlush() {
    if (this.isFlushScheduled === 1) {
      return;
    }
    this.isFlushScheduled = 1;
    this.pendingFlushPromise = new Promise((resolve) => {
      this.resolveFlushPromise = resolve;
    });
    queueMicrotask(() => {
      this.isFlushScheduled = 0;
      this.flushNotifications();
      const resolve = this.resolveFlushPromise;
      this.resolveFlushPromise = null;
      this.pendingFlushPromise = null;
      resolve && resolve();
    });
  }
  flushNotifications() {
    const epoch = this.nextEpoch();
    this.notifyList(this.listHead[this.getWatchAllListIndex()], epoch);
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      if ((this.changedKeyWords[i >>> 5] & 1 << (i & 31)) !== 0) {
        this.notifyList(this.listHead[i], epoch);
        this.changedKeyWords[i >>> 5] &= ~(1 << (i & 31));
      }
    }
  }
  notifyList(nodeIndex, epoch) {
    let cursor = nodeIndex;
    while (cursor !== -1) {
      const node = this.subscriptionNodes[cursor];
      const nextCursor = node.next;
      if (node.active === 1 && this.listenerEpochById[node.listenerId] !== epoch) {
        this.listenerEpochById[node.listenerId] = epoch;
        node.callback(this.state);
      }
      cursor = nextCursor;
    }
  }
  attachNode(listenerId, listIndex, callback) {
    const nodeIndex = this.allocateNode();
    const node = this.subscriptionNodes[nodeIndex];
    node.listenerId = listenerId;
    node.callback = callback;
    node.listIndex = listIndex;
    node.prev = this.listTail[listIndex];
    node.next = -1;
    node.nextByListener = this.listenerNodeHeadById[listenerId];
    node.active = 1;
    const previousTail = this.listTail[listIndex];
    if (previousTail !== -1) {
      this.subscriptionNodes[previousTail].next = nodeIndex;
    } else {
      this.listHead[listIndex] = nodeIndex;
    }
    this.listTail[listIndex] = nodeIndex;
    this.listenerNodeHeadById[listenerId] = nodeIndex;
  }
  detachNode(nodeIndex) {
    const node = this.subscriptionNodes[nodeIndex];
    if (node.active === 0) {
      return;
    }
    const listIndex = node.listIndex;
    const prevIndex = node.prev;
    const nextIndex = node.next;
    if (prevIndex !== -1) {
      this.subscriptionNodes[prevIndex].next = nextIndex;
    } else {
      this.listHead[listIndex] = nextIndex;
    }
    if (nextIndex !== -1) {
      this.subscriptionNodes[nextIndex].prev = prevIndex;
    } else {
      this.listTail[listIndex] = prevIndex;
    }
    node.active = 0;
    node.prev = -1;
    node.next = -1;
    node.nextByListener = -1;
    this.releaseNode(nodeIndex);
  }
  allocateNode() {
    if (this.freeNodeHead !== -1) {
      const index2 = this.freeNodeHead;
      const node = this.subscriptionNodes[index2];
      this.freeNodeHead = node.next;
      return index2;
    }
    const index = this.nodeCount;
    this.subscriptionNodes.push({
      listenerId: 0,
      callback: () => void 0,
      listIndex: 0,
      prev: -1,
      next: -1,
      nextByListener: -1,
      active: 0
    });
    this.nodeCount += 1;
    return index;
  }
  releaseNode(index) {
    const node = this.subscriptionNodes[index];
    node.next = this.freeNodeHead;
    this.freeNodeHead = index;
  }
  ensureListenerCapacity(size) {
    if (size <= this.listenerNodeHeadById.length) {
      return;
    }
    let newSize = this.listenerNodeHeadById.length;
    while (newSize < size) {
      newSize <<= 1;
    }
    const newNodeHeads = new Int32Array(newSize);
    newNodeHeads.fill(-1);
    newNodeHeads.set(this.listenerNodeHeadById);
    this.listenerNodeHeadById = newNodeHeads;
    const newEpoch = new Uint32Array(newSize);
    newEpoch.set(this.listenerEpochById);
    this.listenerEpochById = newEpoch;
  }
  nextEpoch() {
    this.epochCounter += 1;
    if (this.epochCounter === 4294967295) {
      this.listenerEpochById.fill(0);
      this.epochCounter = 1;
    }
    return this.epochCounter;
  }
  getWatchAllListIndex() {
    return this.stateKeys.length;
  }
  getListIndex(stateKey) {
    if (stateKey === WATCH_ALL_KEY) {
      return this.getWatchAllListIndex();
    }
    const index = this.stateKeyIndex.get(stateKey);
    return index === void 0 ? -1 : index;
  }
}
function createStore(options) {
  return new ReStore(options);
}
export {
  ReStore,
  createStore
};
