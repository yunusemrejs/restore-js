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
declare class ReStore {
    private readonly state;
    private readonly stateProxy;
    private readonly actions;
    private readonly mutations;
    private readonly middlewares;
    private readonly middlewareKeys;
    private readonly middlewareContext;
    private readonly stateKeys;
    private readonly stateKeyIndex;
    private readonly bucketKeyIndex;
    private readonly listenerBuckets;
    private readonly subscriptionMap;
    private readonly freeNodePool;
    private readonly bitset;
    private readonly counters;
    private nextListenerId;
    private notifyEpoch;
    private notifyMarks;
    private pendingFlush;
    private flushPromise;
    private resolveFlush;
    private pendingCommit;
    constructor(options: StoreOptions);
    private createStateProxy;
    private ensureNotifyMarkCapacity;
    private markDirty;
    private resetDirty;
    private appendNode;
    private removeNode;
    private getOrCreateBucketIndex;
    private getNode;
    private invokeNode;
    private flushBucket;
    private flushNotifications;
    private scheduleFlush;
    getState(): State;
    setState(state: State): void;
    subscribe(listener: Listener): number;
    unsubscribe(listenerId: number): void;
    notify(changedKeys?: Set<keyof State>): void;
    dispatch(actionName: string, payload?: any): Promise<any>;
    commit(mutationName: string, payload?: any): Promise<void>;
}
declare function createStore(options: StoreOptions): ReStore;
export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
