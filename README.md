# ReStore JS
ReStore is a lightweight and simple state management library for JavaScript applications. It allows you to manage the state of your application and execute actions and mutations in a predictable and centralized way.

## Installation

```bash
npm i @yunusemrejs/restore-js
```
## Usage

### Creating a Store
To create a store, you need to provide a `StoreOptions` object that contains the initial state of your application, the actions, mutations, and middlewares

```js
import { createStore } from '@yunusemrejs/restore';

const store = createStore({
  state: {
    count: 0,
    message: 'Hello, World!',
  },
  actions: {
    increment(store, payload) {
      store.commit('increment', payload);
    },
  },
  mutations: {
    increment(state, payload) {
      state.count += payload || 1;
    },
  },
  middlewares: [],
});
```
### Getting the State

To get the current state of the store, you can call the `getState` method.

```js
const state = store.getState();
console.log(state.count); // 0
console.log(state.message); // 'Hello, World!
```

### Changing the State

To change the state of the store, you need to call the `commit` method and pass the name of the mutation and an optional payload.
```js
store.commit('increment', 5);
console.log(store.getState().count); // 5
```

### Executing Actions

To execute an action, you can call the `dispatch` method and pass the name of the action and an optional payload.
```js
console.log(store.getState().count); // 5
store.dispatch('increment', 3);
console.log(store.getState().count); // 8
```

### Subscribing to State Changes

To subscribe to state changes, you can call the `subscribe` method and pass a listener object that contains a callback function and an array of watched state keys.

```js
const listener = {
  watchedStates: ['count'],
  callback(state) {
    console.log(`The count is now ${state.count}`);
  },
};

store.subscribe(listener);
```

### Unsubscribing from State Changes

To unsubscribe from state changes, you can call the `unsubscribe` method and pass the listener object.

```js
store.unsubscribe(listener);
```
### Using Middlewares

ReStore allows you to use middlewares to intercept and modify actions before they are executed and mutations before they update the state. Middlewares are functions that take a `MiddlewareContext` object as input and return a function that takes a `next` function as input.

```js
const loggerMiddleware = (context) => {
  return (next) => {
    console.log(`Action ${context.actionName} was dispatched`);
    const result = next(context.store, context.payload);
    console.log(`The new state is ${JSON.stringify(context.store.getState())}`);
    return result;
  };
};

const store = createStore({
  state: {
    count: 0,
  },
  actions: {
    increment(store, payload) {
      store.commit('increment', payload);
    },
  },
  mutations: {
    increment(state, payload) {
      state.count += payload || 1;
    },
  },
  middlewares: [loggerMiddleware],
});

store.dispatch('increment', 3);
// Action increment was dispatched
// The new state is {"count":3}
```
### How you can use in React
How you can use ReStore in a React application with hooks:

`store.js`
```jsx
import { createStore } from 'restore-js';

const store = createStore({
  state: {
    count: 0,
  },
  actions: {
    increment(store, payload) {
      store.commit('increment', payload);
    },
  },
  mutations: {
    increment(state, payload) {
      state.count += payload || 1;
    },
  },
  middlewares: [],
});

export default store;
```

`useStore.js`
```jsx
import { useState, useEffect } from 'react';
const useStore = (store, watchedStates) => {
  const [state, setState] = useState(store.getState());

  useEffect(() => {
    const listener = {
      watchedStates: watchedStates,
      callback(newState) {
        setState(newState);
      },
    };
    store.subscribe(listener);
    return () => store.unsubscribe(listener);
  }, []);

  return state;
};

export default useStore;
```

`component.js`
```jsx
import store from './store.js'
import useStore from './useStore'

const MyComponent = () => {
  const state = useStore(store,['count']);

  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() =>  store.dispatch('increment', 1);}>Increment</button>
    </div>
  );
};

export default MyComponent;
```

## License
[MIT](http://opensource.org/licenses/MIT)

Copyright (c) 2023-present Yunus Emre Kara
