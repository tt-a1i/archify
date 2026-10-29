import { createHook } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const IGNORED_TYPES = [
  'TIMERWRAP',
  'PROMISE',
  'PerformanceObserver',
  'RANDOMBYTESREQUEST'
]

const asyncResources = new Map()
const hook = createHook({
  init (asyncId, type, triggerAsyncId, resource) {
    if (IGNORED_TYPES.includes(type)) {
      return
    }

    const stacks = captureStackTraces().slice(1)

    asyncResources.set(asyncId, {
      type,
      resourceRef: new WeakRef(resource),
      stacks
    })
  },
  destroy (asyncId) {
    asyncResources.delete(asyncId)
  }
})

hook.enable()

export default function whyIsNodeRunning (logger = console) {
  hook.disable()

  const activeAsyncResources = Array.from(asyncResources.values())
    .filter(({ resourceRef }) => {
      const resource = resourceRef.deref()

      if (resource === undefined) {
        return false
      }
  
      return resource.hasRef?.() ?? true
    })

  logger.error(`There are ${activeAsyncResources.length} handle(s) keeping the process running.`)

  for (const asyncResource of activeAsyncResources) {
    printStacks(asyncResource, logger)
  }
}

function printStacks (asyncResource, logger) {
  const stacks = asyncResource.stacks.filter((stack) => {
    const fileName = stack.fileName
    return fileName !== null && !fileName.startsWith('node:')
  })

  logger.error('')
  logger.error(`# ${asyncResource.type}`)

  if (!stacks[0]) {
    logger.error('(unknown stack trace)')
    return
  }

  const maxLength = stacks.reduce((length, stack) => Math.max(length, formatLocation(stack).length), 0)

  for (const stack of stacks) {
    const location = formatLocation(stack)
    const padding = ' '.repeat(maxLength - location.length)
    
    try {
      const lines = readFileSync(normalizeFilePath(stack.fileName), 'utf-8').split(/\n|\r\n/)
      const line = lines[stack.lineNumber - 1].trim()

      logger.error(`${location}${padding} - ${line}`)
    } catch (e) {
      logger.error(`${location}${padding}`)
    }
  }
}

function formatLocation (stack) {
  const filePath = formatFilePath(stack.fileName)
  return `${filePath}:${stack.lineNumber}`
}

function formatFilePath (filePath) {
  const absolutePath = normalizeFilePath(filePath)
  const relativePath = relative(process.cwd(), absolutePath)

  return relativePath.startsWith('..') ? absolutePath : relativePath
}

function normalizeFilePath (filePath) {
  return filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath
}

function prepareStackTrace(error, stackTraces) {
  return stackTraces.map(stack => ({
    lineNumber: stack.getLineNumber(),
    fileName: stack.getFileName()
  }))
}

// See: https://v8.dev/docs/stack-trace-api
function captureStackTraces () {
  const target = {}
  const original = Error.prepareStackTrace

  Error.prepareStackTrace = prepareStackTrace
  Error.captureStackTrace(target, captureStackTraces)

  const capturedTraces = target.stack
  Error.prepareStackTrace = original

  return capturedTraces
}
