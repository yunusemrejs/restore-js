/* eslint-disable @typescript-eslint/ban-types */
interface StoreOptions<State> {
  state?: State;
  actions?: Actions<State>;
  mutations?: Mutations<State>;
  middlewares?: Middleware<State>[];
}

interface Actions<State> {
  [key: string]: (store: ReStore<State>, payload?: any) => any;
}

interface Mutations<State> {
  [key: string]: (state: State, payload?: any) => void;
}

interface Middleware<State> {
  (context: MiddlewareContext<State>): (next: Function) => any;
}

interface MiddlewareContext<State> {
  store: ReStore<State>;
  actionName: string;
  payload?: any;
}

class ReStore<State> {
  private state: State;
  private actions: Actions<State>;
  private mutations: Mutations<State>;
  private middlewares: Middleware<State>[];
  private listeners: Function[];
  private queuedListeners: Function[];
  private isUpdating: boolean;

  constructor(options: StoreOptions<State> = {}) {
    const { state = {} as State, actions = {}, mutations = {}, middlewares = [] } = options;
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

  public subscribe(listener: Function): void {
    this.listeners.push(listener);
  }

  public unsubscribe(listener: Function): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  public notify(): void {
    this.listeners.forEach((listener) => listener());
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
      await mutation(this.state, payload);
      this.notify();
    } else {
      console.error(`Mutation '${mutationName}' not found.`);
    }
  }
}

function createStore<State>(options: StoreOptions<State>): ReStore<State> {
  return new ReStore(options);
}

export { ReStore, createStore };
export type { StoreOptions };
