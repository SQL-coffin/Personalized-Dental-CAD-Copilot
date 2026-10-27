// Timers exist in browsers and in Node. They are declared here so this
// package type-checks without DOM or Node typings (it must run in both).
declare function setTimeout(handler: (...args: never[]) => void, timeout?: number): unknown;
