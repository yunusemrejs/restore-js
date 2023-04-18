!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self)["restore-js"]={})}(this,(function(t){"use strict";var e=Object.defineProperty,s=(t,s,a)=>(((t,s,a)=>{s in t?e(t,s,{enumerable:!0,configurable:!0,writable:!0,value:a}):t[s]=a})(t,"symbol"!=typeof s?s+"":s,a),a);function a(t,e){t.forEach((t=>{t(e)}))}class i{constructor(t){s(this,"state"),s(this,"actions"),s(this,"mutations"),s(this,"middlewares"),s(this,"nextListenerId"),s(this,"watchedStatesMap",new Map);const{state:e,actions:a={},mutations:i={},middlewares:n={}}=t;this.state=e,this.actions=a,this.mutations=i,this.middlewares=n,this.nextListenerId=1,this.watchedStatesMap=new Map}getState(){return this.state}setState(t){const e=Object.assign({},t);this.state=e,this.notify()}subscribe(t){const e=this.nextListenerId++,s=t.watchedStates||new Set(["watchAll"]);for(const a of s){const s=this.watchedStatesMap.get(a);s?s.set(e,t.callback):this.watchedStatesMap.set(a,(new Map).set(e,t.callback))}return e}unsubscribe(t){this.watchedStatesMap.forEach((e=>{e.delete(t)}))}notify(t){const e=Object.assign({},this.state);t&&0!=t.size?t.forEach((t=>{const s=this.watchedStatesMap.get(t);s&&a(s,e);const i=this.watchedStatesMap.get("watchAll");i&&a(i,e)})):this.watchedStatesMap.forEach((t=>a(t,e)))}async dispatch(t,e){const s=this.actions[t];if(!s)return void console.error(`Action '${t}' not found.`);let a=e;for(const i of Object.keys(this.middlewares)){const e=this.middlewares[i];a=await e({actionName:t,payload:a})}return s(this,a)}async commit(t,e){const s=this.mutations[t];if(!s)return void console.error(`Mutation '${t}' not found.`);const a={...this.state};await s(this.state,e);const i=new Set;for(const n of Object.keys(a))a[n]!==this.state[n]&&i.add(n);this.notify(i)}}t.ReStore=i,t.createStore=function(t){return new i(t)},Object.defineProperty(t,Symbol.toStringTag,{value:"Module"})}));
