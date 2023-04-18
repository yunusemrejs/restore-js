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
  watchedStates: Set<keyof State>;
  callback: ListenerCallbackFunction;
}

function callListenerCallbacks(listener: Map<number, ListenerCallbackFunction>, newState: State) {
  listener.forEach(callback => {
    callback(newState);
  });
}

class ReStore {
  private state: State;
  private actions: Actions;
  private mutations: Mutations;
  private middlewares: Middlewares;
  private nextListenerId: number;
  private watchedStatesMap = new Map<keyof State | 'watchAll', Map<number, ListenerCallbackFunction>>();

  constructor(options: StoreOptions) {
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;
    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.nextListenerId = 1;
    this.watchedStatesMap = new Map<keyof State | 'watchAll', Map<number, ListenerCallbackFunction>>();
  }

  public getState(): State {
    return this.state;
  }

  public setState(state: State): void {
    const newState = { ...state };
    this.state = newState;
    this.notify();
  }

  public subscribe(listener: Listener): number {
    const listenerId = this.nextListenerId++;
    const watchedStates = listener.watchedStates || new Set(['watchAll']);

    for (const stateKey of watchedStates) {
      const watchedStateListeners = this.watchedStatesMap.get(stateKey);
      if (watchedStateListeners) {
        watchedStateListeners.set(listenerId, listener.callback);
      } else {
        this.watchedStatesMap.set(stateKey, new Map().set(listenerId, listener.callback));
      }
    }

    return listenerId;
  }

  public unsubscribe(listenerId: number): void {
    this.watchedStatesMap.forEach(watchedState => {
      watchedState!.delete(listenerId);
    });
  }

  public notify(changedKeys?: Set<keyof State>): void {
    const newState = { ...this.state };
    
    if (!changedKeys || changedKeys.size == 0) {
      this.watchedStatesMap.forEach(listener =>
        callListenerCallbacks(listener, newState)
      );
      return;
    }

    changedKeys.forEach(changedKey => {
      const watchedStateListeners = this.watchedStatesMap.get(changedKey)
      watchedStateListeners && callListenerCallbacks(watchedStateListeners, newState);
    });

    const watchAllListeners = this.watchedStatesMap.get('watchAll')
    watchAllListeners && callListenerCallbacks(watchAllListeners, newState)
  }

  public async dispatch(actionName: string, payload?: any): Promise<any> {
    const action = this.actions[actionName];
    if (!action) {
      console.error(`Action '${actionName}' not found.`);
      return;
    }
    let processedPayload = payload;
    for (const key of Object.keys(this.middlewares)) {
      const middleware = this.middlewares[key];
      const result = await middleware({ actionName, payload: processedPayload });
      processedPayload = result;
    }
    const actionResult = action(this, processedPayload);
    return actionResult;
  }

  public async commit(mutationName: string, payload?: any): Promise<void> {
    const mutation = this.mutations[mutationName];
    if (!mutation) {
      console.error(`Mutation '${mutationName}' not found.`);
      return;
    }

    const previousState = { ...this.state };
    await mutation(this.state, payload);
    const changedKeys = new Set<keyof State>();
    for (const key of Object.keys(previousState)) {
      if (previousState[key] !== this.state[key]) {
        changedKeys.add(key as keyof State);
      }
    }

    this.notify(changedKeys);
  }
}

function createStore(options: StoreOptions): ReStore {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
