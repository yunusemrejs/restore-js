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
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;
    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.listeners = [];
  }
  getState() {
    return this.state;
  }
  setState(state) {
    const newState = Object.assign({}, state);
    this.state = newState;
    this.notify();
  }
  subscribe(listener) {
    this.listeners.push(listener);
  }
  unsubscribe(listener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  notify(changedKeys) {
    const newState = Object.assign({}, this.state);
    this.listeners.forEach((listener) => {
      if (!changedKeys || changedKeys.size == 0) {
        listener.callback(newState);
      } else {
        if (listener.watchedStates.length === 0 || listener.watchedStates.some((key) => changedKeys.has(key))) {
          listener.callback(newState);
        }
      }
    });
  }
  async dispatch(actionName, payload) {
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
  async commit(mutationName, payload) {
    const mutation = this.mutations[mutationName];
    if (!mutation) {
      console.error(`Mutation '${mutationName}' not found.`);
      return;
    }
    const previousState = this.state;
    const mutationResult = mutation(this.state, payload);
    if (typeof (mutationResult == null ? void 0 : mutationResult.then) === "function") {
      await mutationResult;
    }
    const changedKeys = /* @__PURE__ */ new Set();
    for (const key in previousState) {
      if (previousState[key] !== this.state[key]) {
        changedKeys.add(key);
      }
    }
    this.notify(changedKeys);
  }
}
function createStore(options) {
  return new ReStore(options);
}
export {
  ReStore,
  createStore
};
