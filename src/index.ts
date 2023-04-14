/* eslint-disable @typescript-eslint/ban-types */
interface StoreOptions<State extends Record<string, any>> {
  state: State;
  actions?: Actions<State>;
  mutations?: Mutations<State>;
  middlewares?: Middleware<State>[];
}

interface Actions<State extends Record<string, any>> {
  [key: string]: (store: ReStore<State>, payload?: any) => any;
}

interface Mutations<State extends Record<string, any>> {
  [key: string]: (state: State, payload?: any) => void;
}

interface Middleware<State extends Record<string, any>> {
  (context: MiddlewareContext<State>): (next: Function) => any;
}

interface MiddlewareContext<State extends Record<string, any>> {
  store: ReStore<State>;
  actionName: string;
  payload?: any;
}

interface Listener<State extends Record<string, any>> {
  watchedStates: (keyof State)[];
  callback: (state: State) => void;
}

class ReStore<State extends Record<string, any>> {
  private state: State;
  private actions: Actions<State>;
  private mutations: Mutations<State>;
  private middlewares: Middleware<State>[];
  private listeners: Listener<State>[];
  private queuedListeners: Function[];
  private isUpdating: boolean;

  constructor(options: StoreOptions<State>) {
    const { state, actions = {}, mutations = {}, middlewares = [] } = options;
    this.state = Object.freeze(state);
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
    if (this.isUpdating) {
      this.queuedListeners.push(() => {
        this.state = Object.freeze(state);
        this.notify();
      });
    } else {
      this.isUpdating = true;
      this.state = Object.freeze(state);
      this.notify();
      this.isUpdating = false;
      this.queuedListeners.forEach((listener) => listener());
      this.queuedListeners = [];
    }
  }

  public subscribe(listener: Listener<State>): void {
    this.listeners.push(listener);
  }

  public unsubscribe(listener: Listener<State>): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  public notify(changedKeys: Array<keyof State> = []): void {
    this.listeners.forEach((listener) => {
      if(!changedKeys.length) listener.callback(this.state);
      if (listener.watchedStates.length === 0 || listener.watchedStates.some((key) => changedKeys.includes(key))) {
        listener.callback(this.state);
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
      await mutation(this.state, payload);
      const changedKeys = Object.keys(this.state).filter((key) => this.state[key] !== previousState[key]) as (keyof State)[];
      this.notify(changedKeys);
    } else {
      console.error(`Mutation '${mutationName}' not found.`);
    }
  }
}

function createStore<State extends Record<string, any>>(options: StoreOptions<State>): ReStore<State> {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions };
