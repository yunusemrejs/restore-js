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
