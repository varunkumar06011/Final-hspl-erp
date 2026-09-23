import { Typography, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" effectiveDate="September 22, 2026">
      <Typography variant="body1" paragraph>
        This Privacy Policy describes how VGRAND Health Care ("VGRAND", "we", "us", or "our")
        collects, uses, stores, and protects information when you use the Hospital Construction ERP
        mobile application and web application (collectively, the "Service"). The Service is an
        internal enterprise tool used to manage construction projects, procurement, finances, assets,
        documents, and approvals for hospital construction projects operated by VGRAND Health Care.
      </Typography>
      <Typography variant="body1" paragraph>
        By accessing or using the Service, you agree to the collection and use of information in
        accordance with this policy. If you do not agree, please do not use the Service.
      </Typography>

      <Typography variant="h5" fontWeight={600}>1. Information We Collect</Typography>
      <Typography variant="body1" paragraph>
        <strong>Account information.</strong> When you register or are provisioned by an
        administrator, we collect your full name, mobile phone number, and assigned role
        (for example, Supervisor, Accountant, or Admin).
      </Typography>
      <Typography variant="body1" paragraph>
        <strong>Authentication data.</strong> We verify your phone number using a one-time
        password (OTP) delivered by SMS through Google Firebase Authentication. We also store a
        bcrypt-hashed 4-digit PIN you choose for quick sign-in. We never store your PIN in plain
        text and we never see your OTP.
      </Typography>
      <Typography variant="body1" paragraph>
        <strong>Project and operational data.</strong> Content you enter or upload in the course of
        your work — including vendor details, quotations, purchase orders, invoices, payments,
        goods receipts, site photographs, documents, issues, inspections, labour and attendance
        records, and approval decisions — is stored on our servers and associated with your account
        for audit purposes.
      </Typography>
      <Typography variant="body1" paragraph>
        <strong>Device and push-notification data.</strong> If you enable notifications, we store a
        device push token (Firebase Cloud Messaging / Apple Push Notification service) and your
        notification preferences so we can deliver approval requests and activity alerts to your
        device.
      </Typography>
      <Typography variant="body1" paragraph>
        <strong>Technical data.</strong> Our servers automatically record standard request logs
        (IP address, timestamps, and error diagnostics) for security and troubleshooting.
      </Typography>

      <Typography variant="h5" fontWeight={600}>2. How We Use Your Information</Typography>
      <ul>
        <li>To authenticate you and secure your account (OTP verification and PIN sign-in).</li>
        <li>To provide the Service — creating, approving, and tracking procurement, finance,
          inventory, asset, and site-management records for your project.</li>
        <li>To attribute actions to you in audit logs and approval trails, which are essential
          to the integrity of a construction ERP.</li>
        <li>To send push notifications about approval requests and workflow events you have
          subscribed to.</li>
        <li>To maintain, secure, and troubleshoot the Service.</li>
      </ul>
      <Typography variant="body1" paragraph>
        We do not sell your personal information, and we do not use it for advertising or
        third-party marketing.
      </Typography>

      <Typography variant="h5" fontWeight={600}>3. Third-Party Service Providers</Typography>
      <Typography variant="body1" paragraph>
        We use a small number of processors to operate the Service:
      </Typography>
      <ul>
        <li><strong>Google Firebase</strong> — phone-number OTP authentication and push
          notifications (Firebase Cloud Messaging / Apple Push Notification service). Your phone
          number is processed by Google solely to deliver verification codes. Google's use of this
          data is governed by the Google Privacy Policy.</li>
        <li><strong>Cloud hosting providers</strong> — the application backend and database are
          hosted on secured cloud infrastructure (currently Railway and Vercel). Data is stored
          in encrypted form in transit and protected by access controls.</li>
      </ul>
      <Typography variant="body1" paragraph>
        These providers process data only on our instructions and only to the extent needed to
        provide their services to us.
      </Typography>

      <Typography variant="h5" fontWeight={600}>4. Photos, Camera, and Files</Typography>
      <Typography variant="body1" paragraph>
        The Service may request access to your device camera and photo library so you can attach
        site photographs, receipts, and documents to project records. Images and files you select
        are uploaded to project storage and are visible to other authorized users of your project.
        We do not access your camera or files except when you choose to attach them.
      </Typography>

      <Typography variant="h5" fontWeight={600}>5. Data Retention</Typography>
      <Typography variant="body1" paragraph>
        Account and project records are retained for as long as your organization maintains the
        project and for any additional period required for financial, audit, or legal compliance.
        Audit logs are preserved as part of the project's permanent record. If your account is
        deactivated, your historical records are retained but you can no longer sign in.
      </Typography>

      <Typography variant="h5" fontWeight={600}>6. Data Security</Typography>
      <Typography variant="body1" paragraph>
        We use industry-standard measures including HTTPS/TLS encryption in transit, hashed PIN
        storage (bcrypt), short-lived signed session tokens, role-based access control, and rate
        limiting on authentication endpoints. No method of transmission or storage is completely
        secure, but we work to protect your information consistent with applicable law.
      </Typography>

      <Typography variant="h5" fontWeight={600}>7. Your Rights and Choices</Typography>
      <Typography variant="body1" paragraph>
        You may request access to, correction of, or deletion of your personal information by
        contacting your project administrator. Because the Service is operated for your
        organization, some records (such as audit trails and financial documents) cannot be deleted
        while the project record must be preserved. You may disable push notifications at any time
        in your device settings or in the app's notification preferences.
      </Typography>

      <Typography variant="h5" fontWeight={600}>8. Children's Privacy</Typography>
      <Typography variant="body1" paragraph>
        The Service is a workplace tool intended for authorized personnel aged 18 and older. We do
        not knowingly collect information from children.
      </Typography>

      <Typography variant="h5" fontWeight={600}>9. International Transfers</Typography>
      <Typography variant="body1" paragraph>
        Your information may be processed on servers located outside your state or country,
        including by Google Firebase and our hosting providers. By using the Service you consent to
        these transfers, which are protected by the providers' contractual and technical safeguards.
      </Typography>

      <Typography variant="h5" fontWeight={600}>10. Changes to This Policy</Typography>
      <Typography variant="body1" paragraph>
        We may update this Privacy Policy from time to time. The updated version will be posted at
        this URL with a revised effective date, and continued use of the Service after changes take
        effect constitutes acceptance of the updated policy.
      </Typography>

      <Typography variant="h5" fontWeight={600}>11. Contact Us</Typography>
      <Typography variant="body1" paragraph>
        If you have questions about this Privacy Policy or our data practices, contact your project
        administrator or VGRAND Health Care through the Hospital Construction ERP{' '}
        <MuiLink component={RouterLink} to="/support" underline="hover">
          support channel
        </MuiLink>
        . You can also review our{' '}
        <MuiLink component={RouterLink} to="/terms" underline="hover">
          Terms &amp; Conditions
        </MuiLink>
        .
      </Typography>
    </LegalLayout>
  );
}
