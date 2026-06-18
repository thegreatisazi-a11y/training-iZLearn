/**
 * @izlearn/shared — Zod schemas & types shared between the izLearn frontend
 * and backend. Validation logic lives here exactly once so the rules enforced
 * in the browser are identical to the rules enforced on the server.
 */
export * from './common';
export * from './enums';
export * from './permissionCatalog';
export * from './notificationCatalog';
export * from './notificationSetting';
export * from './auth';
export * from './eSignature';
export * from './location';
export * from './department';
export * from './trainingTypeMaster';
export * from './documentTypeMaster';
export * from './role';
export * from './user';
export * from './designation';
export * from './bundle';
export * from './trainingTopic';
export * from './trainingMaterial';
export * from './question';
export * from './schedule';
export * from './assignment';
export * from './attendance';
export * from './assessment';
export * from './certificate';
export * from './certificateTemplate';
export * from './jobDescription';
export * from './cv';
export * from './personalDocument';
export * from './tni';
export * from './retake';
export * from './feedback';
export * from './announcement';
export * from './systemConfig';
