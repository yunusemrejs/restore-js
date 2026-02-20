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

type Action = (store: ReStore, payload?: unknown) => unknown;

interface Mutations {
  [key: string]: Mutation;
}

type Mutation = (state: State, payload?: unknown) => Promise<void> | void;

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

interface SubscriptionNode {
  listenerId: number;
  callback: ListenerCallbackFunction;
  listIndex: number;
  prev: number;
  next: number;
  nextByListener: number;
  active: number;
}

const WATCH_ALL_KEY = 'watchAll';
const EMPTY_STATE: State = Object.create(null) as State;

class ReStore {
  private state: State;
  private readonly actions: Actions;
  private readonly mutations: Mutations;
  private readonly middlewares: Middlewares;
  private readonly middlewareKeys: string[];

  private readonly stateKeys: string[];
  private readonly stateKeyIndex: Map<string, number>;

  private nextListenerId: number;

  private readonly listHead: Int32Array;
  private readonly listTail: Int32Array;
  private readonly changedKeyWords: Uint32Array;

  private subscriptionNodes: SubscriptionNode[];
  private freeNodeHead: number;
  private nodeCount: number;

  private listenerNodeHeadById: Int32Array;
  private listenerEpochById: Uint32Array;
  private epochCounter: number;

  private isFlushScheduled: number;
  private pendingFlushPromise: Promise<void> | null;
  private resolveFlushPromise: (() => void) | null;

  constructor(options: StoreOptions) {
    const { state, actions = EMPTY_STATE as Actions, mutations = EMPTY_STATE as Mutations, middlewares = EMPTY_STATE as Middlewares } = options;

    this.stateKeys = Object.keys(state);
    this.stateKeyIndex = new Map<string, number>();
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

    this.isFlushScheduled = 0;
    this.pendingFlushPromise = null;
    this.resolveFlushPromise = null;

  }

  public getState(): State {
    return this.state;
  }

  public setState(state: State): void {
    this.state = this.createShapedState(state);
    this.markAllChanged();
    this.scheduleFlush();
  }

  public subscribe(listener: Listener): number {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;

    this.ensureListenerCapacity(listenerId + 1);

    const watchedStates = listener.watchedStates && listener.watchedStates.size > 0 ? listener.watchedStates : (new Set([WATCH_ALL_KEY]) as Set<keyof State | 'watchAll'>);

    for (const stateKey of watchedStates) {
      const listIndex = this.getListIndex(stateKey);
      if (listIndex === -1) {
        continue;
      }
      this.attachNode(listenerId, listIndex, listener.callback);
    }

    return listenerId;
  }

  public unsubscribe(listenerId: number): void {
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

  public notify(changedKeys?: Set<keyof State>): void {
    if (!changedKeys || changedKeys.size === 0) {
      this.markAllChanged();
    } else {
      for (const changedKey of changedKeys) {
        const keyIndex = this.stateKeyIndex.get(changedKey as string);
        if (keyIndex !== undefined) {
          this.changedKeyWords[keyIndex >>> 5] |= 1 << (keyIndex & 31);
        }
      }
    }
    this.scheduleFlush();
  }

  public async dispatch(actionName: string, payload?: unknown): Promise<unknown> {
    const action = this.actions[actionName];
    if (!action) {
      throw new Error(`Action '${actionName}' not found.`);
    }

    let processedPayload = payload;
    const context: MiddlewareContext = { actionName, payload: processedPayload };

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

  public async commit(mutationName: string, payload?: unknown): Promise<void> {
    const mutation = this.mutations[mutationName];
    if (!mutation) {
      throw new Error(`Mutation '${mutationName}' not found.`);
    }

    const previousStateValues = new Array<unknown>(this.stateKeys.length);
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const key = this.stateKeys[i];
      previousStateValues[i] = this.state[key];
    }

    const mutationResult = mutation(this.state, payload);
    if (mutationResult && typeof (mutationResult as Promise<void>).then === 'function') {
      await mutationResult;
    }

    let changedCount = 0;
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const key = this.stateKeys[i];
      if (previousStateValues[i] !== this.state[key]) {
        this.changedKeyWords[i >>> 5] |= 1 << (i & 31);
        changedCount += 1;
      }
    }

    const currentKeys = Object.keys(this.state);
    if (currentKeys.length !== this.stateKeys.length) {
      throw new Error('State shape mutation detected. Dynamic key add/delete is not supported.');
    }

    if (changedCount > 0) {
      this.scheduleFlush();
      if (this.pendingFlushPromise) {
        await this.pendingFlushPromise;
      }
    }
  }

