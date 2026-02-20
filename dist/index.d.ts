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
declare class ReStore {
    private state;
    private readonly stateKeys;
    private readonly stateKeyToIndex;
    private readonly dirtyFlags;
    private readonly metadata;
    private readonly actions;
    private readonly mutations;
    private readonly middlewares;
    private readonly middlewareNames;
    private readonly actionCache;
    private readonly mutationCache;
    private nextListenerId;
    private readonly listenerBuckets;
    private readonly listenerRegistrations;
    private readonly listenerNodePool;
    private pendingFlushPromise;
    private resolvePendingFlush;
    private readonly mutationSnapshot;
    constructor(options: StoreOptions);
    getState(): State;
    setState(nextState: State): void;
    subscribe(listener: Listener): number;
    unsubscribe(listenerId: number): void;
    dispatch(actionName: string, payload?: any): Promise<any>;
    commit(mutationName: string, payload?: any): Promise<void>;
    private getAction;
    private getMutation;
    private scheduleFlush;
    private flushNotifications;
    private notifyWatchAll;
    private notifyBucket;
    private resolveFlushPromise;
    private assertStateShape;
    private acquireNode;
    private detachNode;
}
declare function createStore(options: StoreOptions): ReStore;
export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
