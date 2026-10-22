import { disconnectSetup, runBootstrap } from './seed';

runBootstrap()
  .catch((error) => { console.error('Bootstrap failed:', error); process.exitCode = 1; })
  .finally(disconnectSetup);
