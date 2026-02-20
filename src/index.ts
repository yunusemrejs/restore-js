/* eslint-disable @typescript-eslint/ban-types */
interface StoreOptions {
  state: State;
  actions?: Actions;
  mutations?: Mutations;
  middlewares?: Middlewares;
}

interface State {
  [key: string]: any;
}

interface Actions {
  [key: string]: Action;
}

type Action = (store: ReStore, payload?: any) => unknown;

interface Mutations {
  [key: string]: Mutation;
}

type Mutation = (state: State, payload?: any) => Promise<void> | void;

interface Middlewares {
  [key: string]: Middleware;
}

type Middleware = (context: MiddlewareContext) => Promise<any> | any;
interface MiddlewareContext {
  actionName: string;
  payload?: any;
}

type ListenerCallbackFunction = (state: State) => void;
interface Listener {
  watchedStates: Set<keyof State | 'watchAll'>;
  callback: ListenerCallbackFunction;
}

interface ListenerNode {
  id: number;
  callback: ListenerCallbackFunction;
  prev: ListenerNode | null;
  next: ListenerNode | null;
  bucketIndex: number;
}

interface ListenerBucket {
  head: ListenerNode | null;
  tail: ListenerNode | null;
}

interface Subscription {
  id: number;
  callback: ListenerCallbackFunction;
  nodes: ListenerNode[];
}

const WATCH_ALL_KEY = 'watchAll';

class ReStore {
  private readonly state: State;
  private readonly stateProxy: State;
  private readonly actions: Actions;
  private readonly mutations: Mutations;
  private readonly middlewares: Middlewares;
  private readonly middlewareKeys: string[];
  private readonly middlewareContext: MiddlewareContext;

  private readonly stateKeys: string[];
  private readonly stateKeyIndex = new Map<string, number>();
  private readonly bucketKeyIndex = new Map<string, number>();
  private readonly listenerBuckets: ListenerBucket[] = [];
  private readonly subscriptionMap = new Map<number, Subscription>();
  private readonly freeNodePool: ListenerNode[] = [];

  private readonly bitset: Uint32Array;
  private readonly counters = new Uint32Array(4);

  private nextListenerId = 1;
  private notifyEpoch = 1;
  private notifyMarks = new Uint32Array(64);
  private pendingFlush = false;
  private flushPromise: Promise<void> | null = null;
  private resolveFlush: (() => void) | null = null;
  private pendingCommit: Promise<void> | null = null;

