# why-is-node-running

Node.js is running but you don't know why? `why-is-node-running` is here to help you.

## Development and debug only

Use this package for **tests, local runs, and short-lived debugging**. Do not import it from production application code or long-running services.

**Loading the module starts tracking immediately.** That adds memory and CPU overhead for as long as the process runs, and the cost grows the busier your application is. Calling `whyIsNodeRunning()` only prints a report; it does not make importing the package cheap. Wrapping the call in a flag or environment variable does not help if the import is still evaluated.

When you want to diagnose a hang without changing your app's source, prefer the [CLI](#usage-as-a-cli) or [`--import`](#usage-with-nodejs---import-option) workflows below. Remove `import` statements from your code when you are done debugging.

## Installation

If you want to use `why-is-node-running` in your code, you can install it as a local dependency of your project. If you want to use it as a CLI, you can install it globally, or use `npx` to run it without installing it.

### As a local dependency

Node.js 20.11 and above (ECMAScript modules):

```bash
npm install --save-dev why-is-node-running
```

Node.js 8 or higher (CommonJS):

```bash
npm install --save-dev why-is-node-running@v2.x
```

### As a global package

```bash
npm install --global why-is-node-running
why-is-node-running /path/to/some/file.js
```

Alternatively if you do not want to install the package globally, you can run it with [`npx`](https://docs.npmjs.com/cli/commands/npx):

```bash
npx why-is-node-running /path/to/some/file.js
```

## Usage (as a dependency)

Import this only in development or test code (see [Development and debug only](#development-and-debug-only)). It should be your **first** import so stacks include the right context.

```js
import whyIsNodeRunning from 'why-is-node-running'
import { createServer } from 'node:net'

function startServer () {
  const server = createServer()
  setInterval(() => {}, 1000)
  server.listen(0)
}

startServer()
startServer()

// logs out active handles that are keeping node running
setImmediate(() => whyIsNodeRunning())
```

Save the file as `example.js`, then execute:

```bash
node ./example.js
```

Here's the output:

```
There are 4 handle(s) keeping the process running

# Timeout
example.js:6  - setInterval(() => {}, 1000)
example.js:10 - startServer()

# TCPSERVERWRAP
example.js:7  - server.listen(0)
example.js:10 - startServer()

# Timeout
example.js:6  - setInterval(() => {}, 1000)
example.js:11 - startServer()

# TCPSERVERWRAP
example.js:7  - server.listen(0)
example.js:11 - startServer()
```

## Usage (as a CLI)

You can run `why-is-node-running` as a standalone if you don't want to include it inside your code (recommended when you are not actively debugging). Sending `SIGUSR1`/`SIGINFO` signal to the process will produce the log. (`Ctrl + T` on macOS and BSD systems)

```bash
why-is-node-running /path/to/some/file.js
```

```
probing module /path/to/some/file.js
kill -SIGUSR1 31115 for logging
```

To trigger the log:

```
kill -SIGUSR1 31115
```

## Usage (with Node.js' `--import` option)

You can also use Node's [`--import`](https://nodejs.org/api/cli.html#--importmodule) option to preload `why-is-node-running`:

```bash
node --import why-is-node-running/include /path/to/some/file.js
```

The steps are otherwise the same as the above CLI section.

## License

MIT
