import { api } from '@/lib/axios';
import { createCrud, ListParams } from './crud';

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

/** Build a `?a=b&c=d` query suffix from a params object (skips empty values). */
function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * Download a protected file through axios so the JWT Authorization header is sent
 * (a plain <a>/window.open would hit the API unauthenticated → 401). The filename
 * is taken from the Content-Disposition header when present.
 */
async function downloadAuthed(url: string, fallbackName: string): Promise<void> {
  const res = await api.get(url, { responseType: 'blob' });
  const cd = (res.headers['content-disposition'] as string | undefined) ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^"";]+)"?/i.exec(cd);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  downloadBlob(res.data as Blob, name);
}

/** Central API facade. Pages call e.g. svc.users.list(params), svc.assessments.start(...). */
export const svc = {
  auth: {
    me: () => data(api.get('/auth/me')),
    changePassword: (body: unknown) => api.post('/auth/change-password', body),
    setSignaturePassword: (body: unknown) => api.post('/auth/set-signature-password', body),
    terminatePrevious: () => api.delete('/auth/sessions/previous'),
  },

  dashboard: { get: () => data(api.get('/dashboard')) },

  users: {
    ...createCrud('/users'),
    listRequests: (params?: ListParams) => api.get('/users/requests', { params }).then((r) => r.data),
    getRequest: (id: string) => data(api.get(`/users/requests/${id}`)),
    createRequest: (body: unknown) => data(api.post('/users/requests', body)),
    decideRequest: (id: string, body: unknown) => data(api.post(`/users/requests/${id}/decision`, body)),
    activate: (id: string, body: unknown) => data(api.post(`/users/${id}/activate`, body)),
    deactivate: (id: string, body: unknown) => data(api.post(`/users/${id}/deactivate`, body)),
    resetPassword: (id: string, body: unknown) => data(api.post(`/users/${id}/reset-password`, body)),
    changeRoles: (id: string, body: unknown) => data(api.post(`/users/${id}/roles`, body)),
    bulkPreview: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/users/bulk/preview', fd).then((r) => r.data.data);
    },
    bulkCommit: (rows: unknown) => api.post('/users/bulk/commit', { rows }).then((r) => r.data.data),
    lifecycle: (id: string) => data(api.get(`/users/${id}/lifecycle`)),
    setReleaseStage: (id: string, body: unknown) => data(api.post(`/users/${id}/release-stage`, body)),
    team: (params?: ListParams) => api.get('/users/team', { params }).then((r) => r.data),
    teamHistory: (userId: string) => data(api.get(`/users/team/${userId}/history`)),
  },

  roles: createCrud('/roles'),
  locations: createCrud('/locations'),
  departments: createCrud('/departments'),

  topics: {
    ...createCrud('/topics'),
    revise: (id: string, body: unknown) => data(api.post(`/topics/${id}/revise`, body)),
    publishDraft: (id: string, body: unknown) => data(api.post(`/topics/${id}/publish-draft`, body)),
    updatePassingScore: (id: string, body: unknown) => data(api.patch(`/topics/${id}/passing-score`, body)),
    updateStatus: (id: string, body: unknown) => data(api.patch(`/topics/${id}/status`, body)),
    history: (id: string, params?: ListParams) => api.get(`/topics/${id}/history`, { params }).then((r) => r.data),
    exportCsv: (params?: { status?: string; search?: string }) => downloadAuthed(`/topics/export${qs(params)}`, 'training-topics.csv'),
  },

  materials: {
    list: (params?: ListParams) => api.get('/materials', { params }).then((r) => r.data),
    upload: (file: File, topicId: string) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('topicId', topicId);
      return api.post('/materials', fd).then((r) => r.data.data);
    },
    replace: (id: string, file: File, reasonForChange: string) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('reasonForChange', reasonForChange);
      return api.post(`/materials/${id}/replace`, fd).then((r) => r.data.data);
    },
    attachFromLibrary: (materialId: string, topicId: string, reasonForChange?: string) =>
      data(api.post('/materials/attach', { materialId, topicId, reasonForChange })),
    setViewTime: (id: string, requiredViewSeconds: number) => data(api.patch(`/materials/${id}`, { requiredViewSeconds })),
    startView: (id: string) => data(api.post(`/materials/${id}/view/start`, {})),
    completeView: (id: string) => data(api.post(`/materials/${id}/view/complete`, {})),
    // A4: auto-save accumulated reading seconds so the session can resume.
    saveProgress: (id: string, elapsedSeconds: number) => data(api.post(`/materials/${id}/view/progress`, { elapsedSeconds })),
    readingStatus: (topicId: string) => data(api.get('/materials/reading-status', { params: { topicId } })),
    downloadUrl: (id: string) => `/api/materials/${id}/download`,
    download: (id: string, name = 'material') => downloadAuthed(`/materials/${id}/download`, name),
    remove: (id: string, reasonForChange: string) => api.delete(`/materials/${id}`, { data: { reasonForChange } }),
    /** Discard a staged (pending) file before it goes live — no reason required. */
    discardStaged: (id: string) => api.delete(`/materials/${id}/staged`).then((r) => r.data.data),
  },

  bundles: {
    ...createCrud('/bundles'),
    detail: (id: string) => data(api.get(`/bundles/${id}/detail`)),
    addTopicToBundles: (topicId: string, bundleIds: string[]) => data(api.post(`/bundles/topics/${topicId}`, { bundleIds })),
    assign: (id: string, body: unknown) => data(api.post(`/bundles/${id}/assign`, body)),
    setActive: (id: string, isActive: boolean, reasonForChange: string) => data(api.patch(`/bundles/${id}/active`, { isActive, reasonForChange })),
    exportCsv: (params?: { search?: string }) => downloadAuthed(`/bundles/export${qs(params)}`, 'bundles.csv'),
  },

  questions: createCrud('/questions'),

  schedules: {
    ...createCrud('/schedules'),
    createOjt: (body: unknown) => data(api.post('/schedules/ojt', body)),
    listOjt: (params?: ListParams) => api.get('/schedules/ojt/list', { params }).then((r) => r.data),
    createOffline: (body: unknown) => data(api.post('/schedules/offline', body)),
    cancel: (id: string, reasonForChange: string) => data(api.post(`/schedules/${id}/cancel`, { reasonForChange })),
  },

  assignments: {
    ...createCrud('/assignments'),
    mine: () => data(api.get('/assignments/mine')),
    waive: (id: string, body: unknown) => data(api.post(`/assignments/${id}/waive`, body)),
    activate: (id: string) => data(api.post(`/assignments/${id}/activate`, {})),
    supervisorDecision: (id: string, body: unknown) => data(api.post(`/assignments/${id}/supervisor-decision`, body)),
  },

  attendance: {
    list: (scheduleId: string) => data(api.get(`/attendance/schedule/${scheduleId}`)),
    mark: (body: unknown) => data(api.post('/attendance', body)),
    uploadPreview: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/attendance/upload/preview', fd).then((r) => r.data.data);
    },
    uploadCommit: (file: File, scheduleId: string) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scheduleId', scheduleId);
      return api.post('/attendance/upload/commit', fd).then((r) => r.data.data);
    },
  },

  assessments: {
    start: (body: unknown) => data(api.post('/assessments/start', body)),
    submit: (body: unknown) => data(api.post('/assessments/submit', body)),
    acknowledgeRead: (body: unknown) => data(api.post('/assessments/acknowledge-read', body)),
    listMine: (params?: ListParams) => data(api.get('/assessments/mine', { params })),
    list: (params?: ListParams) => data(api.get('/assessments', { params })),
    get: (id: string) => data(api.get(`/assessments/${id}`)),
    unblock: (assignmentId: string, body: unknown) => data(api.post(`/assessments/assignments/${assignmentId}/unblock`, body)),
  },

  certificates: {
    listMine: () => data(api.get('/certificates/mine')),
    list: (params?: ListParams) => data(api.get('/certificates', { params })),
    get: (id: string) => data(api.get(`/certificates/${id}`)),
    downloadUrl: (id: string) => `/api/certificates/${id}/download`,
    download: (id: string, name = `certificate-${id}.pdf`) => downloadAuthed(`/certificates/${id}/download`, name),
    issue: (attemptId: string) => data(api.post('/certificates/issue', { attemptId })),
  },

  jds: {
    ...createCrud('/job-descriptions'),
    transition: (id: string, body: unknown) => data(api.post(`/job-descriptions/${id}/transition`, body)),
    history: (userId: string) => data(api.get(`/job-descriptions/user/${userId}/history`)),
    listTemplates: (params?: ListParams) => api.get('/job-descriptions/templates', { params }).then((r) => r.data),
    createTemplate: (body: unknown) => data(api.post('/job-descriptions/templates', body)),
    updateTemplate: (id: string, body: unknown) => data(api.patch(`/job-descriptions/templates/${id}`, body)),
    fromTemplate: (body: unknown) => data(api.post('/job-descriptions/from-template', body)),
    mine: () => data(api.get('/job-descriptions/mine')),
    mineList: () => data(api.get('/job-descriptions/mine/list')),
    acknowledge: (id: string, body: unknown) => data(api.post(`/job-descriptions/${id}/acknowledge`, body)),
    assignFunctionalRole: (body: unknown) => data(api.post('/job-descriptions/assign-functional-role', body)),
    assignFromTemplate: (body: unknown) => data(api.post('/job-descriptions/assign-from-template', body)),
  },

  cv: {
    mine: () => data(api.get('/cv/mine')),
    save: (body: unknown) => data(api.post('/cv/mine', body)),
    // cv/team is sent via sendSuccess ({success,data:payload}) — unlike other list
    // endpoints that use sendPaginated — so unwrap the extra level to the paginated
    // payload, letting the page read data.data as the rows array (matches createCrud).
    team: (params?: ListParams) => api.get('/cv/team', { params }).then((r) => r.data.data),
    user: (userId: string) => data(api.get(`/cv/user/${userId}`)),
  },

  tni: {
    ...createCrud('/tni'),
    decide: (id: string, body: unknown) => data(api.post(`/tni/${id}/decision`, body)),
    matrix: () => data(api.get('/tni/requirements/matrix')),
    setRequirement: (body: unknown) => data(api.post('/tni/requirements', body)),
    applyMatrix: (body: unknown) => data(api.post('/tni/requirements/apply', body)),
  },

  retake: {
    /** Trainee: request to retake a blocked assessment. */
    create: (body: unknown) => data(api.post('/retake-requests', body)),
    /** Trainee: their own retake requests (with status). */
    mine: () => data(api.get('/retake-requests/mine')),
    /** Supervisor: retake requests routed to them. */
    list: (params?: ListParams) => api.get('/retake-requests', { params }).then((r) => r.data),
    /** Supervisor: approve / reject a retake request (e-signed). */
    decide: (id: string, body: unknown) => data(api.post(`/retake-requests/${id}/decision`, body)),
  },

  feedback: {
    listForms: (params?: ListParams) => api.get('/feedback/forms', { params }).then((r) => r.data),
    getForm: (id: string) => data(api.get(`/feedback/forms/${id}`)),
    createForm: (body: unknown) => data(api.post('/feedback/forms', body)),
    updateForm: (id: string, body: unknown) => data(api.patch(`/feedback/forms/${id}`, body)),
    submit: (body: unknown) => data(api.post('/feedback/submit', body)),
    analysis: (id: string) => data(api.get(`/feedback/forms/${id}/analysis`)),
  },

  announcements: {
    ...createCrud('/announcements'),
    feed: () => data(api.get('/announcements/feed')),
  },

  signatures: {
    list: (recordType: string, recordId: string) => data(api.get('/signatures', { params: { recordType, recordId } })),
    sign: (body: unknown) => data(api.post('/signatures', body)),
  },

  audit: {
    list: (params?: ListParams) => api.get('/audit-trail', { params }).then((r) => r.data),
    export: (format: string, body: unknown) =>
      api.post('/audit-trail/export', { format, ...(body as object) }, { responseType: 'blob' }),
  },

  systemConfig: {
    list: () => data(api.get('/system-config')),
    update: (body: unknown) => data(api.patch('/system-config', body)),
  },

  reports: {
    types: () => data(api.get('/reports')),
    get: (type: string, params?: ListParams) => data(api.get(`/reports/${type}`, { params })),
    export: (type: string, params: Record<string, unknown>) =>
      api.post(`/reports/${type}/export`, params, { responseType: 'blob', params }),
  },

  personalDocs: {
    mine: () => data(api.get('/personal-documents/me')),
    byUser: (userId: string) => data(api.get(`/personal-documents/user/${userId}`)),
    upload: (file: File, documentType: string, title: string, userId?: string) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', documentType);
      fd.append('title', title);
      if (userId) fd.append('userId', userId);
      return api.post('/personal-documents', fd).then((r) => r.data.data);
    },
    downloadUrl: (id: string) => `/api/personal-documents/${id}/download`,
    download: (id: string, name = 'document') => downloadAuthed(`/personal-documents/${id}/download`, name),
    remove: (id: string, reasonForChange: string) => api.delete(`/personal-documents/${id}`, { data: { reasonForChange } }),
  },

  admin: {
    triggerBackup: (signature: unknown) => data(api.post('/admin/backup/trigger', { signature })),
    backups: () => data(api.get('/admin/backups')),
  },

  master: {
    listTrainingTypes: (params?: ListParams) => api.get('/master/training-types', { params }).then((r) => r.data),
    createTrainingType: (body: unknown) => data(api.post('/master/training-types', body)),
    updateTrainingType: (id: string, body: unknown) => data(api.patch(`/master/training-types/${id}`, body)),
    deleteTrainingType: (id: string, reasonForChange: string) => data(api.delete(`/master/training-types/${id}`, { data: { reasonForChange } })),
    listDocumentTypes: (params?: ListParams) => api.get('/master/document-types', { params }).then((r) => r.data),
    createDocumentType: (body: unknown) => data(api.post('/master/document-types', body)),
    updateDocumentType: (id: string, body: unknown) => data(api.patch(`/master/document-types/${id}`, body)),
    deleteDocumentType: (id: string, reasonForChange: string) => data(api.delete(`/master/document-types/${id}`, { data: { reasonForChange } })),
    listDesignations: (params?: ListParams) => api.get('/master/designations', { params }).then((r) => r.data),
    createDesignation: (body: unknown) => data(api.post('/master/designations', body)),
    updateDesignation: (id: string, body: unknown) => data(api.patch(`/master/designations/${id}`, body)),
    deleteDesignation: (id: string, reasonForChange: string) =>
      data(api.delete(`/master/designations/${id}`, { data: { reasonForChange } })),
  },

  certificateTemplates: {
    list: (params?: { certificateType?: string; includeInactive?: boolean }) =>
      data(api.get('/admin/certificate-templates', { params })),
    get: (id: string) => data(api.get(`/admin/certificate-templates/${id}`)),
    create: (body: unknown) => data(api.post('/admin/certificate-templates', body)),
    update: (id: string, body: unknown) => data(api.put(`/admin/certificate-templates/${id}`, body)),
    remove: (id: string) => data(api.delete(`/admin/certificate-templates/${id}`)),
    setDefault: (id: string) => data(api.post(`/admin/certificate-templates/${id}/set-default`, {})),
    duplicate: (id: string) => data(api.post(`/admin/certificate-templates/${id}/duplicate`, {})),
    /** Open the server-rendered preview PDF in a new tab (authenticated). */
    previewPdf: async (id: string) => {
      const res = await api.post(`/admin/certificate-templates/${id}/preview`, {}, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  },
};

/** Trigger a browser download from a Blob response. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
