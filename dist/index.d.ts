interface StoreOptions {
    state: State;
    actions?: Actions;
    mutations?: Mutations;
    middlewares?: Middleware[];
}
interface State {
    [key: string]: any;
}
interface Actions {
    [key: string]: (store: ReStore, payload?: any) => any;
}
interface Mutations {
    [key: string]: (state: State, payload?: any) => void;
}
interface Middleware {
    (context: MiddlewareContext): (next: Function) => any;
}
interface MiddlewareContext {
    store: ReStore;
    actionName: string;
    payload?: any;
}
interface Listener {
    watchedStates: (keyof State)[];
    callback: (state: State) => void;
}
declare class ReStore {
    private state;
    private actions;
    private mutations;
    private middlewares;
    private listeners;
    private queuedListeners;
    private isUpdating;
    constructor(options: StoreOptions);
    getState(): State;
    setState(state: State): void;
    subscribe(listener: Listener): void;
    unsubscribe(listener: Listener): void;
    notify(changedKeys?: Array<keyof State>): void;
    dispatch(actionName: string, payload?: any): Promise<any>;
    commit(mutationName: string, payload?: any): Promise<void>;
}
declare function createStore(options: StoreOptions): ReStore;
export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
