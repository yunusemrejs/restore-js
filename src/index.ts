/* eslint-disable @typescript-eslint/ban-types */
interface StoreOptions {
  state: State;
  actions?: Actions;
  mutations?: Mutations;
  middlewares?: Middlewares;
}

interface State {
  [key: string]: unknown;
}

interface Actions {
  [key: string]: Action;
}

type Action = (store: ReStore, payload?: any) => any;

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

type WatchedStateKey = keyof State | 'watchAll';

interface Listener {
  watchedStates: Set<WatchedStateKey>;
  callback: ListenerCallbackFunction;
}

interface ListenerNode {
  id: number;
  callback: ListenerCallbackFunction;
  key: WatchedStateKey;
  prev: ListenerNode | null;
  next: ListenerNode | null;
}

interface ListenerBucket {
  head: ListenerNode | null;
  tail: ListenerNode | null;
}

interface ListenerRegistration {
  id: number;
  nodes: ListenerNode[];
}

const WATCH_ALL: 'watchAll' = 'watchAll';
const NOOP_LISTENER: ListenerCallbackFunction = () => undefined;

class ReStore {
  private state: State;
  private readonly stateKeys: string[];
  private readonly stateKeyToIndex: Map<string, number>;
  private readonly dirtyFlags: Uint32Array;
  private readonly metadata: Uint32Array;

  private readonly actions: Actions;
  private readonly mutations: Mutations;
  private readonly middlewares: Middlewares;
  private readonly middlewareNames: string[];

  private readonly actionCache: { name: string; fn: Action | null };
  private readonly mutationCache: { name: string; fn: Mutation | null };

  private nextListenerId: number;
  private readonly listenerBuckets: Map<WatchedStateKey, ListenerBucket>;
  private readonly listenerRegistrations: Map<number, ListenerRegistration>;
  private readonly listenerNodePool: ListenerNode[];

  private pendingFlushPromise: Promise<void> | null;
  private resolvePendingFlush: (() => void) | null;
  private readonly mutationSnapshot: unknown[];

  constructor(options: StoreOptions) {
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;

    this.state = state;
    this.stateKeys = Object.keys(this.state);
    this.stateKeyToIndex = new Map<string, number>();
    for (let index = 0; index < this.stateKeys.length; index += 1) {
      this.stateKeyToIndex.set(this.stateKeys[index], index);
    }
    Object.seal(this.state);

    this.dirtyFlags = new Uint32Array(this.stateKeys.length || 1);
    this.metadata = new Uint32Array(3); // 0: nextListenerId, 1: isFlushScheduled, 2: dirtyCount

    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.middlewareNames = Object.keys(this.middlewares);

    this.actionCache = { name: '', fn: null };
    this.mutationCache = { name: '', fn: null };

    this.nextListenerId = 1;
    this.listenerBuckets = new Map<WatchedStateKey, ListenerBucket>();
    this.listenerRegistrations = new Map<number, ListenerRegistration>();
    this.listenerNodePool = [];
    this.listenerBuckets.set(WATCH_ALL, { head: null, tail: null });

    this.pendingFlushPromise = null;
    this.resolvePendingFlush = null;
    this.mutationSnapshot = new Array<unknown>(this.stateKeys.length);
  }

  public getState(): State {
    return this.state;
  }

  public setState(nextState: State): void {
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

  public subscribe(listener: Listener): number {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    this.metadata[0] = this.nextListenerId;

    const watchedStates = listener.watchedStates.size > 0 ? listener.watchedStates : new Set<WatchedStateKey>([WATCH_ALL]);
    const registration: ListenerRegistration = { id: listenerId, nodes: [] };

    watchedStates.forEach(stateKey => {
      const key = stateKey === WATCH_ALL ? WATCH_ALL : (stateKey as keyof State);
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

  public unsubscribe(listenerId: number): void {
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

  public async dispatch(actionName: string, payload?: any): Promise<any> {
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

  public async commit(mutationName: string, payload?: any): Promise<void> {
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

  private getAction(actionName: string): Action | null {
    if (this.actionCache.name === actionName) {
      return this.actionCache.fn;
    }

    const action = this.actions[actionName] || null;
    this.actionCache.name = actionName;
    this.actionCache.fn = action;
    return action;
  }

  private getMutation(mutationName: string): Mutation | null {
    if (this.mutationCache.name === mutationName) {
      return this.mutationCache.fn;
    }

    const mutation = this.mutations[mutationName] || null;
    this.mutationCache.name = mutationName;
    this.mutationCache.fn = mutation;
    return mutation;
  }

  private scheduleFlush(): void {
    if (this.metadata[1] === 1) {
      return;
    }

    this.metadata[1] = 1;
    if (!this.pendingFlushPromise) {
      this.pendingFlushPromise = new Promise<void>(resolve => {
        this.resolvePendingFlush = resolve;
      });
    }

    queueMicrotask(() => {
      this.flushNotifications();
    });
  }

  private flushNotifications(): void {
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
        this.notifyBucket(keys[index] as keyof State);
      }
    }

    this.metadata[2] = 0;
    this.resolveFlushPromise();
  }

  private notifyWatchAll(): void {
    this.notifyBucket(WATCH_ALL);
  }

  private notifyBucket(key: WatchedStateKey): void {
    const bucket = this.listenerBuckets.get(key);
    if (!bucket || !bucket.head) {
      return;
    }

    let node: ListenerNode | null = bucket.head;
    while (node) {
      const next: ListenerNode | null = node.next;
      node.callback(this.state);
      node = next;
    }
  }

  private resolveFlushPromise(): void {
    if (this.resolvePendingFlush) {
      const resolver = this.resolvePendingFlush;
      this.resolvePendingFlush = null;
      this.pendingFlushPromise = null;
      resolver();
    }
  }

  private assertStateShape(nextState: State): void {
    const keys = Object.keys(nextState);
    if (keys.length !== this.stateKeys.length) {
      throw new Error('State shape mismatch: dynamic property add/remove is not allowed.');
    }

    for (let index = 0; index < keys.length; index += 1) {
      if (!this.stateKeyToIndex.has(keys[index])) {
        throw new Error('State shape mismatch: dynamic property add/remove is not allowed.');
      }
    }
  }

  private acquireNode(): ListenerNode {
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

  private detachNode(node: ListenerNode): void {
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

function createStore(options: StoreOptions): ReStore {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
