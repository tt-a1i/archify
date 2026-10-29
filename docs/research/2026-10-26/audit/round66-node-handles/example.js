import whyIsNodeRunning from 'why-is-node-running' // should be your first import
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
