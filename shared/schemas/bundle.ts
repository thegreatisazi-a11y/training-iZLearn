import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';

/**
 * Topic bundles — a named collection of training topics that can be assigned
 * together to selected departments and/or roles. Targeting is stored inline as
 * JSON arrays of ids (mirroring the Announcement.targetRoles precedent).
 */
export const createBundleSchema = z.object({
  name: nonEmptyString,
  description: optionalString,
  topicIds: z.array(uuid).default([]),
  departmentIds: z.array(uuid).default([]),
  roleIds: z.array(uuid).default([]),
  designationIds: z.array(uuid).default([]),
  userIds: z.array(uuid).default([]), // specific users to assign to (in addition to dept/role/designation)
  dueDate: z.coerce.date().optional(),
});
export type CreateBundleInput = z.infer<typeof createBundleSchema>;

export const updateBundleSchema = z.object({
  name: nonEmptyString.optional(),
  description: optionalString,
  topicIds: z.array(uuid).optional(),
  departmentIds: z.array(uuid).optional(),
  roleIds: z.array(uuid).optional(),
  designationIds: z.array(uuid).optional(),
  userIds: z.array(uuid).optional(),
  dueDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateBundleInput = z.infer<typeof updateBundleSchema>;

/** Link an existing topic to one or more bundles (from the topic detail page). */
export const addTopicToBundlesSchema = z.object({
  bundleIds: z.array(uuid).min(1, { message: 'Select at least one bundle' }),
});
export type AddTopicToBundlesInput = z.infer<typeof addTopicToBundlesSchema>;

/** Assign a bundle: expand to per-(user × topic) assignments for the targets. */
export const assignBundleSchema = z.object({
  dueDate: z.coerce.date().optional(),
  reasonForChange: reasonForChange.optional(),
});
export type AssignBundleInput = z.infer<typeof assignBundleSchema>;
