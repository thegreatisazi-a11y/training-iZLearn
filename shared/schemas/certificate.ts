import { z } from 'zod';
import { uuid } from './common';

export const issueCertificateSchema = z.object({
  attemptId: uuid,
});
export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

export interface CertificateView {
  id: string;
  certificateNumber: string;
  userId: string;
  userFullName: string;
  employeeId: string;
  topicId: string;
  topicTitle: string;
  topicCode: string;
  score: number | null;
  certificateType: string;
  issuedAt: string;
}
