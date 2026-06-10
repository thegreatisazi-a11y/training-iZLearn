import ldap from 'ldapjs';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { getBool, getConfig } from './systemConfig.service';
import { recordEvent } from './auditTrail.service';

/**
 * Module 1 — Active Directory / LDAP integration.
 *
 * Every function tolerates LDAP being disabled or the directory being
 * unreachable: binds/searches are wrapped in try/catch and resolve to a safe
 * value rather than throwing, so a directory outage can never take down login
 * (the caller falls back to local password verification) or the sync job.
 */

interface LdapConfig {
  url: string;
  baseDn: string;
  bindDn: string;
  bindPassword: string;
}

async function loadConfig(): Promise<LdapConfig> {
  return {
    url: await getConfig('ldap.url'),
    baseDn: await getConfig('ldap.base_dn'),
    bindDn: await getConfig('ldap.bind_dn'),
    bindPassword: await getConfig('ldap.bind_password'),
  };
}

export async function isEnabled(): Promise<boolean> {
  return getBool('ldap.enabled');
}

/** Bind as the user to verify their credentials. */
export async function authenticate(username: string, password: string): Promise<boolean> {
  if (!(await isEnabled())) return false;
  const cfg = await loadConfig();
  const userDn = `${username}@${cfg.baseDn}`;
  return new Promise<boolean>((resolve) => {
    let client: ldap.Client;
    try {
      client = ldap.createClient({ url: cfg.url });
    } catch (e) {
      logger.error('LDAP client creation failed', { e: (e as Error).message });
      return resolve(false);
    }
    client.on('error', (e) => {
      logger.error('LDAP connection error', { e: (e as Error).message });
      resolve(false);
    });
    client.bind(userDn, password, (err) => {
      client.unbind(() => undefined);
      resolve(!err);
    });
  });
}

/** Confirm the account exists in the directory. With LDAP disabled there is no constraint. */
export async function userExists(username: string): Promise<boolean> {
  if (!(await isEnabled())) return true;
  const cfg = await loadConfig();
  return new Promise<boolean>((resolve) => {
    let client: ldap.Client;
    try {
      client = ldap.createClient({ url: cfg.url });
    } catch (e) {
      logger.error('LDAP client creation failed', { e: (e as Error).message });
      return resolve(false);
    }
    client.on('error', (e) => {
      logger.error('LDAP connection error', { e: (e as Error).message });
      resolve(false);
    });
    client.bind(cfg.bindDn, cfg.bindPassword, (bindErr) => {
      if (bindErr) {
        client.unbind(() => undefined);
        return resolve(false);
      }
      client.search(
        cfg.baseDn,
        { scope: 'sub', filter: `(sAMAccountName=${username})`, attributes: ['sAMAccountName'] },
        (searchErr, res) => {
          if (searchErr) {
            client.unbind(() => undefined);
            return resolve(false);
          }
          let found = false;
          res.on('searchEntry', () => {
            found = true;
          });
          res.on('error', () => {
            client.unbind(() => undefined);
            resolve(false);
          });
          res.on('end', () => {
            client.unbind(() => undefined);
            resolve(found);
          });
        },
      );
    });
  });
}

/** Fetch every active sAMAccountName from the directory. */
async function fetchActiveAdUsernames(cfg: LdapConfig): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    let client: ldap.Client;
    try {
      client = ldap.createClient({ url: cfg.url });
    } catch (e) {
      return reject(e);
    }
    client.on('error', (e) => reject(e));
    client.bind(cfg.bindDn, cfg.bindPassword, (bindErr) => {
      if (bindErr) {
        client.unbind(() => undefined);
        return reject(bindErr);
      }
      const usernames: string[] = [];
      client.search(
        cfg.baseDn,
        {
          scope: 'sub',
          // Active users: a person object whose accountDisable bit (2) is not set.
          filter: '(&(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
          attributes: ['sAMAccountName'],
        },
        (searchErr, res) => {
          if (searchErr) {
            client.unbind(() => undefined);
            return reject(searchErr);
          }
          res.on('searchEntry', (entry) => {
            const value = entry.pojo?.attributes?.find((a) => a.type === 'sAMAccountName')?.values?.[0];
            if (value) usernames.push(value);
          });
          res.on('error', (e) => {
            client.unbind(() => undefined);
            reject(e);
          });
          res.on('end', () => {
            client.unbind(() => undefined);
            resolve(usernames);
          });
        },
      );
    });
  });
}

/**
 * Daily sync: any active DB user whose Windows username is no longer present in
 * the directory is deactivated and the event is recorded for the audit trail.
 */
export async function syncActiveDirectory(): Promise<{ deactivated: number }> {
  if (!(await isEnabled())) {
    logger.info('AD sync skipped — LDAP integration is disabled.');
    return { deactivated: 0 };
  }

  const cfg = await loadConfig();
  let adUsernames: string[];
  try {
    adUsernames = await fetchActiveAdUsernames(cfg);
  } catch (e) {
    logger.error('AD sync failed — directory unreachable.', { e: (e as Error).message });
    return { deactivated: 0 };
  }

  const present = new Set(adUsernames.map((u) => u.toLowerCase()));
  const users = await prisma.user.findMany({ where: { isActive: true, isDeleted: false } });
  let deactivated = 0;

  for (const user of users) {
    if (present.has(user.windowsUsername.toLowerCase())) continue;
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await recordEvent({ action: 'AUTO_DEACTIVATED_AD_SYNC', entityType: 'User', entityId: user.id });
    deactivated += 1;
  }

  logger.info('AD sync complete.', { deactivated });
  return { deactivated };
}
