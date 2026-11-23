import { allQueues } from '../jobs/queue';
import { redisReady } from '../config/redis';

export async function restoreJobCommand<T>(work: Promise<T>, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Redis queue command timed out during recovery.')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function pauseRestoreJobs(timeoutMs = 60000) {
  if (!redisReady()) throw new Error('Redis must be available before restoring a backup.');
  await restoreJobCommand(Promise.all(allQueues.map((queue) => queue.pause(false))));
  const until = Date.now() + timeoutMs;
  while ((await restoreJobCommand(Promise.all(allQueues.map((queue) => queue.getActiveCount())))).some((count) => count > 0)) {
    if (Date.now() >= until) throw new Error('Background jobs did not finish before recovery. Please try again later.');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function resumeRestoreJobs() {
  if (!redisReady()) throw new Error('Redis must be available to resume background jobs.');
  await restoreJobCommand(Promise.all(allQueues.map((queue) => queue.resume(false))));
}

export async function clearPreRestoreJobs() {
  for (const queue of allQueues) {
    for (const job of await restoreJobCommand(queue.getRepeatableJobs())) await restoreJobCommand(queue.removeRepeatableByKey(job.key));
    await restoreJobCommand(queue.empty()); // Pending notifications/jobs refer to the superseded database.
  }
}
