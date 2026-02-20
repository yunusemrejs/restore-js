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

type Middleware = (context: MiddlewareContext) => Promise<unknown> | unknown;
interface MiddlewareContext {
  actionName: string;
  payload?: unknown;
}

type ListenerCallbackFunction = (state: State) => void;

interface Listener {
  watchedStates: Set<keyof State | 'watchAll'>;
  callback: ListenerCallbackFunction;
}

class ListenerNode {
  public id: number;
  public callback: ListenerCallbackFunction;
  public next: ListenerNode | null;
  public prev: ListenerNode | null;
  public active: number;
  public bucket: ListenerBucket | null;

  constructor(id: number, callback: ListenerCallbackFunction) {
    this.id = id;
    this.callback = callback;
    this.next = null;
    this.prev = null;
    this.active = 1;
    this.bucket = null;
  }

  public init(id: number, callback: ListenerCallbackFunction): ListenerNode {
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
  public head: ListenerNode | null;
  public tail: ListenerNode | null;

  constructor() {
    this.head = null;
    this.tail = null;
  }

  public append(node: ListenerNode): void {
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

  public remove(node: ListenerNode): void {
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

interface ListenerHandle {
  nodes: ListenerNode[];
}

class ReStore {
  private state: State;
  private readonly actions: Actions;
  private readonly mutations: Mutations;
  private readonly middlewares: Middleware[];

  private nextListenerId: number;
  private readonly listenerPool: ListenerNode[];
  private readonly listenerById: Map<number, ListenerHandle>;
  private readonly buckets: Map<keyof State | 'watchAll', ListenerBucket>;

  private readonly commitInfo: Uint32Array;
  private readonly pendingChangedKeys: Set<keyof State>;
  private notifyQueued: number;

  private readonly proxyCache: Map<string, unknown>;
  private readonly stateProxy: State;

  constructor(options: StoreOptions) {
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;

    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = Object.values(middlewares);

    this.nextListenerId = 1;
    this.listenerPool = [];
    this.listenerById = new Map();
    this.buckets = new Map();
    this.buckets.set('watchAll', new ListenerBucket());

    this.commitInfo = new Uint32Array(4);
    this.pendingChangedKeys = new Set();
    this.notifyQueued = 0;

    this.proxyCache = new Map();
    this.stateProxy = new Proxy(this.state, {
      get: (target: State, key: string | symbol): unknown => {
        if (typeof key !== 'string') {
          return Reflect.get(target, key);
        }

        const cached = this.proxyCache.get(key);
        if (cached !== undefined || this.proxyCache.has(key)) {
          return cached;
        }

        const value = target[key];
        this.proxyCache.set(key, value);
        return value;
      },
      set: (target: State, key: string | symbol, value: unknown): boolean => {
        if (typeof key === 'string') {
          target[key] = value;
          this.proxyCache.set(key, value);
          this.queueKeyForNotify(key as keyof State);
          return true;
        }
        return Reflect.set(target, key, value);
      }
    });
  }

  public getState(): State {
    return this.state;
  }

  public getStateProxy(): State {
    return this.stateProxy;
  }

  public setState(state: State): void {
    this.state = state;
    this.proxyCache.clear();
    this.commitInfo[0] = (this.commitInfo[0] + 1) >>> 0;
    this.queueNotifyAll();
  }

  public subscribe(listener: Listener): number {
    const listenerId = this.nextListenerId++;
    const watchedStates = listener.watchedStates;
    const targetKeys = watchedStates.size === 0 ? null : watchedStates;
    const handle: ListenerHandle = { nodes: [] };

    if (targetKeys === null) {
      const bucket = this.getBucket('watchAll');
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

  public unsubscribe(listenerId: number): void {
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

  public notify(changedKeys?: Set<keyof State>): void {
    if (!changedKeys || changedKeys.size === 0) {
      this.callBucket(this.getBucket('watchAll'));
      this.buckets.forEach((bucket, key) => {
        if (key === 'watchAll') {
          return;
        }
        this.callBucket(bucket);
      });
      return;
    }

    this.callBucket(this.getBucket('watchAll'));
    changedKeys.forEach(key => {
      const bucket = this.buckets.get(key);
      if (bucket) {
        this.callBucket(bucket);
      }
    });
  }

  public async dispatch(actionName: string, payload?: any): Promise<any> {
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

  public async commit(mutationName: string, payload?: any): Promise<void> {
    const mutation = this.mutations[mutationName];
    if (!mutation) {
      throw new Error(`Mutation '${mutationName}' not found.`);
    }

    this.commitInfo[1] = (this.commitInfo[1] + 1) >>> 0;
    const beforeVersion = this.commitInfo[0];
    const beforeState = this.state;
    const previousKeys = Object.keys(this.state);
    const previousValues = new Array(previousKeys.length);
    const previousKeySet = new Set(previousKeys);

    for (let i = 0; i < previousKeys.length; i += 1) {
      previousValues[i] = this.state[previousKeys[i]];
    }

    await mutation(this.state, payload);

    this.commitInfo[0] = (beforeVersion + 1) >>> 0;
    if (beforeState !== this.state) {
      this.proxyCache.clear();
      this.queueNotifyAll();
      return;
    }

    for (let i = 0; i < previousKeys.length; i += 1) {
      const key = previousKeys[i] as keyof State;
      if (this.state[key] !== previousValues[i]) {
        this.queueKeyForNotify(key);
      }
    }

    const currentKeys = Object.keys(this.state);
    for (let i = 0; i < currentKeys.length; i += 1) {
      const key = currentKeys[i] as keyof State;
      if (!previousKeySet.has(key as string)) {
        this.queueKeyForNotify(key);
      }
    }
  }

  private queueKeyForNotify(key: keyof State): void {
    this.pendingChangedKeys.add(key);

    if ((this.notifyQueued & 1) === 1) {
      return;
    }

    this.notifyQueued = 1;
    queueMicrotask(() => {
      this.flushNotifyQueue();
    });
  }

  private queueNotifyAll(): void {
    this.pendingChangedKeys.clear();

    if ((this.notifyQueued & 1) === 1) {
      return;
    }

    this.notifyQueued = 1;
    queueMicrotask(() => {
      this.flushNotifyQueue(true);
    });
  }

  private flushNotifyQueue(forceAll = false): void {
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

  private getBucket(key: keyof State | 'watchAll'): ListenerBucket {
    const existing = this.buckets.get(key);
    if (existing) {
      return existing;
    }

    const bucket = new ListenerBucket();
    this.buckets.set(key, bucket);
    return bucket;
  }

  private acquireNode(id: number, callback: ListenerCallbackFunction): ListenerNode {
    const recycled = this.listenerPool.pop();
    if (recycled) {
      return recycled.init(id, callback);
    }
    return new ListenerNode(id, callback);
  }

  private callBucket(bucket: ListenerBucket): void {
    let node = bucket.head;
    while (node !== null) {
      if (node.active === 1) {
        node.callback(this.state);
      }
      node = node.next;
    }
  }
}

function createStore(options: StoreOptions): ReStore {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
