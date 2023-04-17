import { ReStore, createStore, State, StoreOptions, Mutations } from '../src/index';

describe('ReStore', () => {
  let store: ReStore;

  beforeEach(() => {
    const options: StoreOptions = {
      state: {
        count: 0,
        message: 'Hello, world!'
      },
      actions: {
        increment(store, payload) {
          store.commit('increment', payload);
        }
      },
      mutations: {
        increment(state, payload) {
          state.count += payload;
        }
      }
    };
    store = createStore(options);
  });

  it('should initialize the store with the initial state', () => {
    expect(store.getState()).toEqual({
      count: 0,
      message: 'Hello, world!'
    });
  });

  it('should update the state when a mutation is committed', async () => {
    await store.commit('increment', 1);
    expect(store.getState().count).toBe(1);
  });

  it('should call the listener callback when a watched state changes', async () => {
    const listenerCallback = jest.fn();
    store.subscribe({
      watchedStates: new Set(['count']),
      callback: listenerCallback
    });
    await store.commit('increment', 1);
    expect(listenerCallback).toHaveBeenCalledTimes(1);
    expect(listenerCallback).toHaveBeenCalledWith({ count: 1, message: 'Hello, world!' });
  });

  it('should call the listener callback when any state changes if "watchAll" is specified', async () => {
    const listenerCallback = jest.fn();
    store.subscribe({
      watchedStates: new Set(['watchAll']),
      callback: listenerCallback
    });
    await store.commit('increment', 1);
    expect(listenerCallback).toHaveBeenCalledTimes(1);
    expect(listenerCallback).toHaveBeenCalledWith({ count: 1, message: 'Hello, world!' });
  });

  it('should not call the listener callback when a watched state is not changed', async () => {
    const listenerCallback = jest.fn();
    store.subscribe({
      watchedStates: new Set(['message']),
      callback: listenerCallback
    });
    await store.commit('increment', 1);
    expect(listenerCallback).not.toHaveBeenCalled();
  });

  it('should remove the listener when unsubscribed', async () => {
    const listenerCallback = jest.fn();
    const listenerId = store.subscribe({
      watchedStates: new Set(['count']),
      callback: listenerCallback
    });
    store.unsubscribe(listenerId);
    await store.commit('increment', 1);
    expect(listenerCallback).not.toHaveBeenCalled();
  });

  it('should call appropriate listeners when state is changed', async () => {
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    const options: StoreOptions = {
      state: { count: 0 },
      actions: {
        increment(store, payload) {
          store.commit('increment', payload);
        }
      },
      mutations: {
        increment(state, payload) {
          state.count += payload;
        }
      }
    };
    store = createStore(options);
  
    const listener1Id = store.subscribe({
      watchedStates: new Set(['count']),
      callback: listener1
    });
    const listener2Id = store.subscribe({
      watchedStates: new Set(['other']),
      callback: listener2
    });
  
    await store.dispatch('increment', 1);
  
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(0);
  
    store.unsubscribe(listener1Id);
    store.unsubscribe(listener2Id);
  });

  it('should call all listeners when state is changed and no specific states are being watched', async () => {
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    const options: StoreOptions = {
      state: { count: 0 },
      actions: {
        increment(store, payload) {
          store.commit('increment', payload);
        }
      },
      mutations: {
        increment(state, payload) {
          state.count += payload;
        }
      }
    };
    store = createStore(options);
  
    store.subscribe({
      watchedStates: new Set(),
      callback: listener1
    });
    store.subscribe({
      watchedStates: new Set(),
      callback: listener2
    });
  
    await store.dispatch('increment', 1);
  
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});


