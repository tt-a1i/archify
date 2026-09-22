# Image transformation pipeline

Create an architecture diagram from this repository's source for the image
transformation pipeline. Show the request entry point, format policy, queued
work, worker reads from the original-image store, transformation, and writes
to the derived-image store. Unsupported formats must go to the manual review
queue, while any caught worker failure retries up to the configured attempt
count and eventually becomes a failed job.
