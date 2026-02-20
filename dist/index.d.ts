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
declare class ReStore {
    private state;
    private readonly actions;
    private readonly mutations;
    private readonly middlewares;
    private nextListenerId;
    private readonly listenerPool;
    private readonly listenerById;
    private readonly buckets;
    private readonly commitInfo;
    private readonly pendingChangedKeys;
    private notifyQueued;
    private readonly proxyCache;
    private readonly stateProxy;
    constructor(options: StoreOptions);
    getState(): State;
    getStateProxy(): State;
    setState(state: State): void;
    subscribe(listener: Listener): number;
    unsubscribe(listenerId: number): void;
    notify(changedKeys?: Set<keyof State>): void;
    dispatch(actionName: string, payload?: any): Promise<any>;
    commit(mutationName: string, payload?: any): Promise<void>;
    private queueKeyForNotify;
    private queueNotifyAll;
    private flushNotifyQueue;
    private getBucket;
    private acquireNode;
    private callBucket;
}
declare function createStore(options: StoreOptions): ReStore;
export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
