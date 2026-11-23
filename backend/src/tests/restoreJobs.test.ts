import { allQueues } from '../jobs/queue';
import { redisReady } from '../config/redis';
import { pauseRestoreJobs, restoreJobCommand } from '../services/restoreJobs.service';

jest.mock('../jobs/queue', () => ({ allQueues: [{ pause: jest.fn().mockResolvedValue(undefined), getActiveCount: jest.fn().mockResolvedValue(0) }] }));
jest.mock('../config/redis', () => ({ redisReady: jest.fn().mockReturnValue(true) }));

describe('recovery job barriers', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(redisReady).mockReturnValue(true); });

  it('fails before attempting to pause queues when Redis is unavailable', async () => {
    jest.mocked(redisReady).mockReturnValue(false);
    await expect(pauseRestoreJobs()).rejects.toThrow('Redis must be available');
    expect(allQueues[0].pause).not.toHaveBeenCalled();
  });

  it('does not proceed while a background job is active', async () => {
    jest.mocked(allQueues[0].getActiveCount).mockResolvedValueOnce(1);
    await expect(pauseRestoreJobs(0)).rejects.toThrow('Background jobs did not finish');
  });

  it('bounds commands that would otherwise wait indefinitely for Redis', async () => {
    await expect(restoreJobCommand(new Promise(() => undefined), 5)).rejects.toThrow('timed out');
  });
});
