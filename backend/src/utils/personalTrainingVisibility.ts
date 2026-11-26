type TrainingTopicVisibility = {
  status: string;
  supersededByTopicId?: string | null;
  isDeleted?: boolean;
};

/** The same course visibility rules apply to every user's personal training. */
export function isVisiblePersonalTraining(status: string, topic: TrainingTopicVisibility | null | undefined): boolean {
  if (!topic || topic.isDeleted || topic.supersededByTopicId) return false;
  if (status === 'DEFERRED' || status === 'NOT_REQUIRED') return false;
  return status === 'COMPLETED' || status === 'WAIVED' || topic.status === 'PUBLISHED';
}
