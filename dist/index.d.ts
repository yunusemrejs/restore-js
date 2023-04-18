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
    watchedStates: Set<keyof State>;
    callback: ListenerCallbackFunction;
}
declare class ReStore {
    private state;
    private actions;
    private mutations;
    private middlewares;
    private nextListenerId;
    private watchedStatesMap;
    constructor(options: StoreOptions);
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
