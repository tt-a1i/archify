# p-limit module architecture

Read this repository and create an architecture diagram of its concurrency
limiting module. Show the public factory and its returned limiter, the queue
that holds pending work, the active task runner, and the completion path that
admits the next item. Include the configurable concurrency boundary and the
separate map and clear-queue capabilities.
