import type { WritebackAdapter, WritebackAction, WritebackResult } from '@vu/core';

export interface EmailWritebackConfig {
  provider: 'smtp' | 'sendgrid';
  apiKey?: string; // SendGrid
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  from: string;
}

export class EmailWritebackAdapter implements WritebackAdapter {
  type = 'email';
  allowedActions = ['send'];

  constructor(private config: EmailWritebackConfig) {}

  async execute(action: WritebackAction): Promise<WritebackResult> {
    const { to, subject, body, requireApproval } = action.params as Record<
      string,
      string | boolean
    >;

    // Safety check: email adapter should only be used with human approval
    if (!requireApproval) {
      return {
        success: false,
        error: 'Email writeback requires require_human_approval: true in SOP guardrails',
      };
    }

    // For now, log the email (actual SMTP/SendGrid integration placeholder)
    console.log(
      `[EmailWriteback] Would send email to: ${to}, subject: ${subject}`
    );
    return {
      success: true,
      output: {
        message: 'Email queued (implementation placeholder)',
        to,
        subject,
      },
    };
  }
}