  private createShapedState(state: State): State {
    const shapedState: State = Object.create(null) as State;
    for (let i = 0; i < this.stateKeys.length; i += 1) {
      const key = this.stateKeys[i];
      shapedState[key] = state[key];
    }
    return shapedState;
  }

  private markAllChanged(): void {
    for (let i = 0; i < this.changedKeyWords.length; i += 1) {
      this.changedKeyWords[i] = 0xffffffff;
    }
    const overflowBits = this.changedKeyWords.length * 32 - this.stateKeys.length;
    if (overflowBits > 0) {
      this.changedKeyWords[this.changedKeyWords.length - 1] >>>= overflowBits;
    }
  }

  private scheduleFlush(): void {
    if (this.isFlushScheduled === 1) {
      return;
    }

    this.isFlushScheduled = 1;
    this.pendingFlushPromise = new Promise(resolve => {
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

  private flushNotifications(): void {
    const epoch = this.nextEpoch();

    this.notifyList(this.listHead[this.getWatchAllListIndex()], epoch);

    for (let i = 0; i < this.stateKeys.length; i += 1) {
      if ((this.changedKeyWords[i >>> 5] & (1 << (i & 31))) !== 0) {
        this.notifyList(this.listHead[i], epoch);
        this.changedKeyWords[i >>> 5] &= ~(1 << (i & 31));
      }
    }
  }

  private notifyList(nodeIndex: number, epoch: number): void {
    let cursor = nodeIndex;

    while (cursor !== -1) {
      const node = this.subscriptionNodes[cursor];
      if (node.active === 1 && this.listenerEpochById[node.listenerId] !== epoch) {
        this.listenerEpochById[node.listenerId] = epoch;
        node.callback(this.state);
      }
      cursor = node.active === 1 ? node.next : this.listHead[node.listIndex];
    }
  }

  private attachNode(listenerId: number, listIndex: number, callback: ListenerCallbackFunction): void {
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

  private detachNode(nodeIndex: number): void {
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

  private allocateNode(): number {
    if (this.freeNodeHead !== -1) {
      const index = this.freeNodeHead;
      const node = this.subscriptionNodes[index];
      this.freeNodeHead = node.next;
      return index;
    }

    const index = this.nodeCount;
    this.subscriptionNodes.push({
      listenerId: 0,
      callback: () => undefined,
      listIndex: 0,
      prev: -1,
      next: -1,
      nextByListener: -1,
      active: 0
    });
    this.nodeCount += 1;
    return index;
  }

  private releaseNode(index: number): void {
    const node = this.subscriptionNodes[index];
    node.next = this.freeNodeHead;
    this.freeNodeHead = index;
  }

  private ensureListenerCapacity(size: number): void {
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

  private nextEpoch(): number {
    this.epochCounter += 1;
    if (this.epochCounter === 0xffffffff) {
      this.listenerEpochById.fill(0);
      this.epochCounter = 1;
    }
    return this.epochCounter;
  }

  private getWatchAllListIndex(): number {
    return this.stateKeys.length;
  }

  private getListIndex(stateKey: keyof State | 'watchAll'): number {
    if (stateKey === WATCH_ALL_KEY) {
      return this.getWatchAllListIndex();
    }
    const index = this.stateKeyIndex.get(stateKey as string);
    return index === undefined ? -1 : index;
  }
}

function createStore(options: StoreOptions): ReStore {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
