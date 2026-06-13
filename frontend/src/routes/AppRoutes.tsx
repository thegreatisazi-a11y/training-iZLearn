import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from './ProtectedRoute';
import { PermissionRoute } from './PermissionRoute';
import { PageLoader } from '@/components/ui/spinner';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ChangePasswordPage = lazy(() => import('@/pages/auth/ChangePasswordPage'));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const UsersPage = lazy(() => import('@/pages/users/UsersPage'));
const UserRequestsPage = lazy(() => import('@/pages/users/UserRequestsPage'));
const UserBulkUploadPage = lazy(() => import('@/pages/users/UserBulkUploadPage'));
const RolesPage = lazy(() => import('@/pages/roles/RolesPage'));
const MastersPage = lazy(() => import('@/pages/masters/MastersPage'));
const TopicsPage = lazy(() => import('@/pages/topics/TopicsPage'));
const TopicDetailPage = lazy(() => import('@/pages/topics/TopicDetailPage'));
const BundlesPage = lazy(() => import('@/pages/bundles/BundlesPage'));
const BundleDetailPage = lazy(() => import('@/pages/bundles/BundleDetailPage'));
const MaterialLibraryPage = lazy(() => import('@/pages/materials/MaterialLibraryPage'));
const MaterialViewerPage = lazy(() => import('@/pages/materials/MaterialViewerPage'));
const MyTrainingsPage = lazy(() => import('@/pages/training/MyTrainingsPage'));
const JDPage = lazy(() => import('@/pages/jd/JDPage'));
const MyJobDescriptionPage = lazy(() => import('@/pages/jd/MyJobDescriptionPage'));
const MyCVPage = lazy(() => import('@/pages/cv/MyCVPage'));
const TeamCVsPage = lazy(() => import('@/pages/cv/TeamCVsPage'));
const TNIPage = lazy(() => import('@/pages/tni/TNIPage'));
const SchedulesPage = lazy(() => import('@/pages/schedules/SchedulesPage'));
const AttendancePage = lazy(() => import('@/pages/schedules/AttendancePage'));
const AssessmentsPage = lazy(() => import('@/pages/assessments/AssessmentsPage'));
const TakeAssessmentPage = lazy(() => import('@/pages/assessments/TakeAssessmentPage'));
const CertificatesPage = lazy(() => import('@/pages/certificates/CertificatesPage'));
const CertificateTemplatesPage = lazy(() => import('@/pages/admin/CertificateTemplatesPage'));
const FeedbackPage = lazy(() => import('@/pages/feedback/FeedbackPage'));
const AnnouncementsPage = lazy(() => import('@/pages/announcements/AnnouncementsPage'));
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'));
const AuditTrailPage = lazy(() => import('@/pages/audit/AuditTrailPage'));
const SystemConfigPage = lazy(() => import('@/pages/system/SystemConfigPage'));
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const gate = (module: string, action: 'read' | 'write', el: JSX.Element) => (
  <PermissionRoute module={module} action={action}>
    {el}
  </PermissionRoute>
);

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/users" element={gate('userManagement', 'read', <UsersPage />)} />
            <Route path="/users/requests" element={gate('userManagement', 'read', <UserRequestsPage />)} />
            <Route path="/users/bulk" element={gate('userManagement', 'write', <UserBulkUploadPage />)} />
            <Route path="/roles" element={gate('roleManagement', 'read', <RolesPage />)} />
            <Route path="/masters" element={gate('masterSetup', 'read', <MastersPage />)} />
            <Route path="/topics" element={gate('courseManagement', 'read', <TopicsPage />)} />
            <Route path="/topics/:id" element={gate('courseManagement', 'read', <TopicDetailPage />)} />
            <Route path="/bundles" element={gate('bundleManagement', 'read', <BundlesPage />)} />
            <Route path="/bundles/:id" element={gate('bundleManagement', 'read', <BundleDetailPage />)} />
            <Route path="/materials" element={gate('materialManagement', 'read', <MaterialLibraryPage />)} />
            <Route path="/materials/:id/view" element={gate('materialManagement', 'read', <MaterialViewerPage />)} />
            <Route path="/my-trainings" element={<MyTrainingsPage />} />
            <Route path="/job-descriptions" element={gate('jobDescription', 'read', <JDPage />)} />
            <Route path="/my-jd" element={<MyJobDescriptionPage />} />
            <Route path="/my-cv" element={<MyCVPage />} />
            <Route path="/team-cvs" element={gate('userManagement', 'read', <TeamCVsPage />)} />
            <Route path="/tni" element={gate('tni', 'read', <TNIPage />)} />
            <Route path="/schedules" element={gate('scheduling', 'read', <SchedulesPage />)} />
            <Route path="/schedules/:id/attendance" element={gate('attendance', 'read', <AttendancePage />)} />
            <Route path="/assessments" element={gate('assessments', 'read', <AssessmentsPage />)} />
            <Route path="/assessments/take/:topicId" element={gate('assessments', 'write', <TakeAssessmentPage />)} />
            <Route path="/certificates" element={gate('certificates', 'read', <CertificatesPage />)} />
            <Route path="/admin/certificate-templates" element={gate('certificates', 'write', <CertificateTemplatesPage />)} />
            <Route path="/feedback" element={gate('feedback', 'read', <FeedbackPage />)} />
            <Route path="/announcements" element={gate('announcements', 'read', <AnnouncementsPage />)} />
            <Route path="/reports" element={gate('reports', 'read', <ReportsPage />)} />
            <Route path="/audit-trail" element={gate('auditTrail', 'read', <AuditTrailPage />)} />
            <Route path="/system-config" element={gate('systemConfig', 'read', <SystemConfigPage />)} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
