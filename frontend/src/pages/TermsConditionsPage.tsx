import { Typography, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

export default function TermsConditionsPage() {
  return (
    <LegalLayout title="Terms &amp; Conditions" effectiveDate="September 22, 2026">
      <Typography variant="body1" paragraph>
        These Terms &amp; Conditions ("Terms") govern your access to and use of the Hospital
        Construction ERP mobile application and web application (the "Service") operated by VGRAND
        Health Care ("VGRAND", "we", "us", or "our"). By signing in, creating an account, or using
        the Service, you agree to be bound by these Terms. If you do not agree, do not use the
        Service.
      </Typography>

      <Typography variant="h5" fontWeight={600}>1. The Service</Typography>
      <Typography variant="body1" paragraph>
        The Service is an enterprise resource planning tool for hospital construction projects. It
        provides workflows for vendors, quotations, purchase orders, invoices, payments, goods
        receipts, inventory, assets, site photos, documents, issues, inspections, labour records,
        budgets, ledgers, and multi-level approvals. The Service is provided to authorized personnel
        of VGRAND Health Care and its projects.
      </Typography>

      <Typography variant="h5" fontWeight={600}>2. Eligibility and Accounts</Typography>
      <ul>
        <li>You must be at least 18 years old and authorized by your organization to use the
          Service.</li>
        <li>Your account is identified by your mobile phone number, verified by SMS one-time
          password (OTP), and secured by a 4-digit PIN that you choose.</li>
        <li>You are responsible for keeping your PIN confidential and for all activity that occurs
          under your account. Do not share your PIN or OTP codes with anyone.</li>
        <li>You must provide accurate information, including your full name, which appears in audit
          logs and approval trails.</li>
        <li>An administrator may suspend or deactivate your account at any time, including if you
          leave the project or violate these Terms.</li>
      </ul>

      <Typography variant="h5" fontWeight={600}>3. Acceptable Use</Typography>
      <Typography variant="body1" paragraph>You agree that you will not:</Typography>
      <ul>
        <li>Use the Service for any purpose other than legitimate project operations for your
          organization.</li>
        <li>Enter false, misleading, or fraudulent records (for example, fabricated invoices,
          receipts, or approvals).</li>
        <li>Attempt to access another user's account, approve actions outside your assigned role,
          or circumvent role-based permissions.</li>
        <li>Probe, scan, or test the vulnerability of the Service, interfere with its operation,
          or attempt to extract data in bulk.</li>
        <li>Upload content that is unlawful, or that you have no right to share.</li>
      </ul>

      <Typography variant="h5" fontWeight={600}>4. Project Data</Typography>
      <Typography variant="body1" paragraph>
        Records you create in the Service (purchase orders, invoices, photos, documents, approvals,
        and similar content) are the property of your organization and form part of the official
        project record. Actions you take — including submissions, approvals, and edits — are
        attributed to you in audit logs and may be reviewed by administrators and auditors. You are
        responsible for the accuracy of the data you enter; entries in the Service may be relied
        upon for financial and contractual decisions.
      </Typography>

      <Typography variant="h5" fontWeight={600}>5. Approvals and Financial Records</Typography>
      <Typography variant="body1" paragraph>
        Approval workflows in the Service record organizational decisions. The Service is a
        record-keeping tool — it does not provide accounting, tax, or legal advice, and final
        responsibility for financial decisions remains with your organization and its designated
        approvers.
      </Typography>

      <Typography variant="h5" fontWeight={600}>6. Notifications</Typography>
      <Typography variant="body1" paragraph>
        If enabled, the Service sends push notifications (for example, approval requests) to your
        device. Delivery depends on your device, network, and notification settings; we are not
        responsible for missed or delayed notifications. You can manage notification preferences in
        the app or your device settings.
      </Typography>

      <Typography variant="h5" fontWeight={600}>7. Availability and Changes</Typography>
      <Typography variant="body1" paragraph>
        We aim to keep the Service available but do not guarantee uninterrupted operation. The
        Service depends on third-party providers (including Google Firebase for OTP delivery and
        push notifications, and our cloud hosting providers). We may modify, suspend, or discontinue
        features at any time, with or without notice.
      </Typography>

      <Typography variant="h5" fontWeight={600}>8. Intellectual Property</Typography>
      <Typography variant="body1" paragraph>
        The Service, including its design, code, and branding, is owned by VGRAND Health Care. You
        are granted a limited, non-exclusive, non-transferable right to use the Service for your
        organization's internal operations. You may not copy, modify, reverse engineer, or
        redistribute the Service.
      </Typography>

      <Typography variant="h5" fontWeight={600}>9. Termination</Typography>
      <Typography variant="body1" paragraph>
        Your access ends when your account is deactivated by an administrator or when your
        organization stops using the Service. Provisions concerning project data, audit records,
        disclaimers, and liability survive termination.
      </Typography>

      <Typography variant="h5" fontWeight={600}>10. Disclaimers</Typography>
      <Typography variant="body1" paragraph>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS
        OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
        NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE ERROR-FREE, SECURE, OR
        UNINTERRUPTED.
      </Typography>

      <Typography variant="h5" fontWeight={600}>11. Limitation of Liability</Typography>
      <Typography variant="body1" paragraph>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, VGRAND HEALTH CARE SHALL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA,
        PROFITS, OR BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE. OUR
        AGGREGATE LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE SHALL NOT EXCEED THE AMOUNT PAID
        BY YOUR ORGANIZATION FOR THE SERVICE IN THE THREE MONTHS PRECEDING THE CLAIM.
      </Typography>

      <Typography variant="h5" fontWeight={600}>12. Governing Law</Typography>
      <Typography variant="body1" paragraph>
        These Terms are governed by the laws of India. Any dispute arising out of or relating to
        these Terms or the Service shall be subject to the exclusive jurisdiction of the courts
        having jurisdiction over VGRAND Health Care's registered office.
      </Typography>

      <Typography variant="h5" fontWeight={600}>13. Changes to These Terms</Typography>
      <Typography variant="body1" paragraph>
        We may update these Terms from time to time. The current version will always be available at
        this URL. Continued use of the Service after changes take effect constitutes acceptance of
        the updated Terms.
      </Typography>

      <Typography variant="h5" fontWeight={600}>14. Contact</Typography>
      <Typography variant="body1" paragraph>
        Questions about these Terms may be directed to your project administrator or to VGRAND
        Health Care via our{' '}
        <MuiLink component={RouterLink} to="/support" underline="hover">
          support page
        </MuiLink>
        . Please also review our{' '}
        <MuiLink component={RouterLink} to="/privacy-policy" underline="hover">
          Privacy Policy
        </MuiLink>
        .
      </Typography>
    </LegalLayout>
  );
}
