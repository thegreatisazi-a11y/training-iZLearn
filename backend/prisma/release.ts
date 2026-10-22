import { disconnectSetup, runReleaseMigrations } from './seed';

runReleaseMigrations()
  .then(() => console.log('Release migrations complete.'))
  .catch((error) => { console.error('Release migrations failed:', error); process.exitCode = 1; })
  .finally(disconnectSetup);
