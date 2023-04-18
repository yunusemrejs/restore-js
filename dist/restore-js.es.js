var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
function callListenerCallbacks(listener, newState) {
  listener.forEach((callback) => {
    callback(newState);
  });
}
class ReStore {
  constructor(options) {
    __publicField(this, "state");
    __publicField(this, "actions");
    __publicField(this, "mutations");
    __publicField(this, "middlewares");
    __publicField(this, "nextListenerId");
    __publicField(this, "watchedStatesMap", /* @__PURE__ */ new Map());
    const { state, actions = {}, mutations = {}, middlewares = {} } = options;
    this.state = state;
    this.actions = actions;
    this.mutations = mutations;
    this.middlewares = middlewares;
    this.nextListenerId = 1;
    this.watchedStatesMap = /* @__PURE__ */ new Map();
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
    const listenerId = this.nextListenerId++;
    if (!listener.watchedStates || listener.watchedStates.size == 0) {
      const watchAllListeners = this.watchedStatesMap.get("watchAll");
      if (watchAllListeners) {
        watchAllListeners.set(listenerId, listener.callback);
      } else {
        this.watchedStatesMap.set("watchAll", (/* @__PURE__ */ new Map()).set(listenerId, listener.callback));
      }
    }
    listener.watchedStates.forEach((stateKey) => {
      const watchedStateListeners = this.watchedStatesMap.get(stateKey);
      if (watchedStateListeners) {
        watchedStateListeners.set(listenerId, listener.callback);
      } else {
        this.watchedStatesMap.set(stateKey, (/* @__PURE__ */ new Map()).set(listenerId, listener.callback));
      }
    });
    return listenerId;
  }
  unsubscribe(listenerId) {
    this.watchedStatesMap.forEach((watchedState) => {
      watchedState.delete(listenerId);
    });
  }
  notify(changedKeys) {
    const newState = Object.assign({}, this.state);
    if (!changedKeys || changedKeys.size == 0) {
      this.watchedStatesMap.forEach(
        (listener) => callListenerCallbacks(listener, newState)
      );
      return;
    }
    changedKeys.forEach((changedKey) => {
      const watchedStateListeners = this.watchedStatesMap.get(changedKey);
      watchedStateListeners && callListenerCallbacks(watchedStateListeners, newState);
      const watchAllListeners = this.watchedStatesMap.get("watchAll");
      watchAllListeners && callListenerCallbacks(watchAllListeners, newState);
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
      const result = await middleware({ actionName, payload: processedPayload });
      processedPayload = result;
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
    const previousState = { ...this.state };
    await mutation(this.state, payload);
    const changedKeys = /* @__PURE__ */ new Set();
    for (const key of Object.keys(previousState)) {
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
