import { syncActiveDirectory } from '../../services/ldap.service';

/** Scheduled Active Directory sync (Module 1). Delegates to ldap.service. */
export async function runAdSync() {
  return syncActiveDirectory();
}
