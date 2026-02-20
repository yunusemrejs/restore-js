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
declare class ReStore {
    private state;
    private readonly actions;
    private readonly mutations;
    private readonly middlewares;
    private readonly middlewareKeys;
    private readonly stateKeys;
    private readonly stateKeyIndex;
    private nextListenerId;
    private readonly listHead;
    private readonly listTail;
    private readonly changedKeyWords;
    private subscriptionNodes;
    private freeNodeHead;
    private nodeCount;
    private listenerNodeHeadById;
    private listenerEpochById;
    private epochCounter;
    private isFlushScheduled;
    private pendingFlushPromise;
    private resolveFlushPromise;
    constructor(options: StoreOptions);
    getState(): State;
    setState(state: State): void;
    subscribe(listener: Listener): number;
    unsubscribe(listenerId: number): void;
    notify(changedKeys?: Set<keyof State>): void;
    dispatch(actionName: string, payload?: unknown): Promise<unknown>;
    commit(mutationName: string, payload?: unknown): Promise<void>;
    private createShapedState;
    private markAllChanged;
    private scheduleFlush;
    private flushNotifications;
    private notifyList;
    private attachNode;
    private detachNode;
    private allocateNode;
    private releaseNode;
    private ensureListenerCapacity;
    private nextEpoch;
    private getWatchAllListIndex;
    private getListIndex;
}
declare function createStore(options: StoreOptions): ReStore;
export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