  constructor(options: StoreOptions) {
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;

    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.middlewareKeys = Object.keys(middlewares);
    this.middlewareContext = { actionName: '', payload: undefined };

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

  private createStateProxy(): State {
    const store = this;
    return new Proxy(this.state, {
      set(target, prop, value): boolean {
        if (typeof prop !== 'string') {
          return false;
        }
        const keyIndex = store.stateKeyIndex.get(prop);
        if (keyIndex === undefined) {
          throw new Error(`State key '${prop}' is not part of the static state shape.`);
        }
        const current = target[prop];
        if (current !== value) {
          target[prop] = value;
          store.markDirty(keyIndex);
        }
        return true;
      },
      deleteProperty(): boolean {
        throw new Error('delete is not allowed on state objects because state shape is static.');
      }
    });
  }

  private ensureNotifyMarkCapacity(listenerId: number): void {
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

  private markDirty(keyIndex: number): void {
    const block = keyIndex >>> 5;
    const bit = keyIndex & 31;
    const mask = 1 << bit;
    if ((this.bitset[block] & mask) === 0) {
      this.bitset[block] |= mask;
      this.counters[0] += 1;
    }
  }

  private resetDirty(): void {
    for (let i = 0; i < this.bitset.length; i += 1) {
      this.bitset[i] = 0;
    }
    this.counters[0] = 0;
  }

  private appendNode(bucketIndex: number, node: ListenerNode): void {
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

  private removeNode(node: ListenerNode): void {
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

  private getOrCreateBucketIndex(key: string): number {
    const existing = this.bucketKeyIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const bucketIndex = this.listenerBuckets.length;
    this.bucketKeyIndex.set(key, bucketIndex);
    this.listenerBuckets.push({ head: null, tail: null });
    return bucketIndex;
  }

  private getNode(id: number, callback: ListenerCallbackFunction, bucketIndex: number): ListenerNode {
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

  private invokeNode(node: ListenerNode): void {
    const listenerId = node.id;
    if (this.notifyMarks[listenerId] === this.notifyEpoch) {
      return;
    }
    this.notifyMarks[listenerId] = this.notifyEpoch;
    node.callback(this.state);
  }

  private flushBucket(bucketIndex: number): void {
    let cursor = this.listenerBuckets[bucketIndex].head;
    while (cursor !== null) {
      this.invokeNode(cursor);
      cursor = cursor.next;
    }
  }

  private flushNotifications = (): void => {
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
    this.flushBucket(this.bucketKeyIndex.get(WATCH_ALL_KEY)!);

    for (let keyIndex = 0; keyIndex < this.stateKeys.length; keyIndex += 1) {
      const block = keyIndex >>> 5;
      const bit = keyIndex & 31;
      if ((this.bitset[block] & (1 << bit)) !== 0) {
        this.flushBucket(keyIndex);
      }
    }

    this.resetDirty();

    if (this.resolveFlush) {
      this.resolveFlush();
    }
    this.flushPromise = null;
    this.resolveFlush = null;
  };

  private scheduleFlush(): Promise<void> {
    if (!this.flushPromise) {
      this.flushPromise = new Promise(resolve => {
        this.resolveFlush = resolve;
      });
    }

    if (!this.pendingFlush) {
      this.pendingFlush = true;
      queueMicrotask(this.flushNotifications);
    }

    return this.flushPromise;
  }

  public getState(): State {
    return this.state;
  }

  public setState(state: State): void {
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

  public subscribe(listener: Listener): number {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    this.ensureNotifyMarkCapacity(listenerId);

    const watchedStates = listener.watchedStates;
    const subscription: Subscription = {
      id: listenerId,
      callback: listener.callback,
      nodes: []
    };

    if (!watchedStates || watchedStates.size === 0) {
      const bucketIndex = this.bucketKeyIndex.get(WATCH_ALL_KEY)!;
      const node = this.getNode(listenerId, listener.callback, bucketIndex);
      this.appendNode(bucketIndex, node);
      subscription.nodes.push(node);
      this.subscriptionMap.set(listenerId, subscription);
      return listenerId;
    }

    watchedStates.forEach(stateKey => {
      const bucketIndex = this.getOrCreateBucketIndex(String(stateKey));
      const node = this.getNode(listenerId, listener.callback, bucketIndex);
      this.appendNode(bucketIndex, node);
      subscription.nodes.push(node);
    });

    this.subscriptionMap.set(listenerId, subscription);
    return listenerId;
  }

  public unsubscribe(listenerId: number): void {
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

  public notify(changedKeys?: Set<keyof State>): void {
    if (!changedKeys || changedKeys.size === 0) {
      for (let i = 0; i < this.stateKeys.length; i += 1) {
        this.markDirty(i);
      }
      this.flushNotifications();
      return;
    }

    changedKeys.forEach(key => {
      const keyIndex = this.stateKeyIndex.get(String(key));
      if (keyIndex !== undefined) {
        this.markDirty(keyIndex);
      }
    });

    if (this.counters[0] > 0) {
      this.flushNotifications();
    }
  }

  public async dispatch(actionName: string, payload?: any): Promise<any> {
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
    if (actionResult && typeof (actionResult as Promise<unknown>).then === 'function') {
      await actionResult;
    }

    if (this.pendingCommit) {
      await this.pendingCommit;
    }

    return actionResult;
  }

  public async commit(mutationName: string, payload?: any): Promise<void> {
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

function createStore(options: StoreOptions): ReStore {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
