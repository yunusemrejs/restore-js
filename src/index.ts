/* eslint-disable @typescript-eslint/ban-types */
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
  [key: string]: Action;
}

type Action = (store: ReStore, payload?: any) => any;

interface Mutations {
  [key: string]: Mutation;
}

type Mutation = (state: State, payload?: any) => Promise<void> | void


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

class ReStore {
  private state: State;
  private actions: Actions;
  private mutations: Mutations;
  private middlewares: Middleware[];
  private listeners: Listener[];
  private queuedListeners: Function[];
  private isUpdating: boolean;

  constructor(options: StoreOptions) {
    const { state, actions = {}, mutations = {}, middlewares = [] } = options;
    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.listeners = [];
    this.queuedListeners = [];
    this.isUpdating = false;
  }

  public getState(): State {
    return this.state;
  }

  public setState(state: State): void {
    const newState = Object.assign({}, state);

    if (this.isUpdating) {
      this.queuedListeners.push(() => {
        this.state = newState;
        this.notify();
      });
    } else {
      this.isUpdating = true;
      this.state = newState;
      this.notify();
      this.isUpdating = false;
      this.queuedListeners.forEach((listener) => listener());
      this.queuedListeners = [];
    }
  }

  public subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  public unsubscribe(listener: Listener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  public notify(changedKeys: Array<keyof State> = []): void {
    const newState = Object.assign({}, this.state);
    this.listeners.forEach((listener) => {
      if(!changedKeys.length) listener.callback(newState);
      if (listener.watchedStates.length === 0 || listener.watchedStates.some((key) => changedKeys.includes(key))) {
        listener.callback(newState);
      }
    });
  }

  public async dispatch(actionName: string, payload?: any): Promise<any> {
    const action = this.actions[actionName];
    if (action) {
      const context = { store: this, actionName, payload };
      const chain = this.middlewares.map((middleware) => middleware(context));
      let actionResult = action(this, payload);
      for (const middleware of chain) {
        actionResult = await middleware(actionResult);
      }
      return actionResult;
    } else {
      console.error(`Action '${actionName}' not found.`);
    }
  }

  public async commit(mutationName: string, payload?: any): Promise<void> {
    const mutation = this.mutations[mutationName];
    if (mutation) {
      const previousState = this.state;
      const mutationResult : Promise<void> | void = mutation(this.state, payload);
      if (typeof mutationResult?.then === 'function') {
        await mutationResult;
      }
      const changedKeys = Object.keys(this.state).filter((key) => this.state[key] !== previousState[key]) as (keyof State)[];
      this.notify(changedKeys);
    } else {
      console.error(`Mutation '${mutationName}' not found.`);
    }
  }
}

function createStore(options: StoreOptions): ReStore {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions, State, Actions, Mutations, Middleware, Listener };
