# Security Policy & Vulnerability Disclosure

WhatsApp OS takes the security and integrity of user data, business accounts, and multi-tenant isolation extremely seriously. We welcome responsible disclosure of security vulnerabilities by researchers and the community.

---

## 1. Supported Versions

Security updates and patches are applied to the active `main` branch.

| Version / Branch | Supported          |
| ---------------- | ------------------ |
| `main`           | :white_check_mark: |
| `< 0.1.0`        | :x:                |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability in WhatsApp OS, please **do not open a public GitHub issue**. Publicly disclosing a flaw before it can be patched puts all active tenants and businesses at risk.

Instead, please send a report to:

- **Email**: `security@whatsapp-os.local`
- **Subject**: `[SECURITY VULNERABILITY REPORT] <Brief summary>`

### What to include in your report:
1. **Type of issue**: (e.g., Cross-Tenant Data Leakage, Authentication Bypass, Privilege Escalation, SQL Injection, SSRF, RCE, IDOR, Remote Webhook Spoofing).
2. **Impact**: Description of the attack vector, affected components, and potential blast radius.
3. **Step-by-step reproduction**: Clear, deterministic steps or Proof-of-Concept (PoC) script.
4. **Proposed fix / mitigation** (optional but appreciated).

---

## 3. Response SLAs

We commit to the following response timeline for reported vulnerabilities:

- **Initial Acknowledgment**: Within **24 hours**.
- **Triage & Severity Assessment**: Within **72 hours**.
- **Remediation & Patch Deployment**: Critical flaws patched within **14 days** (or sooner depending on severity).
- **Public Disclosure**: Coordinated disclosure after the patch has been verified and applied to production.

---

## 4. Safe Harbor & Responsible Disclosure

We consider security research conducted under this policy to be authorized. We will not pursue legal action against researchers who:
- Make a good faith effort to avoid privacy violations, data destruction, and service degradation.
- Do not access, modify, or delete tenant data belonging to other businesses or users.
- Give us reasonable time to remediate the vulnerability before public disclosure.
- Do not exploit a vulnerability beyond what is strictly necessary to prove its existence.

---

## 5. Scope

### In-Scope:
- Multi-tenant data isolation breaches (e.g. cross-workspace access).
- Authentication and session revocation bypasses.
- Privilege escalation across workspace roles (`VIEWER` -> `AGENT` -> `MANAGER` -> `ADMIN` -> `OWNER`).
- Server-side forgery of order totals, pricing, or financial ledger data.
- Webhook signature spoofing or replay attacks.
- Prompt injection bypassing tool schema boundaries or executing ungrounded write actions.
- Exposure of secrets (`AUTH_SECRET`, WhatsApp tokens, API keys) in client bundles or public endpoints.

### Out-of-Scope:
- Denial of Service (DoS/DDoS) attacks on demo infrastructure.
- Social engineering attacks against team members.
- Attacks requiring physical access to a user's unlocked device.
- Issues related to non-compliant third-party browser extensions.

---

For technical details on our multi-layered security architecture, see [`docs/SECURITY.md`](docs/SECURITY.md).
