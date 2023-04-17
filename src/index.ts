/* eslint-disable @typescript-eslint/ban-types */
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

interface Listener {
  watchedStates: (keyof State)[];
  callback: (state: State) => void;
}

class ReStore {
  private state: State;
  private actions: Actions;
  private mutations: Mutations;
  private middlewares: Middlewares;
  private listeners: Listener[];

  constructor(options: StoreOptions) {
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;
    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.listeners = [];
  }

  public getState(): State {
    return this.state;
  }

  public setState(state: State): void {
    const newState = Object.assign({}, state);
    this.state = newState;
    this.notify();
  }

  public subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  public unsubscribe(listener: Listener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  public notify(changedKeys?: Set<keyof State>): void {
    const newState = Object.assign({}, this.state);
    this.listeners.forEach(listener => {
      if (!changedKeys || changedKeys.size == 0) {
        listener.callback(newState);
      } else {
        if (listener.watchedStates.length === 0 || listener.watchedStates.some(key => changedKeys.has(key))) {
          listener.callback(newState);
        }
      }
    });
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
      processedPayload = await middleware({ actionName, payload: processedPayload });
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

    const previousState = this.state;
    const mutationResult: Promise<void> | void = mutation(this.state, payload);
    if (typeof mutationResult?.then === 'function') {
      await mutationResult;
    }

    const changedKeys = new Set<keyof State>();
    for (const key in previousState) {
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
