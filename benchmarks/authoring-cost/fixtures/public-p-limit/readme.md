# p-limit

> Run multiple promise-returning & async functions with limited concurrency

*Works in Node.js and browsers.*

## Install

```sh
npm install p-limit
```

## Usage

```js
import pLimit from 'p-limit';

const limit = pLimit(1);

const input = [
	limit(() => fetchSomething('foo')),
	limit(() => fetchSomething('bar')),
	limit(() => doSomething())
];

// Only one promise is run at once
const result = await Promise.all(input);
console.log(result);
```

## API

### pLimit(concurrency) <sup>default export</sup>

Returns a `limit` function.

#### concurrency

Type: `number | object`\
Minimum: `1`

Concurrency limit.

You can pass a number or an options object with a `concurrency` property.

#### rejectOnClear

Type: `boolean`\
Default: `false`

Reject pending promises with an `AbortError` when `clearQueue()` is called.
This is recommended if you await the returned promises, for example with `Promise.all`, so pending tasks do not remain unresolved after `clearQueue()`.

```js
import pLimit from 'p-limit';

const limit = pLimit({concurrency: 1});
```

### limit(fn, ...args)

Returns the promise returned by calling `fn(...args)`.

#### fn

Type: `Function`

Promise-returning/async function.

#### args

Any arguments to pass through to `fn`.

Support for passing arguments on to the `fn` is provided in order to be able to avoid creating unnecessary closures. You probably don't need this optimization unless you're pushing a *lot* of functions.

Warning: Avoid calling the same `limit` function inside a function that is already limited by it. This can create a deadlock where inner tasks never run. Use a separate limiter for inner tasks.

### limit.map(iterable, mapperFunction)

Process an iterable of inputs with limited concurrency.

The mapper function receives the item value and its index.

Returns a promise equivalent to `Promise.all(Array.from(iterable, (item, index) => limit(mapperFunction, item, index)))`.

If the iterable throws during iteration, the returned promise rejects with that error. Mapper functions that were already scheduled still run, and their results are discarded.

This is a convenience function for processing inputs that arrive in batches. For more complex use cases, see [p-map](https://github.com/sindresorhus/p-map).

### limit.activeCount

The number of promises that are currently running.

### limit.pendingCount

The number of promises that are waiting to run (i.e. their internal `fn` was not called yet).

### limit.clearQueue()

Discard pending promises that are waiting to run.

This might be useful if you want to tear down the queue at the end of your program's lifecycle or discard any function calls referencing an intermediary state of your app.

Note: This does not cancel promises that are already running.

When `rejectOnClear` is enabled, pending promises are rejected with an `AbortError`.
This is recommended if you await the returned promises, for example with `Promise.all`, so pending tasks do not remain unresolved after `clearQueue()`.

### limit.concurrency

Get or set the concurrency limit.

### limitFunction(fn, options) <sup>named export</sup>

Returns a function with limited concurrency.

The returned function manages its own concurrent executions, allowing you to call it multiple times without exceeding the specified concurrency limit.

Ideal for scenarios where you need to control the number of simultaneous executions of a single function, rather than managing concurrency across multiple functions.

```js
import {limitFunction} from 'p-limit';

const limitedFunction = limitFunction(async () => {
	return doSomething();
}, {concurrency: 1});

const input = Array.from({length: 10}, limitedFunction);

// Only one promise is run at once.
await Promise.all(input);
```

#### fn

Type: `Function`

Promise-returning/async function.

#### options

Type: `object`

#### concurrency

Type: `number`\
Minimum: `1`

Concurrency limit.

#### rejectOnClear

Type: `boolean`\
Default: `false`

Reject pending promises with an `AbortError` when `clearQueue()` is called.
This is recommended if you await the returned promises, for example with `Promise.all`, so pending tasks do not remain unresolved after `clearQueue()`.

### limitedFunction.clearQueue()

Discard pending calls that have not started yet.

When `rejectOnClear` is enabled, pending promises are rejected with an `AbortError`. Otherwise, their promises remain unresolved.

This does not cancel calls that are already running.

## Recipes

See [recipes.md](recipes.md) for common use cases and patterns.

## FAQ

### How is this different from the [`p-queue`](https://github.com/sindresorhus/p-queue) package?

This package is only about limiting the number of concurrent executions, while `p-queue` is a fully featured queue implementation with lots of different options, introspection, and ability to pause the queue.

## Related

- [p-throttle](https://github.com/sindresorhus/p-throttle) - Throttle promise-returning & async functions
- [p-debounce](https://github.com/sindresorhus/p-debounce) - Debounce promise-returning & async functions
- [p-map](https://github.com/sindresorhus/p-map) - Run promise-returning & async functions concurrently with different inputs
- [p-all](https://github.com/sindresorhus/p-all) - Run promise-returning & async functions concurrently with optional limited concurrency
- [More…](https://github.com/sindresorhus/promise-fun)
