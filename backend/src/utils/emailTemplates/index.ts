import { baseLayout, paragraph, infoTable, escape } from './base';

/** Notification template types (Module 10). */
export type EmailType =
  | 'trainingAssigned'
  | 'trainingDue'
  | 'trainingOverdue'
  | 'refresherDue'
  | 'assessmentBlocked'
  | 'userRequestSubmitted'
  | 'userRequestDecision'
  | 'passwordReset'
  | 'jdPendingApproval'
  | 'jdDecision'
  | 'sessionTerminated'
  | 'announcement'
  | 'scheduleCreated'
  | 'courseRevised'
  | 'retakeRequested'
  | 'retakeDecision';

export interface RenderedEmail {
  subject: string;
  html: string;
}

type Data = Record<string, string | undefined>;

/** Build the subject + HTML body for a notification type. */
export function renderEmail(type: EmailType, orgName: string, data: Data): RenderedEmail {
  const layout = (title: string, body: string) => baseLayout({ orgName, title, bodyHtml: body });

  switch (type) {
    case 'trainingAssigned':
      return {
        subject: `New training assigned: ${data.topicTitle ?? ''}`,
        html: layout(
          'New Training Assigned',
          paragraph(`Dear ${escape(data.userName)},`) +
            paragraph('You have been assigned the following training. Please complete it by the due date.') +
            infoTable([
              ['Training', data.topicTitle ?? ''],
              ['Topic Code', data.topicCode ?? ''],
              ['Due Date', data.dueDate ?? 'Not set'],
            ]),
        ),
      };
    case 'trainingDue':
      return {
        subject: `Reminder: training due — ${data.topicTitle ?? ''}`,
        html: layout(
          'Training Due Soon',
          paragraph(`The training "${escape(data.topicTitle)}" for ${escape(data.userName)} is due on ${escape(data.dueDate)}.`),
        ),
      };
    case 'trainingOverdue':
      return {
        subject: `OVERDUE: training — ${data.topicTitle ?? ''}`,
        html: layout(
          'Training Overdue',
          paragraph(`The training "${escape(data.topicTitle)}" for ${escape(data.userName)} became overdue on ${escape(data.dueDate)}. Please act immediately.`),
        ),
      };
    case 'refresherDue':
      return {
        subject: `Refresher due: ${data.topicTitle ?? ''}`,
        html: layout(
          'Refresher Training Due',
          paragraph(`A refresher for "${escape(data.topicTitle)}" is due on ${escape(data.dueDate)} for ${escape(data.userName)}.`),
        ),
      };
    case 'assessmentBlocked':
      return {
        subject: `Assessment blocked: ${data.topicTitle ?? ''}`,
        html: layout(
          'Assessment Blocked — Maximum Attempts Reached',
          paragraph(`${escape(data.userName)} has reached the maximum attempts for "${escape(data.topicTitle)}" without passing. Coordinator intervention is required.`),
        ),
      };
    case 'userRequestSubmitted':
      return {
        subject: 'New user creation request awaiting approval',
        html: layout(
          'User Creation Request',
          paragraph('A new user creation request has been submitted and requires your approval (e-signature).') +
            infoTable([
              ['Full Name', data.fullName ?? ''],
              ['Employee ID', data.employeeId ?? ''],
              ['Requested By', data.requestedBy ?? ''],
            ]),
        ),
      };
    case 'userRequestDecision':
      return {
        subject: `Your user request was ${data.decision ?? 'processed'}`,
        html: layout(
          'User Request Decision',
          paragraph(`Your user creation request has been ${escape(data.decision)}.`) +
            (data.remarks ? paragraph(`Remarks: ${escape(data.remarks)}`) : '') +
            (data.tempPassword
              ? infoTable([['Temporary Password', data.tempPassword]]) +
                paragraph('You will be required to change this password on your first login.')
              : ''),
        ),
      };
    case 'passwordReset':
      return {
        subject: 'Your izLearn password has been reset',
        html: layout(
          'Password Reset',
          paragraph(`Dear ${escape(data.userName)},`) +
            paragraph('Your password has been reset by an administrator.') +
            infoTable([['Temporary Password', data.tempPassword ?? '']]) +
            paragraph('You will be required to change this password on your next login.'),
        ),
      };
    case 'jdPendingApproval':
      return {
        subject: `Job description pending approval: ${data.title ?? ''}`,
        html: layout(
          'Job Description Pending Approval',
          paragraph(`A job description "${escape(data.title)}" is awaiting your review and approval (e-signature).`),
        ),
      };
    case 'jdDecision':
      return {
        subject: `Job description ${data.decision ?? 'updated'}: ${data.title ?? ''}`,
        html: layout(
          'Job Description Decision',
          paragraph(`The job description "${escape(data.title)}" was ${escape(data.decision)}.`),
        ),
      };
    case 'sessionTerminated':
      return {
        subject: 'Your izLearn session was terminated on another device',
        html: layout(
          'Session Terminated',
          paragraph(`Your active session on "${escape(data.deviceInfo)}" was terminated because a new sign-in occurred. If this was not you, contact your administrator immediately.`),
        ),
      };
    case 'announcement':
      return {
        subject: `Announcement: ${data.title ?? ''}`,
        html: layout('New Announcement', paragraph(escape(data.title)) + (data.content ? `<div style="font-size:14px;">${data.content}</div>` : '')),
      };
    case 'scheduleCreated':
      return {
        subject: `Training scheduled: ${data.topicTitle ?? ''}`,
        html: layout(
          'Training Scheduled',
          paragraph(`A session for "${escape(data.topicTitle)}" has been scheduled.`) +
            infoTable([
              ['Date', data.scheduledDate ?? ''],
              ['Venue', data.venue ?? 'TBD'],
            ]),
        ),
      };
    case 'courseRevised':
      return {
        subject: `Training course revised: ${data.topicTitle ?? ''}`,
        html: layout(
          'Training Course Revised',
          paragraph(`Dear ${escape(data.userName)},`) +
            paragraph(`A training course you are assigned to has been revised to a new version. Please review the updated material and complete any required re-training.`) +
            infoTable([
              ['Training', data.topicTitle ?? ''],
              ['Topic Code', data.topicCode ?? ''],
              ['Reason', data.reason ?? '—'],
            ]),
        ),
      };
    case 'retakeRequested':
      return {
        subject: `Retake request: ${data.topicTitle ?? ''}`,
        html: layout(
          'Assessment Retake Requested',
          paragraph(`${escape(data.userName)} has requested to retake the assessment for "${escape(data.topicTitle)}" after reaching the maximum attempts. Your review and approval (e-signature) is required.`) +
            (data.justification ? infoTable([['Justification', data.justification]]) : ''),
        ),
      };
    case 'retakeDecision':
      return {
        subject: `Your retake request was ${data.decision ?? 'processed'}: ${data.topicTitle ?? ''}`,
        html: layout(
          'Retake Request Decision',
          paragraph(`Your request to retake "${escape(data.topicTitle)}" has been ${escape(data.decision)}.`) +
            (data.remarks ? paragraph(`Remarks: ${escape(data.remarks)}`) : '') +
            (data.decision === 'approved'
              ? paragraph('You may now start the assessment again from your "My Trainings" page.')
              : ''),
        ),
      };
    default:
      return { subject: 'izLearn Notification', html: layout('Notification', paragraph('You have a new notification.')) };
  }
}
