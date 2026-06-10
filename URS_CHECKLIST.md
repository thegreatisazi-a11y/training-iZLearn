# izLearn URS Requirements Checklist (extracted from URS.pdf)

Status legend: [ ] unknown, [C] covered, [P] partial, [M] missing, [F] fixed

## Operational Requirements (UR-1 .. UR-38)
- UR-1: Bulk upload in .xls
- UR-2: Mapping and re-mapping activities related to course vs functional roles
- UR-3: Manual mapping — course-specific / person-specific / functional-role-specific
- UR-4: Map training via workflow
- UR-5: Announcement on dashboard
- UR-6: Upload or generate JD per departmental role, approved via workflow
- UR-7: Update JD on department transfer; fetch from master JD template on functional role assign
- UR-8: Upload other personal documents per user
- UR-9: Create different types of training topics
- UR-10: Manage both Online and offline training
- UR-11: Upload on-the-job (OJT) training data
- UR-12: Upload offline training and evaluation data
- UR-13: Manage file types as training materials (pdf, word, ppt, mp4 etc.)
- UR-14: Manage and map multiple training materials for a topic
- UR-15: Update training material based on revision/obsolete
- UR-16: Only current version of training material visible to user
- UR-17: Modify duration of training course
- UR-18: Create training need identification (TNI)
- UR-19: Schedule trainings selecting trainer and assigning trainees
- UR-20: Schedule trainings with different methodologies
- UR-21: Select trainer
- UR-22: Refresher scheduling (12, 24 months etc.)
- UR-23: Restrict trainer from being trainee in same classroom training
- UR-24: Online/offline attendance system
- UR-25: Mark attendance via Excel upload or manual selection
- UR-26: Generate assessment via randomized questions from question bank
- UR-27: Add/edit/remove questions per topic
- UR-28: Manage question types (MCQ, match the words, fill in the blanks etc.)
- UR-29: Block training after defined failed attempts
- UR-30: Set passing criteria
- UR-31: Manage mandatory questions
- UR-32: Produce results immediately after submission
- UR-33: Update user with correct understanding of incorrect answer after evaluation
- UR-34: View summary (score, #appeared, #attempted, correct/incorrect)
- UR-35: Keep training records intact on intra/inter department transfer
- UR-36: Generate training completion certificate
- UR-37: Create feedback questionnaire types; feedback evaluation/analysis
- UR-38: Library to upload different training materials

## Functional Requirements (UR-39 .. UR-44)
- UR-39: Date format DD/MM/YY, time format HH:MM
- UR-40: Generate message for errors during process (comm error etc.)
- UR-41: Must not allow unintended changes/tampering of error message
- UR-42: Automatic email notifications (Pending Training to Employee/Supervisor/Dept Head/Coordinator-QA)
- UR-43: Add restriction criteria (pass-out criteria, quiz accessibility)
- UR-44: Disable user when left organization; training records intact

## Security Requirements (UR-45 .. UR-50)
- UR-45: Two distinct identification components (User ID/password) or biometrics
- UR-46: Lock user session after inactivity; re-enter User ID + password
- UR-47: No delete account; deactivate only; right with Administrator
- UR-48: Role-based configuration
- UR-49: Configure different access privileges for user groups
- UR-50: Add single user ID in multiple system roles

## Data Requirements (UR-51 .. UR-56)
- UR-51: Electronic data/reports human readable, date and time stamped
- UR-52: Auto data backup to client or central server
- UR-53: Acquire date and time from server
- UR-54: Not allow to initiate any form in future date
- UR-55: Manual and auto backup
- UR-56: Recovery/restore functions for electronic data + audit trail data

## Electronic Signature Requirements (UR-65 .. UR-67)
- UR-65: Each e-signature unique to one individual
- UR-66: Two components for execution of signature
- UR-67: Signed records contain signer printed name, date and time of signing, meaning

## Reporting Requirements (UR-68 .. UR-74)
- UR-68: Reports contain date/time stamp + user identification
- UR-69: Configurable reports (training topic-wise, department-wise, pending/completed, job role/function-wise, version-wise, employee JD history)
- UR-70: Access inactive users' data only (toggle)
- UR-71: Access active users' data
- UR-72: Download audit trail and reports in pdf, csv, xls
- UR-73: Induction Process
- UR-74: Generate Induction Certificate

## User Management (UR-75 .. UR-101)
- UR-75: Accessible using valid User ID and Password
- UR-76: Select users available in active directory
- UR-77: Create new users not available in AD (manual)
- UR-78: Invalid User ID denied access
- UR-79: Invalid password denied access
- UR-80: No permission for user to access applications outside network/domain
- UR-81: No login on multiple computers at same time
- UR-82: Message if user logs in multiple systems
- UR-83: Terminate session from previous computer; capture in audit trail
- UR-84: On browser close, ask to log-out previous session on next login
- UR-85: Location-specific user mapping
- UR-86: Assign multiple roles to users
- UR-87: Reset user location, roles, department, email, access permission
- UR-88: Creation/reset/deactivation/activation by authorized person for all locations
- UR-89: Notify admin via email for each generated request
- UR-90: Notify user via email after request performed
- UR-91: Notify requesting user via email on rejection
- UR-92: Password policy + auto logout per in-house policy
- UR-93: E-signature passwords for critical activity
- UR-94: Auto-deactivate users removed from AD; capture in audit trail
- UR-95: Add and modify location information
- UR-96: Role-based access controls per role and module
- UR-97: No copy-paste and save of login credentials
- UR-98: Role-based dashboard
- UR-99: Dynamic user rights allocation per role
- UR-100: Server date, time, timezone for all activities
- UR-101: User creation request in electronic format with required fields (UserType, FullName, EmployeeID, WindowsUsername, Email, Department, Multi-Role, Location, Remarks)

## Master Setup Configuration (UR-102 .. UR-110)
- UR-102: Capture master details (users, location, dept, role&access, training types, doc types)
- UR-103: Add/modify Location, Dept, Role&Access, Training Types, Document Types
- UR-104: Training ID once saved cannot be modified/re-entered (uniqueness locked)
- UR-105: Audit trail for every workflow
- UR-106: Secondary password during verification/review/approval
- UR-107: Print reports only by authorized user
- UR-108: Generate accurate complete copies (human readable + electronic) for regulatory
- UR-109: Record date/time stamps in secure server time
- UR-110: E-signatures permanently linked to records; include username, date/time, meaning

## Audit Trail and Report (UR-137 .. UR-170)
- UR-137: Audit trail for all GMP/GLP activities (create/modify/delete/approve/login/logout/config)
- UR-138: Record identity of user performing action
- UR-139: Record date/time via secure system-generated timestamp
- UR-140: Capture old and new values for modified records
- UR-141: Capture record ID/reference number
- UR-142: Mandatory reason for change on modify/delete of GMP/GLP records
- UR-143: Changes shall not obscure/overwrite/delete original info
- UR-144: Computer-generated, secure, non-editable, protected
- UR-145: Enabled by default; cannot be disabled by users/admins
- UR-146: Generation/storage outside control of standard users and admins
- UR-147: Record successful and unsuccessful login attempts
- UR-148: Searchable and retrievable throughout retention period
- UR-149: Configurable search and filtering for review
- UR-150: Exportable in secure electronic format maintaining integrity
- UR-151: Printable in human-readable format
- UR-152: Only authorized users may view/export/download/print audit trail
- UR-153: Protect records for accurate ready retrieval throughout retention
- UR-154: Maintain integrity, prevent unauthorized modification after generation
- UR-155: System reports contain audit metadata (generation date/time, user details)
- UR-156: System reports include org name, logo, page number, report title
- UR-157: Printed docs include printed-by, printed date/time, total pages
- UR-158: Inclusion of employee info (name, code, date/time) in reports
- UR-159: Audit trail generation outside control/access of all users and admins
- UR-160: Audit trail always ON by default, impossible to disable
- UR-161: Antivirus compatibility
- UR-162: Database encryption
- UR-163: Secure API communication
- UR-164: Vulnerability management
- UR-165: Penetration testing
- UR-166: Overdue reports
- UR-167: Employee-wise dashboard for Pending and Completed Trainings
- UR-168: Training competency report (employee-wise + completed-per-topic)
- UR-169: Accessible from tablets but not mobile
- UR-170: Support integration with external systems (instrument, DMS software)
