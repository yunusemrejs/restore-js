var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
class ReStore {
  constructor(options) {
    __publicField(this, "state");
    __publicField(this, "actions");
    __publicField(this, "mutations");
    __publicField(this, "middlewares");
    __publicField(this, "listeners");
    __publicField(this, "queuedListeners");
    __publicField(this, "isUpdating");
    const { state, actions = {}, mutations = {}, middlewares = [] } = options;
    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.listeners = [];
    this.queuedListeners = [];
    this.isUpdating = false;
  }
  getState() {
    return this.state;
  }
  setState(state) {
    if (this.isUpdating) {
      this.queuedListeners.push(() => {
        this.state = state;
        this.notify();
      });
    } else {
      this.isUpdating = true;
      this.state = state;
      this.notify();
      this.isUpdating = false;
      this.queuedListeners.forEach((listener) => listener());
      this.queuedListeners = [];
    }
  }
  subscribe(listener) {
    this.listeners.push(listener);
  }
  unsubscribe(listener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  notify(changedKeys = []) {
    this.listeners.forEach((listener) => {
      if (!changedKeys.length)
        listener.callback(this.state);
      if (listener.watchedStates.length === 0 || listener.watchedStates.some((key) => changedKeys.includes(key))) {
        listener.callback(this.state);
      }
    });
  }
  async dispatch(actionName, payload) {
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
  async commit(mutationName, payload) {
    const mutation = this.mutations[mutationName];
    if (mutation) {
      const previousState = this.state;
      await mutation(this.state, payload);
      const changedKeys = Object.keys(this.state).filter((key) => this.state[key] !== previousState[key]);
      this.notify(changedKeys);
    } else {
      console.error(`Mutation '${mutationName}' not found.`);
    }
  }
}
function createStore(options) {
  return new ReStore(options);
}
export {
  ReStore,
  createStore
};
