# izLearn — Penetration Testing Requirements
**Reference:** UR-165 (URS Version 00)
**Classification:** GxP Validation Document

---

## 1. Scope

Penetration testing must be performed on the izLearn LMS application before initial go-live and thereafter annually (minimum). The scope covers:

| Layer | In Scope |
|-------|----------|
| Web Application (API) | All `/api/*` endpoints; authentication; session management |
| Web Frontend | React SPA; XSS; CSP; cookie security |
| Authentication | JWT token security; brute-force protection; session fixation |
| Network | Open ports; HTTPS/TLS configuration; HSTS |
| Database | SQL injection via API; privilege escalation |
| Infrastructure | Docker container escape; exposed services |

---

## 2. Minimum Test Cases

### 2.1 Authentication & Session
- [ ] Brute-force login (rate limiting validation)
- [ ] Session token prediction / entropy test
- [ ] JWT algorithm confusion (none, RS256/HS256 confusion)
- [ ] JWT expiry and rotation enforcement
- [ ] Session termination on logout
- [ ] Single-session enforcement bypass attempt
- [ ] Inactivity lock bypass

### 2.2 Authorisation
- [ ] Horizontal privilege escalation (User A accessing User B's records)
- [ ] Vertical privilege escalation (Trainee accessing Admin endpoints)
- [ ] IDOR (Insecure Direct Object Reference) on all record types
- [ ] RBAC bypass via direct API calls
- [ ] Location-scoped access bypass

### 2.3 Input Validation
- [ ] SQL injection on all filterable fields
- [ ] XSS (stored and reflected) in all user-controlled inputs
- [ ] SSRF via file upload / URL fields
- [ ] XML/JSON injection
- [ ] File upload malicious content (MIME type bypass, shell upload)
- [ ] Path traversal via file download endpoints

### 2.4 Electronic Signature Integrity (21 CFR Part 11)
- [ ] E-signature bypass attempt (replay attack)
- [ ] E-signature credential interception
- [ ] Audit trail tamper attempt
- [ ] Audit trail deletion attempt

### 2.5 Cryptography
- [ ] TLS/SSL configuration (protocol version, cipher suites, HSTS)
- [ ] Certificate validity and chain verification
- [ ] Sensitive data in transit (password, signature hash)

### 2.6 Business Logic
- [ ] Approval workflow bypass (direct status change without e-signature)
- [ ] Assessment score manipulation
- [ ] Certificate generation without passing
- [ ] Date/time manipulation (client-controlled timestamps)

---

## 3. Tools (Reference)

| Tool | Purpose |
|------|---------|
| OWASP ZAP | Dynamic application scanning |
| Burp Suite Pro | Manual API testing, session analysis |
| sqlmap | SQL injection confirmation |
| Nmap | Port/service enumeration |
| testssl.sh | TLS configuration verification |
| jwt_tool | JWT security testing |

---

## 4. Acceptance Criteria

| Severity | Accepted in Production |
|----------|----------------------|
| Critical | **NO** — must be remediated before go-live |
| High | **NO** — must be remediated before go-live |
| Medium | **Conditional** — risk-accepted with documented justification |
| Low / Informational | **Yes** — schedule for next release |

---

## 5. Reporting Requirements

The final penetration test report must include:

1. Executive summary with overall risk rating
2. Detailed findings list with: title, severity, CVSS score, affected endpoint, proof of concept, recommendation
3. Remediation evidence for all Critical and High findings (re-test results)
4. Tester credentials (name, certification, organisation)
5. Test date range and scope statement
6. Signature of authorised approver (Quality/IT)

---

## 6. Audit Trail

All penetration test reports and remediation evidence must be retained for the system's operational lifetime + regulatory retention period. Store in:
- GxP Document Management System (DMS) or
- Validated file store with access controls

**Document Owner:** IT/Quality Department
**Review Frequency:** Annual or post-major-change
